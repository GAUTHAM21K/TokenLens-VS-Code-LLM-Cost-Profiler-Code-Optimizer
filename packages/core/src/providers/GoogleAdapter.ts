/**
 * Google Gemini API adapter (key validation, model list, completion with retry).
 *
 * Exports: GoogleAdapter
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

export class GoogleAdapter implements ProviderAdapter {
  public readonly providerId = "google";
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: { baseUrl?: string; fetchFn?: typeof fetch } = {}) {
    this.baseUrl = (
      options.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
    ).replace(/\/+$/, "");
    this.fetchFn = options.fetchFn || fetch;
  }

  public async validateKey(getKey: () => Promise<string>): Promise<KeyValidationResult> {
    try {
      const key = await getKey();
      const response = await fetchWithRetry(
        `${this.baseUrl}/models?key=${encodeURIComponent(key)}`,
        {
          method: "GET",
        },
        { maxRetries: 2 },
        this.fetchFn
      );

      if (response.ok) {
        return { valid: true };
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return {
          valid: false,
          reason: "invalid",
          message: "Google API key is invalid or lacks necessary permissions.",
        };
      }

      if (response.status === 429) {
        return {
          valid: false,
          reason: "rate-limited",
          message: "Google Gemini rate limit reached during validation.",
        };
      }

      return {
        valid: false,
        reason: "unreachable",
        message: `HTTP error ${response.status}: ${response.statusText}`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to reach Google Gemini endpoint.";
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
      `${this.baseUrl}/models?key=${encodeURIComponent(key)}`,
      {
        method: "GET",
      },
      {},
      this.fetchFn
    );

    if (!response.ok) {
      throw new Error(`Failed to list Google models: ${response.statusText}`);
    }

    const data = (await response.json()) as { models?: Array<{ name: string }> };
    if (data && Array.isArray(data.models)) {
      return data.models.map((m) => m.name.replace(/^models\//, ""));
    }
    return [];
  }

  public async countTokens(text: string, _model?: string): Promise<TokenCountResult> {
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
    const model = options.model || "gemini-1.5-pro";

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0,
      },
    };

    const response = await fetchWithRetry(
      `${this.baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { signal: options.signal },
      this.fetchFn
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google Gemini completion error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    const content =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const inputTokens = data.usageMetadata?.promptTokenCount;
    const outputTokens = data.usageMetadata?.candidatesTokenCount;

    return { content, inputTokens, outputTokens };
  }
}
