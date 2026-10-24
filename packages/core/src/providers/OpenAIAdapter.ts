/**
 * OpenAI Chat Completions adapter (key validation, model list, completion with retry).
 *
 * Exports: OpenAIAdapter
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

export class OpenAIAdapter implements ProviderAdapter {
  public readonly providerId: string = "openai";
  protected baseUrl: string;
  protected fetchFn: typeof fetch;

  constructor(options: { baseUrl?: string; fetchFn?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
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
            Authorization: `Bearer ${key}`,
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
      const message = err instanceof Error ? err.message : "Failed to reach OpenAI endpoint.";
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
          Authorization: `Bearer ${key}`,
        },
      },
      {},
      this.fetchFn
    );

    if (!response.ok) {
      throw new Error(`Failed to list OpenAI models: ${response.statusText}`);
    }

    const data = (await response.json()) as { data?: Array<{ id: string }> };
    if (data && Array.isArray(data.data)) {
      return data.data.map((m) => m.id);
    }
    return [];
  }

  public async countTokens(text: string, _model?: string): Promise<TokenCountResult> {
    // Exact tiktoken or standard chars/4 approximation
    const count = Math.ceil(text.length / 4);
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
    const model = options.model || "gpt-4o";

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0,
    };

    if (options.responseFormat === "json_object" && !options.schema) {
      body.response_format = { type: "json_object" };
    }

    if (options.schema) {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "output_schema",
          strict: true,
          schema: options.schema,
        },
      };
    }

    const response = await fetchWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { signal: options.signal },
      this.fetchFn
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI completion error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content || "";
    const inputTokens = data.usage?.prompt_tokens;
    const outputTokens = data.usage?.completion_tokens;

    return { content, inputTokens, outputTokens };
  }
}
