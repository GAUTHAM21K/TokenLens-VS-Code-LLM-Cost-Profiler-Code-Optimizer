/**
 * Converts token counts and catalog pricing into USD cost ranges.
 *
 * Exports: CostCalculator
 * Feature: providers
 */
import type { Pricing, CostRange } from "../protocol/types.js";

export class CostCalculator {
  /**
   * Computes the dollar cost range for a given input and output token count against model pricing.
   * Rates in catalog pricing are in USD per million tokens (inputPerMTok and outputPerMTok).
   */
  public static computeCost(
    inputTokens: number,
    outputTokens: number,
    pricing: Pricing
  ): CostRange {
    const cost = CostCalculator.computeCostUsd(inputTokens, outputTokens, pricing);
    return {
      currency: "USD",
      low: cost,
      expected: cost,
      high: cost,
      pricingVerifiedAt: pricing.verifiedAt,
    };
  }

  /**
   * Computes exact scalar USD cost for an execution.
   */
  public static computeCostUsd(
    inputTokens: number,
    outputTokens: number,
    pricing: Pricing
  ): number {
    const safeInput = Math.max(0, inputTokens || 0);
    const safeOutput = Math.max(0, outputTokens || 0);

    const inputCost = (safeInput / 1_000_000) * pricing.inputPerMTok;
    const outputCost = (safeOutput / 1_000_000) * pricing.outputPerMTok;

    return Number((inputCost + outputCost).toFixed(6));
  }
}
