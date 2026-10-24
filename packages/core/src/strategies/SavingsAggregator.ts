/**
 * Combines selected strategies' savings ranges into build/runtime savings. Input-affecting and
 * output-affecting techniques compound separately (technique `optimizer.affects`, else
 * `savings.appliesTo`), and the total weights the two channels by the input share of cost, so a
 * technique that trims output tokens never discounts input spend (and vice versa).
 *
 * Exports: SavingsChannel, ChannelSavings, techniqueChannels, combineSavingsByChannel,
 *   combineSavings, inputCostShare, DEFAULT_INPUT_COST_SHARE, SavingsAggregator
 * Feature: token cost estimator
 */
import type { ProjectProfile, Pricing, SavingsRange, Strategy } from "../protocol/types.js";

export type SavingsChannel = "input" | "output";
export interface ChannelSavings {
  input: SavingsRange;
  output: SavingsRange;
}

export interface StrategyDiscounts {
  inputDiscountPct: number;
  outputDiscountPct: number;
  cacheWriteDiscountPct?: number;
  cacheReadDiscountPct?: number;
}

export interface AggregatedCost {
  effectiveInputTokens: number;
  effectiveOutputTokens: number;
  costBeforeUsd: number;
  costAfterUsd: number;
  inputSavingsPct: number;
  outputSavingsPct: number;
  cacheReadSavingsUsd: number;
}

/** Input share of spend used when nothing better is known. */
export const DEFAULT_INPUT_COST_SHARE = 0.5;

/** Which cost channels a technique reduces: `optimizer.affects`, else `savings.appliesTo`. */
export function techniqueChannels(s: Strategy): SavingsChannel[] {
  const affects = s.optimizer?.affects ?? s.savings.appliesTo;
  if (affects === "input") return ["input"];
  if (affects === "output") return ["output"];
  return ["input", "output"];
}

const round1 = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));
const clampPct = (n: number) => Math.max(0, Math.min(100, n)) / 100;
const capBasis = (b: string) => (b.length > 500 ? b.slice(0, 497) + "..." : b);

function emptyRange(basis: string, appliesTo: SavingsRange["appliesTo"]): SavingsRange {
  return { minPercent: 0, maxPercent: 0, basis, unit: "percent", appliesTo };
}

/**
 * Multiplicative compounding per channel: 1 - prod(1 - s/100), min and max separately.
 * Two 50% techniques on the same channel compound to 75%, never 100%.
 */
export function combineSavingsByChannel(
  strategies: Strategy[],
  track: "build" | "runtime"
): ChannelSavings {
  const applicable = (Array.isArray(strategies) ? strategies : []).filter((s) =>
    s.targets.includes(track)
  );
  const one = (channel: SavingsChannel): SavingsRange => {
    const on = applicable.filter((s) => techniqueChannels(s).includes(channel));
    if (on.length === 0) return emptyRange(`No ${channel}-token techniques on ${track} track`, channel);
    let minRemaining = 1;
    let maxRemaining = 1;
    for (const s of on) {
      minRemaining *= 1 - clampPct(s.savings.minPercent);
      maxRemaining *= 1 - clampPct(s.savings.maxPercent);
    }
    return {
      minPercent: round1((1 - minRemaining) * 100),
      maxPercent: round1((1 - maxRemaining) * 100),
      basis: capBasis(
        `Compounded ${channel}-token savings of ${on.map((s) => s.name).join(", ")} on ${track} track`
      ),
      unit: "percent",
      appliesTo: channel,
    };
  };
  return { input: one("input"), output: one("output") };
}

/**
 * Total savings on a track: input-channel savings on the input share of cost plus output-channel
 * savings on the rest. (FR-029, Principle V: the basis always states how it was derived.)
 */
export function combineSavings(
  strategies: Strategy[],
  track: "build" | "runtime",
  inputShare: number = DEFAULT_INPUT_COST_SHARE
): SavingsRange {
  if (!Array.isArray(strategies) || strategies.length === 0) {
    return emptyRange("No applicable strategies active", "total");
  }
  const applicable = strategies.filter((s) => s.targets.includes(track));
  if (applicable.length === 0) {
    return emptyRange(`No strategies targeted to ${track} track`, "total");
  }
  const w = Math.max(0, Math.min(1, inputShare));
  const ch = combineSavingsByChannel(applicable, track);
  const mix = (a: number, b: number) => round1(w * a + (1 - w) * b);
  const names = applicable.map((s) => s.name).join(", ");
  return {
    minPercent: mix(ch.input.minPercent, ch.output.minPercent),
    maxPercent: mix(ch.input.maxPercent, ch.output.maxPercent),
    basis: capBasis(
      `Input ${ch.input.minPercent}–${ch.input.maxPercent}% on ~${Math.round(w * 100)}% of cost, ` +
        `output ${ch.output.minPercent}–${ch.output.maxPercent}% on the rest ` +
        `(${applicable.length} technique(s): ${names}) on ${track} track`
    ),
    unit: "percent",
    appliesTo: "total",
  };
}

/**
 * Input share of spend for a profile: runtime input tokens (prefix + prompt) and output tokens,
 * output weighted by the median output/input price ratio of the catalog pricing. Falls back to
 * DEFAULT_INPUT_COST_SHARE when the profile has no LLM token averages.
 */
export function inputCostShare(profile: ProjectProfile | null | undefined, pricing: Pricing[] = []): number {
  const llm = profile?.llm;
  if (!llm?.avgPromptTokens || !llm.avgOutputTokens) return DEFAULT_INPUT_COST_SHARE;
  const ratios = pricing
    .filter((p) => p.inputPerMTok > 0)
    .map((p) => p.outputPerMTok / p.inputPerMTok)
    .sort((a, b) => a - b);
  const ratio = ratios.length > 0 ? ratios[Math.floor(ratios.length / 2)] : 4;
  const input = (llm.avgPrefixTokens ?? 0) + llm.avgPromptTokens;
  const output = llm.avgOutputTokens * ratio;
  return input / (input + output);
}

export const SavingsAggregator = {
  combine: combineSavings,
  aggregate(input: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    pricing: Pricing;
    strategies: Strategy[];
  }): AggregatedCost {
    const discounts = (strategy: Strategy): StrategyDiscounts => {
      const pct = (strategy.savings.minPercent + strategy.savings.maxPercent) / 2;
      const id = strategy.id.replaceAll("_", "-");
      if (id === "prompt-caching" || id === "cache-prefix-ordering") {
        const read = input.pricing.cachedInputPerMTok === undefined || input.pricing.inputPerMTok === 0
          ? 0
          : Math.max(0, (1 - input.pricing.cachedInputPerMTok / input.pricing.inputPerMTok) * 100);
        const write = input.pricing.cacheWriteMultiplier === undefined
          ? 0
          : (1 - input.pricing.cacheWriteMultiplier) * 100;
        return { inputDiscountPct: 0, outputDiscountPct: 0, cacheReadDiscountPct: read, cacheWriteDiscountPct: write };
      }
      if (["caveman-mode", "caveman-output", "max-output-cap", "terse-mode"].includes(id)) {
        return { inputDiscountPct: 0, outputDiscountPct: pct };
      }
      if (["filler-removal", "whitespace-normalize", "dedupe-sentences", "context-pruning"].includes(id)) {
        return { inputDiscountPct: pct, outputDiscountPct: 0 };
      }
      if (id === "model-routing") return { inputDiscountPct: pct, outputDiscountPct: pct };
      const affects = strategy.optimizer?.affects ?? strategy.savings.appliesTo;
      return {
        inputDiscountPct: affects === "output" ? 0 : pct,
        outputDiscountPct: affects === "input" ? 0 : pct,
      };
    };
    const applicable = input.strategies.filter((s) => s.targets.includes("runtime"));
    let inputRemaining = 1;
    let outputRemaining = 1;
    let readRemaining = 1;
    let writeRemaining = 1;
    for (const strategy of applicable) {
      const d = discounts(strategy);
      inputRemaining *= 1 - clampPct(d.inputDiscountPct);
      outputRemaining *= 1 - clampPct(d.outputDiscountPct);
      readRemaining *= 1 - clampPct(d.cacheReadDiscountPct ?? 0);
      writeRemaining *= 1 - clampPct(d.cacheWriteDiscountPct ?? 0);
    }
    const cached = Math.min(input.inputTokens, input.cachedInputTokens ?? 0);
    const writeTokens = Math.min(input.inputTokens - cached, input.cacheWriteTokens ?? 0);
    const regularTokens = input.inputTokens - cached - writeTokens;
    const cacheReadRate = input.pricing.cachedInputPerMTok ?? input.pricing.inputPerMTok;
    const cacheWriteRate = input.pricing.inputPerMTok * (input.pricing.cacheWriteMultiplier ?? 1);
    const before = (
      input.inputTokens * input.pricing.inputPerMTok +
      input.outputTokens * input.pricing.outputPerMTok
    ) / 1_000_000;
    const after = (
      regularTokens * input.pricing.inputPerMTok * inputRemaining +
      writeTokens * cacheWriteRate * writeRemaining +
      cached * cacheReadRate * readRemaining +
      input.outputTokens * input.pricing.outputPerMTok * outputRemaining
    ) / 1_000_000;
    const cacheReadSavingsUsd = (cached * (input.pricing.inputPerMTok - cacheReadRate * readRemaining)) / 1_000_000;
    return {
      effectiveInputTokens: Math.round(input.inputTokens * inputRemaining),
      effectiveOutputTokens: Math.round(input.outputTokens * outputRemaining),
      costBeforeUsd: before,
      costAfterUsd: after,
      inputSavingsPct: (1 - inputRemaining) * 100,
      outputSavingsPct: (1 - outputRemaining) * 100,
      cacheReadSavingsUsd,
    };
  },
};
