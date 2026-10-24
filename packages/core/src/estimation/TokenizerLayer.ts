/**
 * Token counting layer: exact tokenizers where available, labelled char-based approximation
 * otherwise.
 *
 * Exports: TokenizerCountResult, Tokenizer, TiktokenEncoder, TiktokenLoader, EndpointCountGetter,
 *   TokenizerLayerOptions, CharApproxTokenizer, TiktokenTokenizer, EndpointTokenizer, getTokenizer,
 *   TokenizerLayer
 * Feature: token cost estimator
 */
import type { Model } from "../protocol/types.js";

export interface TokenizerCountResult {
  count: number;
  label: "exact" | "approximate";
  margin?: string;
}

export interface Tokenizer {
  count(text: string): TokenizerCountResult;
}

export interface TiktokenEncoder {
  encode(text: string): { length: number } | number[];
}

export type TiktokenLoader = (encodingOrModel?: string) => TiktokenEncoder | null | undefined;

export type EndpointCountGetter = (modelId: string, text: string) => number;

export interface TokenizerLayerOptions {
  tiktokenLoader?: TiktokenLoader;
  anthropicEndpointGetter?: EndpointCountGetter;
  googleEndpointGetter?: EndpointCountGetter;
}

/**
 * Character-based approximation fallback.
 * Form: Math.ceil(chars / 4) with label: "approximate" and margin: "±15%".
 */
export class CharApproxTokenizer implements Tokenizer {
  count(text: string): TokenizerCountResult {
    const chars = text ? text.length : 0;
    const count = Math.ceil(chars / 4);
    return {
      count,
      label: "approximate",
      margin: "±15%",
    };
  }
}

// Regex approximating OpenAI cl100k_base / o200k token split when WASM is absent
const CL100K_REGEX =
  /'s|'t|'re|'ve|'m|'ll|'d|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}{1,3}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

function fallbackCountTiktoken(text: string): number {
  if (!text) return 0;
  try {
    const matches = text.match(CL100K_REGEX);
    return matches ? matches.length : Math.ceil(text.length / 4);
  } catch {
    // If unicode regex property escapes are unavailable in environment
    const words = text.match(/\w+|[^\w\s]+|\s+/g);
    return words ? words.length : Math.ceil(text.length / 4);
  }
}

/**
 * Tiktoken tokenizer for GPT/O-series models.
 * Uses injected WASM encoder when provided, or local regex token counter.
 */
export class TiktokenTokenizer implements Tokenizer {
  private encoder: TiktokenEncoder | null = null;

  constructor(model: Model, loader?: TiktokenLoader) {
    if (loader) {
      try {
        const encodingName = model.tokenizer?.name || model.id;
        this.encoder = loader(encodingName) || null;
      } catch {
        this.encoder = null;
      }
    }
  }

  count(text: string): TokenizerCountResult {
    if (!text) {
      return {
        count: 0,
        label: this.encoder ? "exact" : "approximate",
        margin: this.encoder ? undefined : "±15%",
      };
    }

    if (this.encoder) {
      const tokens = this.encoder.encode(text);
      return {
        count: Array.isArray(tokens) ? tokens.length : tokens.length,
        label: "exact",
      };
    }

    // FR-023: When WASM encoder is absent, regex fallback must be labelled approximate
    return {
      count: fallbackCountTiktoken(text),
      label: "approximate",
      margin: "±15%",
    };
  }
}

/**
 * Provider endpoint tokenizer (Anthropic / Google).
 * Uses injected sync count getter if provided; falls back to char-approx.
 */
export class EndpointTokenizer implements Tokenizer {
  constructor(
    private readonly model: Model,
    private readonly getter?: EndpointCountGetter
  ) {}

  count(text: string): TokenizerCountResult {
    if (!text) {
      return { count: 0, label: this.getter ? "exact" : "approximate", margin: this.getter ? undefined : "±15%" };
    }

    if (this.getter) {
      try {
        const count = this.getter(this.model.id, text);
        return {
          count,
          label: "exact",
        };
      } catch {
        // Fall back to approximate if getter fails
      }
    }

    return new CharApproxTokenizer().count(text);
  }
}

/**
 * TokenizerLayer factory function.
 * (FR-023, clarification Q4)
 */
export function getTokenizer(
  model: Model,
  options?: TokenizerLayerOptions
): Tokenizer {
  const kind = model.tokenizer?.kind;

  switch (kind) {
    case "tiktoken":
      return new TiktokenTokenizer(model, options?.tiktokenLoader);

    case "anthropic-endpoint":
      return new EndpointTokenizer(model, options?.anthropicEndpointGetter);

    case "google-endpoint":
      return new EndpointTokenizer(model, options?.googleEndpointGetter);

    case "char-approx":
    default:
      return new CharApproxTokenizer();
  }
}

export const TokenizerLayer = {
  getTokenizer,
  CharApproxTokenizer,
  TiktokenTokenizer,
  EndpointTokenizer,
};
