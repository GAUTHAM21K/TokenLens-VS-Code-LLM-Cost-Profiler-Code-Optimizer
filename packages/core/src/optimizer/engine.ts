/**
 * Prompt optimizer engine: resolves technique params from the catalog (`optimizer.params`,
 * overridable by `config`), orders techniques by catalog `optimizer.order`, runs rule techniques
 * over text or requests, and runs the whole `promptopt/run` pipeline (optional `llm-compress`
 * through an injected completion function, per-step token counts, $ per 1k calls).
 *
 * Exports: OptimizerConfig, TechniqueOptions, techniqueParams, orderTechniques, optimizeText,
 *   optimizeRequest, PromptOptRunInput, PromptOptRunDeps, PromptOptRunOutcome,
 *   PromptOptResultPayload, runPromptOptimization, DEFAULT_EXPECTED_OUTPUT_TOKENS
 * Feature: prompt optimizer
 */
import type { ChatMessage, CompletionResult } from "../providers/ProviderAdapter.js";
import { findActivePricing } from "../estimation/EstimationEngine.js";
import type { Tokenizer } from "../estimation/TokenizerLayer.js";
import type {
  Pricing,
  PromptMessage,
  PromptOptCost,
  PromptOptStep,
  PromptParams,
  PromptTemplate,
  Strategy,
} from "../protocol/types.js";
import { RULE_TECHNIQUES, type OptimizerRequest, type RuleParams } from "./rules.js";

/** Per-technique param overrides, keyed by technique id. */
export type OptimizerConfig = Record<string, Record<string, unknown>>;

export interface TechniqueOptions {
  strategies?: Strategy[];
  config?: OptimizerConfig;
}

export const DEFAULT_EXPECTED_OUTPUT_TOKENS = 500;

/** Catalog `optimizer.params` for `id`, shallow-overridden by `config[id]`. */
export function techniqueParams(id: string, opts: TechniqueOptions = {}): RuleParams {
  const strategy = opts.strategies?.find((s) => s.id === id);
  return { ...(strategy?.optimizer?.params ?? {}), ...(opts.config?.[id] ?? {}) };
}

/** Sorts ids by catalog `optimizer.order` (stable; ids without an order keep their place last). */
export function orderTechniques(ids: string[], strategies: Strategy[]): string[] {
  const orderOf = (id: string) =>
    strategies.find((s) => s.id === id)?.optimizer?.order ?? Number.MAX_SAFE_INTEGER;
  return ids
    .map((id, i) => ({ id, i }))
    .sort((a, b) => orderOf(a.id) - orderOf(b.id) || a.i - b.i)
    .map((x) => x.id);
}

function ruleOf(id: string) {
  const rule = RULE_TECHNIQUES[id];
  if (!rule) throw new Error(`Unknown rule technique: ${id}`);
  return rule;
}

/** Runs rule techniques over a text in the given (list) order. */
export function optimizeText(text: string, techniqueIds: string[], opts: TechniqueOptions = {}): string {
  return techniqueIds.reduce((t, id) => ruleOf(id).text(t, techniqueParams(id, opts)), text);
}

/** Runs rule techniques over {messages, params} in the given (list) order. */
export function optimizeRequest(
  req: OptimizerRequest,
  techniqueIds: string[],
  opts: TechniqueOptions = {}
): OptimizerRequest {
  const start: OptimizerRequest = {
    messages: req.messages.map((m) => ({ ...m })),
    params: { ...req.params },
  };
  const preserveSystemPrefix = techniqueIds.includes("cache-prefix-ordering");
  return techniqueIds.reduce((r, id) => {
    const next = ruleOf(id).request(r, techniqueParams(id, opts), preserveSystemPrefix);
    if (!preserveSystemPrefix) return next;
    let systemIndex = 0;
    const originalSystems = r.messages.filter((m) => m.role === "system");
    return {
      ...next,
      messages: next.messages.map((m) => {
        if (m.role !== "system" || systemIndex >= originalSystems.length) return m;
        return { ...m, content: originalSystems[systemIndex++]!.content };
      }),
    };
  }, start);
}

// ─── full run (promptopt/run → promptopt/result) ────────────────────────────

export interface PromptOptRunInput {
  messages: PromptMessage[];
  params?: PromptParams;
  techniqueIds: string[];
  providerId: string;
  modelId: string;
  expectedOutputTokens?: number;
  strategies: Strategy[];
  pricing: Pricing[];
  promptTemplates: PromptTemplate[];
  /** Reference time for effective-date pricing (ISO 8601). */
  at: string;
  config?: OptimizerConfig;
}

export interface PromptOptRunDeps {
  tokenizer: Tokenizer;
  /** Completion through the selected model's adapter; required only for `llm` techniques. */
  complete?: (messages: ChatMessage[]) => Promise<CompletionResult>;
}

export interface PromptOptResultPayload {
  original: { messages: PromptMessage[]; params: PromptParams; inputTokens: number };
  optimized: { messages: PromptMessage[]; params: PromptParams; inputTokens: number };
  steps: PromptOptStep[];
  tokenLabel: "exact" | "approximate";
  cost?: PromptOptCost;
  llmUsage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface PromptOptRunOutcome {
  /** Absent only when nothing could run (e.g. only an llm technique was selected and it failed). */
  result?: PromptOptResultPayload;
  error?: { error: "invalid-request" | "no-model" | "llm-failed"; message: string };
}

function fillTemplate(template: string, prompt: string): string {
  return template.replace(/\{\{\s*prompt\s*\}\}/g, () => prompt);
}

function sameRequest(a: OptimizerRequest, b: OptimizerRequest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Strips a wrapping ``` fence some models add around the rewritten prompt. */
function unfence(text: string): string {
  const m = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(text.trim());
  return (m ? m[1] : text).trim();
}

const round6 = (n: number) => Number(n.toFixed(6));

/**
 * Runs the selected techniques in catalog order. `llm` techniques rewrite each non-empty
 * system/user message with the technique's prompt template (one completion per message).
 * An `llm` failure is reported in `error` while the rule techniques still run.
 */
export async function runPromptOptimization(
  input: PromptOptRunInput,
  deps: PromptOptRunDeps
): Promise<PromptOptRunOutcome> {
  const { strategies } = input;
  const unknown = input.techniqueIds.filter((id) => {
    const s = strategies.find((x) => x.id === id);
    return !s?.optimizer || (s.optimizer.mode === "rule" && !RULE_TECHNIQUES[s.optimizer.ruleId ?? id]);
  });
  if (unknown.length > 0) {
    return { error: { error: "invalid-request", message: `Unknown technique(s): ${unknown.join(", ")}` } };
  }

  let labelExact = true;
  const countReq = (req: OptimizerRequest): number =>
    req.messages.reduce((sum, m) => {
      const r = deps.tokenizer.count(m.content);
      if (r.label !== "exact") labelExact = false;
      return sum + r.count;
    }, 0);

  const original: OptimizerRequest = {
    messages: input.messages.map((m) => ({ ...m })),
    params: { ...(input.params ?? {}) },
  };
  const originalTokens = countReq(original);
  let current = original;
  let currentTokens = originalTokens;
  const steps: PromptOptStep[] = [];
  let error: PromptOptRunOutcome["error"];
  let llmUsage: PromptOptResultPayload["llmUsage"];
  let ranAny = false;
  const preserveSystemPrefix = input.techniqueIds.includes("cache-prefix-ordering");

  for (const id of orderTechniques(input.techniqueIds, strategies)) {
    const opt = strategies.find((s) => s.id === id)!.optimizer!;
    let next = current;
    let note: string | undefined;
    if (opt.mode === "rule") {
      next = RULE_TECHNIQUES[opt.ruleId ?? id]!.request(
        current,
        techniqueParams(id, input),
        preserveSystemPrefix
      );
      if (preserveSystemPrefix) {
        let systemIndex = 0;
        const originalSystems = current.messages.filter((m) => m.role === "system");
        next = {
          ...next,
          messages: next.messages.map((m) => {
            if (m.role !== "system" || systemIndex >= originalSystems.length) return m;
            return { ...m, content: originalSystems[systemIndex++]!.content };
          }),
        };
      }
      ranAny = true;
    } else {
      const template = input.promptTemplates.find((t) => t.id === opt.promptTemplateId && t.active !== false);
      try {
        if (!template) throw new Error(`prompt template "${opt.promptTemplateId}" is not in the catalog`);
        if (!deps.complete) throw new Error("no model adapter is available");
        let inTok = 0;
        let outTok = 0;
        const messages: PromptMessage[] = [];
        for (const m of current.messages) {
          if (m.role === "assistant" || m.content.trim() === "" || (preserveSystemPrefix && m.role === "system")) {
            messages.push({ ...m });
            continue;
          }
          const res = await deps.complete([{ role: "user", content: fillTemplate(template.template, m.content) }]);
          const rewritten = unfence(res.content ?? "");
          if (!rewritten) throw new Error("the model returned an empty rewrite");
          inTok += res.inputTokens ?? 0;
          outTok += res.outputTokens ?? 0;
          messages.push({ role: m.role, content: rewritten });
        }
        next = { messages, params: { ...current.params } };
        llmUsage = { inputTokens: inTok, outputTokens: outTok, costUsd: 0 };
        ranAny = true;
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        error = { error: "llm-failed", message: `${id} failed: ${reason}`.slice(0, 500) };
        note = `Skipped: ${reason}`.slice(0, 500);
      }
    }
    const nextTokens = next === current ? currentTokens : countReq(next);
    steps.push({
      techniqueId: id,
      mode: opt.mode,
      applied: !sameRequest(current, next),
      messagesAfter: next.messages.map((m) => ({ ...m })),
      paramsAfter: { ...next.params },
      inputTokensBefore: currentTokens,
      inputTokensAfter: nextTokens,
      ...(note ? { note } : {}),
    });
    current = next;
    currentTokens = nextTokens;
  }

  if (!ranAny) return { error };

  const result: PromptOptResultPayload = {
    original: { ...original, inputTokens: originalTokens },
    optimized: { messages: current.messages, params: current.params, inputTokens: currentTokens },
    steps,
    tokenLabel: labelExact ? "exact" : "approximate",
  };

  const price = findActivePricing(input.modelId, input.pricing, input.at);
  if (price) {
    const expected = input.expectedOutputTokens ?? DEFAULT_EXPECTED_OUTPUT_TOKENS;
    const outBefore = Math.min(expected, original.params.max_tokens ?? expected);
    let outAfter = Math.min(outBefore, current.params.max_tokens ?? outBefore);
    // Output-only techniques without a hard cap (caveman-output) use the catalog savings midpoint.
    for (const id of input.techniqueIds) {
      const s = strategies.find((x) => x.id === id);
      if (!s?.optimizer || s.optimizer.affects === "input" || id === "max-output-cap") continue;
      const mid = (s.savings.minPercent + s.savings.maxPercent) / 2;
      outAfter = Math.round(outAfter * (1 - mid / 100));
    }
    const per1k = (inTok: number, outTok: number) =>
      round6(((inTok * price.inputPerMTok + outTok * price.outputPerMTok) / 1_000_000) * 1000);
    result.cost = {
      providerId: input.providerId,
      modelId: input.modelId,
      inputPerMTok: price.inputPerMTok,
      outputPerMTok: price.outputPerMTok,
      outputTokensBefore: outBefore,
      outputTokensAfter: outAfter,
      usdPer1kCallsBefore: per1k(originalTokens, outBefore),
      usdPer1kCallsAfter: per1k(currentTokens, outAfter),
    };
    if (llmUsage) {
      llmUsage.costUsd = round6(
        (llmUsage.inputTokens * price.inputPerMTok + llmUsage.outputTokens * price.outputPerMTok) / 1_000_000
      );
    }
  }
  if (llmUsage) result.llmUsage = llmUsage;
  return { result, ...(error ? { error } : {}) };
}
