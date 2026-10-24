/**
 * Rule-based model router, behaviourally identical to Python `ai_optimizer.router.route`
 * (parity enforced by packages/fixtures/router/*.json). Pure and deterministic.
 * Rules: advanced keyword (case-insensitive, ASCII whole word) -> "advanced"; else length (Unicode
 * code points of the contents joined with "\n") <= maxCharsForEconomy and no tools -> "economy";
 * else defaultTier; needsTools raises to at least needsToolsMinTier. The model is the first
 * candidate of the tier; an empty tier falls back upward (economy -> standard -> advanced), then
 * downward.
 *
 * Exports: RouterInput, ROUTER_TIERS, routerInputText, findAdvancedKeyword, routeTier, routePrompt,
 *   presetToRouterConfig, TierRouter
 * Feature: model router
 */
import type {
  PromptMessage,
  RouteDecision,
  RouterConfig,
  RouterPreset,
  RouterTier,
} from "../protocol/types.js";

/** Plain text, or chat messages (only `content` is measured). */
export type RouterInput = string | ReadonlyArray<Pick<PromptMessage, "content">>;

export const ROUTER_TIERS: readonly RouterTier[] = ["economy", "standard", "advanced"];

const REASONING_KEYWORDS = ["derive", "proof", "debug", "race condition", "memory leak", "ast"];

const rank = (t: RouterTier): number => ROUTER_TIERS.indexOf(t);

/** The routed text: the input string, or message contents joined with "\n". */
export function routerInputText(input: RouterInput): string {
  return typeof input === "string" ? input : input.map((m) => m.content).join("\n");
}

const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const isAsciiWord = (c: string | undefined): boolean => !!c && /[A-Za-z0-9_]/.test(c);

/** First keyword (in list order) found case-insensitively on ASCII word boundaries, else null. */
export function findAdvancedKeyword(text: string, keywords: readonly string[]): string | null {
  const hay = asciiLower(text);
  for (const kw of keywords) {
    const needle = asciiLower(kw);
    if (!needle) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      if (!isAsciiWord(hay[at - 1]) && !isAsciiWord(hay[at + needle.length])) return kw;
      from = at + 1;
    }
  }
  return null;
}

/** Higher scores indicate code-heavy, reasoning-intensive, or lexically diverse prompts. */
export function evaluateComplexity(text: string): number {
  let score = 0;
  const codeFenceCount = (text.match(/```/g) ?? []).length;
  const lines = text.split("\n");
  const indentedLines = lines.filter((line) => /^(?: {4,}|\t+)/.test(line)).length;
  const symbols = (text.match(/[{}]|=>/g) ?? []).length;
  const reasoningHits = REASONING_KEYWORDS.filter((keyword) =>
    findAdvancedKeyword(text, [keyword]) !== null
  ).length;
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const uniqueRatio = tokens.length === 0 ? 0 : new Set(tokens).size / tokens.length;

  if (codeFenceCount >= 2) score += 3;
  else if (codeFenceCount > 0) score += 2;
  if (indentedLines >= 3) score += 2;
  else if (indentedLines > 0) score += 1;
  if (symbols >= 8) score += 2;
  else if (symbols >= 3) score += 1;
  score += Math.min(6, reasoningHits * 2);
  if (tokens.length >= 12 && uniqueRatio >= 0.72) score += 2;
  return score;
}

/** Tier + human-readable reason for a text under `config.rules`. */
export function routeTier(
  text: string,
  config: RouterConfig,
  needsTools = false
): { tier: RouterTier; reason: string } {
  const { rules } = config;
  const length = [...text].length;
  const complexity = evaluateComplexity(text);
  let tier: RouterTier;
  let reason: string;
  const keyword = findAdvancedKeyword(text, rules.advancedKeywords);
  const highReasoningKeyword = findAdvancedKeyword(text, REASONING_KEYWORDS);
  if (keyword !== null || highReasoningKeyword !== null || complexity >= 7) {
    tier = "advanced";
    reason = keyword !== null || highReasoningKeyword !== null
      ? `advanced keyword "${keyword ?? highReasoningKeyword}"`
      : `high complexity score ${complexity}`;
  } else if (complexity >= 3) {
    tier = "standard";
    reason = `complexity score ${complexity} -> at least standard`;
  } else if (
    length > rules.maxCharsForEconomy &&
    highReasoningKeyword === null &&
    repetitiveText(text) &&
    (config.tiers.economy[0]?.contextWindow ?? 0) >= Math.ceil(length / 4) &&
    !needsTools
  ) {
    tier = "economy";
    reason = `long repetitive prompt fits economy context (${Math.ceil(length / 4)} estimated tokens)`;
  } else if (length <= rules.maxCharsForEconomy && !needsTools) {
    tier = "economy";
    reason = `short prompt (${length} <= ${rules.maxCharsForEconomy} chars)`;
  } else {
    tier = rules.defaultTier;
    reason =
      length > rules.maxCharsForEconomy
        ? `long prompt (${length} > ${rules.maxCharsForEconomy} chars) -> default tier`
        : "needs tools -> default tier";
  }
  if (needsTools && rank(tier) < rank(rules.needsToolsMinTier)) {
    tier = rules.needsToolsMinTier;
    reason += `; needs tools -> at least ${rules.needsToolsMinTier}`;
  }
  return { tier, reason };
}

function repetitiveText(text: string): boolean {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  return tokens.length >= 20 && new Set(tokens).size / tokens.length <= 0.35;
}

/** Tier search order for an empty tier: itself, then upward, then downward. */
function fallbackOrder(tier: RouterTier): RouterTier[] {
  const i = rank(tier);
  return [tier, ...ROUTER_TIERS.slice(i + 1), ...ROUTER_TIERS.slice(0, i).reverse()];
}

/** Full routing decision. Throws when every tier is empty. */
export function routePrompt(
  input: RouterInput,
  config: RouterConfig,
  needsTools = false
): RouteDecision {
  const { tier, reason } = routeTier(routerInputText(input), config, needsTools);
  for (const t of fallbackOrder(tier)) {
    const candidate = config.tiers[t][0];
    if (candidate) {
      return {
        model: candidate.modelId,
        provider: candidate.providerId,
        tier: t,
        reason: (t === tier ? reason : `${reason}; tier ${tier} is empty -> ${t}`).slice(0, 500),
      };
    }
  }
  throw new Error("Router config has no candidate models in any tier");
}

/** RouterConfig (the exported `router_config.json` shape) from a catalog preset. */
export function presetToRouterConfig(preset: RouterPreset): RouterConfig {
  return {
    presetId: preset.id,
    tiers: {
      economy: preset.tiers.economy.map((c) => ({ ...c })),
      standard: preset.tiers.standard.map((c) => ({ ...c })),
      advanced: preset.tiers.advanced.map((c) => ({ ...c })),
    },
    rules: { ...preset.rules, advancedKeywords: [...preset.rules.advancedKeywords] },
  };
}

/** Object wrapper over a fixed config (convenience for hosts). */
export class TierRouter {
  constructor(readonly config: RouterConfig) {}

  route(input: RouterInput, needsTools = false): RouteDecision {
    return routePrompt(input, this.config, needsTools);
  }
}
