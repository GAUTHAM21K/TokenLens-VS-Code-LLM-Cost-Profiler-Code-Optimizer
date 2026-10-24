/**
 * OpenAI-compatible adapter for any catalog provider with a custom baseUrl (e.g. Groq).
 *
 * Exports: OpenAICompatibleAdapterOptions, OpenAICompatibleAdapter
 * Feature: providers
 */
import { OpenAIAdapter } from "./OpenAIAdapter.js";

export interface OpenAICompatibleAdapterOptions {
  providerId?: string;
  baseUrl: string;
  fetchFn?: typeof fetch;
}

export class OpenAICompatibleAdapter extends OpenAIAdapter {
  public override readonly providerId: string;

  constructor(options: OpenAICompatibleAdapterOptions) {
    super({
      baseUrl: options.baseUrl,
      fetchFn: options.fetchFn,
    });
    this.providerId = options.providerId || "openai-compatible";
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }
}
