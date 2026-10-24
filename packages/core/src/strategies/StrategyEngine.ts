/**
 * Technique applicability and pre-selection for the estimator. Evaluates each approved technique's
 * `applicability` rule ({path, gte|lte|eq|in}; absent = always applicable) against a ProjectProfile,
 * pre-selects applicable techniques with a reason (catalog `reasonTemplate` or a generated one),
 * explains the ones left out, reports conflicts (ConflictResolver) and compounds savings
 * (SavingsAggregator). Pure and deterministic.
 *
 * Exports: ApplicabilityResult, StrategyChoice, StrategyEvaluation, getProfileValue,
 *   evaluateApplicability, evaluateStrategies, selectStrategies, StrategyEngine
 * Feature: token cost estimator (techniques savings)
 */
import type { Pricing, SavingsRange, Strategy } from "../protocol/types.js";
import type { ProjectProfile } from "../profile/schema.js";
import {
  combineSavings,
  combineSavingsByChannel,
  inputCostShare,
  type ChannelSavings,
} from "./SavingsAggregator.js";
import { findConflicts, type StrategyConflict } from "./ConflictResolver.js";

export interface ApplicabilityResult {
  applicable: boolean;
  /** Human-readable explanation of the outcome. */
  reason: string;
  /** Profile value at `path` (when the technique has a rule). */
  value?: unknown;
}

export interface StrategyChoice {
  strategyId: string;
  reason: string;
}

export interface StrategyEvaluation {
  selected: StrategyChoice[];
  notPreselected: StrategyChoice[];
  conflicts: StrategyConflict[];
  savings: { build: SavingsRange; runtime: SavingsRange };
  /** Per-channel savings (input techniques on input cost, output techniques on output cost). */
  channels: { build: ChannelSavings; runtime: ChannelSavings };
}

const OPS = ["gte", "lte", "eq", "in"] as const;
type Op = (typeof OPS)[number];
const OP_TEXT: Record<Op, string> = { gte: "≥", lte: "≤", eq: "=", in: "one of" };

/** Reads a dot path (e.g. "llm.avgPrefixTokens") from a profile; undefined when missing. */
export function getProfileValue(profile: unknown, path: string): unknown {
  let cur: unknown = profile;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function fmt(v: unknown): string {
  return Array.isArray(v) ? v.map(fmt).join(", ") : typeof v === "string" ? v : JSON.stringify(v);
}

/** Evaluates one technique's applicability rule against the profile. */
export function evaluateApplicability(strategy: Strategy, profile: ProjectProfile): ApplicabilityResult {
  const rule = strategy.applicability;
  if (!rule || Object.keys(rule).length === 0) {
    return { applicable: true, reason: "" };
  }
  const path = rule.path;
  const op = OPS.find((o) => o in rule);
  if (typeof path !== "string" || !path || !op) {
    return { applicable: false, reason: "Catalog applicability rule is malformed (needs path and gte|lte|eq|in)." };
  }
  const expected = rule[op];
  const value = getProfileValue(profile, path);
  if (value === undefined || value === null) {
    return { applicable: false, reason: `Profile has no value for ${path} (needs ${OP_TEXT[op]} ${fmt(expected)}).`, value };
  }

  let ok: boolean;
  switch (op) {
    case "gte":
      ok = typeof value === "number" && typeof expected === "number" && value >= expected;
      break;
    case "lte":
      ok = typeof value === "number" && typeof expected === "number" && value <= expected;
      break;
    case "eq":
      ok = value === expected;
      break;
    case "in":
      ok = Array.isArray(expected) && expected.includes(value);
      break;
  }
  const facts = `${path} = ${fmt(value)} (needs ${OP_TEXT[op]} ${fmt(expected)})`;
  return { applicable: ok, reason: ok ? facts : `Not applicable: ${facts}.`, value };
}

function savingsText(s: Strategy): string {
  const scope = s.savings.appliesTo && s.savings.appliesTo !== "total" ? ` ${s.savings.appliesTo}` : "";
  return `${s.savings.minPercent}–${s.savings.maxPercent}%${scope} tokens`;
}

/** Reason shown for a pre-selected technique: the catalog template, or a generated sentence. */
function preselectReason(s: Strategy, result: ApplicabilityResult): string {
  if (s.reasonTemplate) {
    return s.reasonTemplate
      .replace(/\{\{value\}\}/g, () => fmt(result.value))
      .replace(/\{\{name\}\}/g, () => s.name);
  }
  return result.reason
    ? `Applicable: ${result.reason}; saves ${savingsText(s)}.`
    : `No applicability rule; applies to every ${s.targets.join("/")} profile (saves ${savingsText(s)}).`;
}

function computeSavings(selected: Strategy[], profile: ProjectProfile | null, pricing: Pricing[]) {
  const share = inputCostShare(profile, pricing);
  return {
    savings: {
      build: combineSavings(selected, "build", share),
      runtime: combineSavings(selected, "runtime", share),
    },
    channels: {
      build: combineSavingsByChannel(selected, "build"),
      runtime: combineSavingsByChannel(selected, "runtime"),
    },
  };
}

/**
 * Pre-selects every approved, applicable technique. When two applicable techniques declare a
 * conflict, the one earlier in catalog order wins and the other is explained in notPreselected.
 */
export function evaluateStrategies(
  strategies: Strategy[],
  profile: ProjectProfile,
  pricing: Pricing[] = []
): StrategyEvaluation {
  const selected: Strategy[] = [];
  const choices: StrategyChoice[] = [];
  const notPreselected: StrategyChoice[] = [];
  const applicable: Strategy[] = [];

  for (const s of strategies) {
    if (s.reviewStatus !== "approved") {
      notPreselected.push({ strategyId: s.id, reason: `Not approved in the catalog (status: ${s.reviewStatus}).` });
      continue;
    }
    const result = evaluateApplicability(s, profile);
    if (!result.applicable) {
      notPreselected.push({ strategyId: s.id, reason: result.reason });
      continue;
    }
    applicable.push(s);
    const clash = selected.find((p) => p.conflicts?.includes(s.id) || s.conflicts?.includes(p.id));
    if (clash) {
      notPreselected.push({ strategyId: s.id, reason: `Applicable, but conflicts with ${clash.name}, which was pre-selected first.` });
      continue;
    }
    selected.push(s);
    choices.push({ strategyId: s.id, reason: preselectReason(s, result) });
  }

  return {
    selected: choices,
    notPreselected,
    conflicts: findConflicts(applicable, strategies),
    ...computeSavings(selected, profile, pricing),
  };
}

/**
 * Applies a user selection. Each selected id keeps its applicability reason (or "Selected by you"
 * with the reason it was not pre-selected); the rest are explained in notPreselected.
 * Throws on unknown or unapproved ids.
 */
export function selectStrategies(
  strategies: Strategy[],
  profile: ProjectProfile | null,
  selectedIds: string[],
  pricing: Pricing[] = []
): StrategyEvaluation {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const bad = selectedIds.filter((id) => byId.get(id)?.reviewStatus !== "approved");
  if (bad.length > 0) {
    throw new Error(`Unknown or unapproved technique id(s): ${bad.join(", ")}`);
  }
  const wanted = new Set(selectedIds);
  const selected = strategies.filter((s) => wanted.has(s.id));

  const reasonFor = (s: Strategy): ApplicabilityResult =>
    profile ? evaluateApplicability(s, profile) : { applicable: true, reason: "" };

  const choices = selected.map((s) => {
    const r = reasonFor(s);
    return {
      strategyId: s.id,
      reason: r.applicable ? preselectReason(s, r) : `Selected by you. ${r.reason}`,
    };
  });
  const notPreselected = strategies
    .filter((s) => !wanted.has(s.id))
    .map((s) => {
      if (s.reviewStatus !== "approved") {
        return { strategyId: s.id, reason: `Not approved in the catalog (status: ${s.reviewStatus}).` };
      }
      const r = reasonFor(s);
      return { strategyId: s.id, reason: r.applicable ? "Applicable, but not selected." : r.reason };
    });

  return {
    selected: choices,
    notPreselected,
    conflicts: findConflicts(selected, strategies),
    ...computeSavings(selected, profile, pricing),
  };
}

export const StrategyEngine = {
  evaluate: evaluateStrategies,
  select: selectStrategies,
  applicability: evaluateApplicability,
};
