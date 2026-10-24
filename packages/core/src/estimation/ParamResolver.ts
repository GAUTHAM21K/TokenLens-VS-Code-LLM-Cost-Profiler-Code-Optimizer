/**
 * Resolves per-phase estimation parameters from catalog defaults, profile values and overrides.
 *
 * Exports: ParamValidationError, MetricRange, ResolvedParams, resolveParams, ParamResolver
 * Feature: token cost estimator
 */
import type { Phase, PhaseOverride } from "../protocol/types.js";

export class ParamValidationError extends Error {
  constructor(
    public readonly paramName: string,
    public readonly reason: string,
    public readonly values?: { low: number; expected: number; high: number }
  ) {
    super(`Invalid parameter range for '${paramName}': ${reason}`);
    this.name = "ParamValidationError";
  }
}

export interface MetricRange {
  low: number;
  expected: number;
  high: number;
}

export interface ResolvedParams {
  calls: MetricRange;
  tokensPerCall: MetricRange;
  retries: MetricRange;
  volumeMultiplier: MetricRange;
}

function validateRange(
  name: string,
  low: number,
  expected: number,
  high: number
): void {
  if (low > high) {
    throw new ParamValidationError(
      name,
      `low (${low}) cannot be greater than high (${high})`,
      { low, expected, high }
    );
  }
  if (expected < low) {
    throw new ParamValidationError(
      name,
      `expected (${expected}) cannot be less than low (${low})`,
      { low, expected, high }
    );
  }
  if (expected > high) {
    throw new ParamValidationError(
      name,
      `expected (${expected}) cannot be greater than high (${high})`,
      { low, expected, high }
    );
  }
}

/**
 * Pure function resolving default parameters and user overrides with boundary validation.
 * (FR-020, clarification Q2)
 */
export function resolveParams(
  defaultParams: Phase["defaultParams"],
  override?: PhaseOverride
): ResolvedParams {
  let callsLow = override?.callsLow ?? defaultParams.callsLow;
  const callsExpected = override?.callsExpected ?? defaultParams.callsExpected;
  let callsHigh = override?.callsHigh ?? defaultParams.callsHigh;
  // H10: Automatically widen range if expected override falls outside default low/high
  if (override?.callsExpected !== undefined) {
    if (override.callsHigh === undefined && callsExpected > callsHigh) {
      callsHigh = callsExpected;
    }
    if (override.callsLow === undefined && callsExpected < callsLow) {
      callsLow = callsExpected;
    }
  }
  validateRange("calls", callsLow, callsExpected, callsHigh);

  let tokensLow = override?.tokensPerCallLow ?? defaultParams.tokensPerCallLow;
  const tokensExpected =
    override?.tokensPerCallExpected ?? defaultParams.tokensPerCallExpected;
  let tokensHigh = override?.tokensPerCallHigh ?? defaultParams.tokensPerCallHigh;
  if (override?.tokensPerCallExpected !== undefined) {
    if (override.tokensPerCallHigh === undefined && tokensExpected > tokensHigh) {
      tokensHigh = tokensExpected;
    }
    if (override.tokensPerCallLow === undefined && tokensExpected < tokensLow) {
      tokensLow = tokensExpected;
    }
  }
  validateRange("tokensPerCall", tokensLow, tokensExpected, tokensHigh);

  let retriesLow = defaultParams.retriesLow;
  const retriesExpected =
    override?.retriesExpected ?? defaultParams.retriesExpected;
  let retriesHigh = defaultParams.retriesHigh;
  if (override?.retriesExpected !== undefined) {
    if (retriesExpected > retriesHigh) {
      retriesHigh = retriesExpected;
    }
    if (retriesExpected < retriesLow) {
      retriesLow = retriesExpected;
    }
  }
  validateRange("retries", retriesLow, retriesExpected, retriesHigh);

  const volumeLow =
    defaultParams.volumeMultiplierLow ?? 1.0;
  const volumeExpected =
    override?.volumeMultiplierExpected ??
    defaultParams.volumeMultiplierExpected ??
    1.0;
  let volumeHigh =
    defaultParams.volumeMultiplierHigh ??
    Math.max(1.0, volumeExpected);
  if (volumeExpected > volumeHigh) {
    volumeHigh = volumeExpected;
  }
  validateRange("volumeMultiplier", volumeLow, volumeExpected, volumeHigh);

  return {
    calls: { low: callsLow, expected: callsExpected, high: callsHigh },
    tokensPerCall: { low: tokensLow, expected: tokensExpected, high: tokensHigh },
    retries: { low: retriesLow, expected: retriesExpected, high: retriesHigh },
    volumeMultiplier: {
      low: volumeLow,
      expected: volumeExpected,
      high: volumeHigh,
    },
  };
}

export const ParamResolver = {
  resolve: resolveParams,
};
