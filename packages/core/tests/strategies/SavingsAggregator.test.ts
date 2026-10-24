/**
 * Tests: SavingsAggregator (T070, T089, FR-029, Principle V).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import {
  SavingsAggregator,
  combineSavings,
  combineSavingsByChannel,
  inputCostShare,
  techniqueChannels,
} from "../../src/strategies/SavingsAggregator.js";
import snapshot from "../../resources/catalog-snapshot.json";
import type { Strategy } from "../../src/protocol/types.js";

const strategyA: Strategy = {
  id: "strat-cache",
  name: "Prompt Prefix Caching",
  group: "caching",
  targets: ["build", "runtime"],
  summary: "Caches static system prompt and few-shot examples.",
  savings: {
    minPercent: 30,
    maxPercent: 50,
    basis: "Documented provider prefix cache discount",
  },
  reviewStatus: "approved",
  reviewedBy: "Alice",
  reviewedAt: "2026-10-01T00:00:00.000Z",
};

const strategyB: Strategy = {
  id: "strat-compress",
  name: "Context Compression",
  group: "prompt-efficiency",
  targets: ["runtime"],
  summary: "Strips redundant conversational fluff and formatting.",
  savings: {
    minPercent: 20,
    maxPercent: 40,
    basis: "Observed token reduction across conversation history",
  },
  reviewStatus: "approved",
  reviewedBy: "Bob",
  reviewedAt: "2026-10-01T00:00:00.000Z",
};

const strategyFiftyOne: Strategy = {
  id: "strat-50a",
  name: "50% Savings Strategy A",
  group: "test",
  targets: ["runtime"],
  summary: "50% savings test",
  savings: {
    minPercent: 50,
    maxPercent: 50,
    basis: "Test basis",
  },
  reviewStatus: "approved",
  reviewedBy: "Charlie",
  reviewedAt: "2026-10-01T00:00:00.000Z",
};

const strategyFiftyTwo: Strategy = {
  id: "strat-50b",
  name: "50% Savings Strategy B",
  group: "test",
  targets: ["runtime"],
  summary: "50% savings test",
  savings: {
    minPercent: 50,
    maxPercent: 50,
    basis: "Test basis",
  },
  reviewStatus: "approved",
  reviewedBy: "Charlie",
  reviewedAt: "2026-10-01T00:00:00.000Z",
};

describe("SavingsAggregator (T070, T089, FR-029, Principle V)", () => {
  it("compounds two 50% strategies to 75% (never 100%)", () => {
    expect(SavingsAggregator.combine).toBe(combineSavings);
    const combined = combineSavings([strategyFiftyOne, strategyFiftyTwo], "runtime");

    // 1 - (1 - 0.5) * (1 - 0.5) = 1 - 0.25 = 0.75 (75%)
    expect(combined.minPercent).toBe(75);
    expect(combined.maxPercent).toBe(75);
    expect(combined.basis).toMatch(/^Input 75–75% on ~50% of cost, output 75–75% on the rest/);
  });

  it("calculates min and max ranges multiplicatively and separately", () => {
    const combined = combineSavings([strategyA, strategyB], "runtime");

    // Min: 1 - (1 - 0.3) * (1 - 0.2) = 1 - 0.7 * 0.8 = 1 - 0.56 = 44%
    // Max: 1 - (1 - 0.5) * (1 - 0.4) = 1 - 0.5 * 0.6 = 1 - 0.30 = 70%
    expect(combined.minPercent).toBe(44);
    expect(combined.maxPercent).toBe(70);
  });

  it("filters strategies strictly by target track", () => {
    // strategyB only targets runtime, strategyA targets build + runtime
    const buildCombined = combineSavings([strategyA, strategyB], "build");

    expect(buildCombined.minPercent).toBe(30);
    expect(buildCombined.maxPercent).toBe(50);
  });

  it("returns 0% when no strategies match the track or input is empty", () => {
    expect(combineSavings([], "build").minPercent).toBe(0);
    expect(combineSavings([strategyB], "build").minPercent).toBe(0);
  });

  it("prices independently compounded input/output discounts and cached reads", () => {
    const result = SavingsAggregator.aggregate({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 20,
      pricing: {
        modelId: "m",
        currency: "USD",
        inputPerMTok: 1,
        outputPerMTok: 5,
        cachedInputPerMTok: 0.2,
        effectiveFrom: "2026-01-01T00:00:00Z",
        sourceUrl: "https://example.com/pricing",
        verifiedAt: "2026-01-01T00:00:00Z",
      },
      strategies: [
        { ...strategyB, id: "whitespace-normalize", savings: { ...strategyB.savings, minPercent: 50, maxPercent: 50 } },
        { ...strategyB, id: "caveman-output", savings: { ...strategyB.savings, minPercent: 20, maxPercent: 20 } },
        { ...strategyA, id: "prompt-caching" },
      ],
    });

    expect(result.effectiveInputTokens).toBe(50);
    expect(result.effectiveOutputTokens).toBe(40);
    expect(result.costBeforeUsd).toBeCloseTo(0.00035, 10);
    expect(result.costAfterUsd).toBeCloseTo(0.0002408, 10);
    expect(result.cacheReadSavingsUsd).toBeCloseTo(0.0000192, 10);
  });

  describe("input/output split (technique affects)", () => {
    const input50 = { ...strategyFiftyOne, optimizer: { mode: "rule", order: 1, affects: "input" } } as Strategy;
    const output50 = { ...strategyFiftyTwo, optimizer: { mode: "rule", order: 2, affects: "output" } } as Strategy;

    it("never compounds an input technique with an output technique", () => {
      const ch = combineSavingsByChannel([input50, output50], "runtime");
      expect(ch.input.maxPercent).toBe(50);
      expect(ch.output.maxPercent).toBe(50);
      // 50% of input spend + 50% of output spend = 50% of total, not 75%.
      expect(combineSavings([input50, output50], "runtime", 0.3).maxPercent).toBe(50);
      expect(combineSavings([input50], "runtime", 0.3).maxPercent).toBe(15);
      expect(techniqueChannels(strategyA)).toEqual(["input", "output"]);
    });

    it("all 7 catalog techniques no longer add up to ~96%", () => {
      const all = (snapshot as { strategies: Strategy[] }).strategies;
      expect(all).toHaveLength(7);
      const share = inputCostShare(
        { llm: { avgPromptTokens: 1500, avgOutputTokens: 300, avgPrefixTokens: 1200 } } as never,
        (snapshot as { pricing: never[] }).pricing
      );
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.8);
      const total = combineSavings(all, "runtime", share);
      expect(total.maxPercent).toBeLessThan(90);
      expect(total.basis).toMatch(/^Input .* output .* on the rest/);
    });
  });
});

