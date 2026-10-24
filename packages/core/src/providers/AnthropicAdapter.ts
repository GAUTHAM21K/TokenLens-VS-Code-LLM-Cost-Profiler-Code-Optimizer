/**
 * Anthropic Messages API adapter (key validation, model list, completion with retry).
 *
 * Exports: AnthropicAdapter
 * Feature: providers
 */
import type {
  ProviderAdapter,
  KeyValidationResult,
  TokenCountResult,
  ChatMessage,
  CompletionOptions,
  CompletionResult,
} from "./ProviderAdapter.js";
import { fetchWithRetry } from "./httpHelper.js";

export class AnthropicAdapter implements ProviderAdapter {
  public readonly providerId = "anthropic";
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: { baseUrl?: string; fetchFn?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    this.fetchFn = options.fetchFn || fetch;
  }

  public async validateKey(getKey: () => Promise<string>): Promise<KeyValidationResult> {
    try {
      const key = await getKey();
      const response = await fetchWithRetry(
        `${this.baseUrl}/models`,
        {
          method: "GET",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
          },
        },
        { maxRetries: 2 },
        this.fetchFn
      );

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 401 || response.status === 403) {
        return {
          valid: false,
          reason: "invalid",
          message: "API key is invalid or lacks necessary permissions.",
        };
      }

      if (response.status === 429) {
        return {
          valid: false,
          reason: "rate-limited",
          message: "Provider rate limit reached during validation.",
        };
      }

      return {
        valid: false,
        reason: "unreachable",
        message: `HTTP error ${response.status}: ${response.statusText}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reach Anthropic endpoint.";
      return {
        valid: false,
        reason: "unreachable",
        message,
      };
    }
  }

  public async listModels(getKey: () => Promise<string>): Promise<string[]> {
    const key = await getKey();
    const response = await fetchWithRetry(
      `${this.baseUrl}/models`,
      {
        method: "GET",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
      },
      {},
      this.fetchFn
    );

    if (!response.ok) {
      throw new Error(`Failed to list Anthropic models: ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    if (data && Array.isArray(data.data)) {
      return data.data.map((m) => m.id);
    }
    return [];
  }

  public async countTokens(text: string, _model?: string): Promise<TokenCountResult> {
    // Character-based fallback heuristic when offline / without count_tokens call
    const count = Math.ceil(text.length / 3.8);
    return {
      count,
      label: "approximate",
      margin: "+-15%",
    };
  }

  public async complete(
    messages: ChatMessage[],
    getKey: () => Promise<string>,
    options: CompletionOptions = {}
  ): Promise<CompletionResult> {
    const key = await getKey();
    const model = options.model || "claude-3-5-sonnet-20241022";

    // Split system message from user/assistant messages for Anthropic API
    const systemMsg = messages.find((m) => m.role === "system")?.content;
    const conversation = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role,
        content: m.content,
      }));

    const body: Record<string, unknown> = {
      model,
      messages: conversation,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0,
    };
    if (systemMsg) {
      body.system = systemMsg;
    }

    const response = await fetchWithRetry(
      `${this.baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { signal: options.signal },
      this.fetchFn
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic completion error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const content = data.content?.[0]?.text || "";
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return { content, inputTokens, outputTokens };
  }
}
