/**
 * Tests: CostCalculator Unit Tests (T062, FR-012).
 *
 * Exports: none (test suite)
 * Feature: providers
 */
import { describe, it, expect } from "vitest";
import { CostCalculator } from "../../src/providers/CostCalculator.js";
import type { Pricing } from "../../src/protocol/types.js";

describe("CostCalculator Unit Tests (T062, FR-012)", () => {
  const samplePricing: Pricing = {
    modelId: "claude-3-5-sonnet",
    currency: "USD",
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
  };

  it("calculates exact USD cost for 1M input tokens", () => {
    const range = CostCalculator.computeCost(1_000_000, 0, samplePricing);
    expect(range.expected).toBe(3.0);
    expect(range.low).toBe(3.0);
    expect(range.high).toBe(3.0);

    const costUsd = CostCalculator.computeCostUsd(1_000_000, 0, samplePricing);
    expect(costUsd).toBe(3.0);
  });

  it("calculates zero cost for zero tokens", () => {
    const range = CostCalculator.computeCost(0, 0, samplePricing);
    expect(range.expected).toBe(0);
    expect(range.low).toBe(0);
    expect(range.high).toBe(0);

    const costUsd = CostCalculator.computeCostUsd(0, 0, samplePricing);
    expect(costUsd).toBe(0);
  });

  it("calculates combined input and output costs correctly", () => {
    // 500,000 input tokens at $3/MTok = $1.50
    // 100,000 output tokens at $15/MTok = $1.50
    // Total = $3.00
    const costUsd = CostCalculator.computeCostUsd(500_000, 100_000, samplePricing);
    expect(costUsd).toBe(3.0);
  });
});
