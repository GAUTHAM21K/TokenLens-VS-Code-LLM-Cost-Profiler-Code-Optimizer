/**
 * Tests: TokenizerLayer (T068, FR-023, clarification Q4).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import {
  getTokenizer,
  TokenizerLayer,
  CharApproxTokenizer,
  TiktokenTokenizer,
  EndpointTokenizer,
} from "../../src/estimation/TokenizerLayer.js";
import type { Model } from "../../src/protocol/types.js";

const gpt4Model: Model = {
  id: "gpt-4o",
  providerId: "openai",
  label: "GPT-4o",
  contextWindow: 128000,
  maxOutput: 4096,
  tier: "frontier",
  supportsCaching: true,
  supportsBatch: true,
  supportsStructuredOutput: true,
  tokenizer: {
    kind: "tiktoken",
    name: "o200k_base",
  },
  status: "active",
  addedAt: "2026-01-01T00:00:00.000Z",
};

const mistralModel: Model = {
  id: "mistral-large-2407",
  providerId: "mistral",
  label: "Mistral Large",
  contextWindow: 128000,
  maxOutput: 4096,
  tier: "advanced",
  supportsCaching: false,
  supportsBatch: false,
  supportsStructuredOutput: true,
  tokenizer: {
    kind: "char-approx",
  },
  status: "active",
  addedAt: "2026-01-01T00:00:00.000Z",
};

const claudeModel: Model = {
  id: "claude-3-5-sonnet",
  providerId: "anthropic",
  label: "Claude 3.5 Sonnet",
  contextWindow: 200000,
  maxOutput: 8192,
  tier: "frontier",
  supportsCaching: true,
  supportsBatch: true,
  supportsStructuredOutput: true,
  tokenizer: {
    kind: "anthropic-endpoint",
  },
  status: "active",
  addedAt: "2026-01-01T00:00:00.000Z",
};

describe("TokenizerLayer (T068, FR-023, clarification Q4)", () => {
  it("GPT-4 tokenizer returns label: 'approximate' with margin when loader is absent (FR-023, H3)", () => {
    expect(TokenizerLayer.getTokenizer).toBe(getTokenizer);
    const tokenizer = getTokenizer(gpt4Model);
    const result = tokenizer.count("Hello, world! This is a test sentence.");

    expect(result.label).toBe("approximate");
    expect(result.margin).toBe("±15%");
    expect(result.count).toBeGreaterThan(0);
  });

  it("Mistral tokenizer returns label: 'approximate' with margin: '±15%'", () => {
    const tokenizer = getTokenizer(mistralModel);
    const text = "12345678"; // 8 chars -> ceil(8/4) = 2
    const result = tokenizer.count(text);

    expect(result.label).toBe("approximate");
    expect(result.margin).toBe("±15%");
    expect(result.count).toBe(2);
  });

  it("handles injected tiktoken loader for exact WASM counting", () => {
    const mockLoader = (_encoding?: string) => ({
      encode: (_text: string) => [1, 2, 3, 4, 5],
    });

    const tokenizer = getTokenizer(gpt4Model, { tiktokenLoader: mockLoader });
    const result = tokenizer.count("Arbitrary text payload");

    expect(result.label).toBe("exact");
    expect(result.count).toBe(5);
  });

  it("handles injected endpoint getter for Claude/Gemini and falls back to approximate if absent", () => {
    // When getter is absent -> falls back to char-approx
    const offlineClaudeTokenizer = getTokenizer(claudeModel);
    const offlineResult = offlineClaudeTokenizer.count("12345678");
    expect(offlineResult.label).toBe("approximate");
    expect(offlineResult.margin).toBe("±15%");
    expect(offlineResult.count).toBe(2);

    // When getter is injected -> exact
    const onlineClaudeTokenizer = getTokenizer(claudeModel, {
      anthropicEndpointGetter: (_modelId, _text) => 42,
    });
    const onlineResult = onlineClaudeTokenizer.count("12345678");
    expect(onlineResult.label).toBe("exact");
    expect(onlineResult.count).toBe(42);
    expect(onlineResult.margin).toBeUndefined();
  });

  it("handles empty text gracefully across all tokenizers", () => {
    expect(new CharApproxTokenizer().count("").count).toBe(0);
    expect(new TiktokenTokenizer(gpt4Model).count("").count).toBe(0);
    expect(new EndpointTokenizer(claudeModel).count("").count).toBe(0);
  });
});
