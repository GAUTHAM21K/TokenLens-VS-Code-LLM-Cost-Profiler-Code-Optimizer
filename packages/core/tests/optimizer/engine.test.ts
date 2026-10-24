/**
 * Unit tests for the prompt optimizer engine: catalog ordering, param resolution, effective-date
 * pricing, and the full run (per-step tokens, $ per 1k calls, llm-compress success/failure).
 *
 * Exports: none (test suite)
 * Feature: prompt optimizer
 */
import { describe, it, expect, vi } from "vitest";
import {
  CatalogSnapshotSchema,
  CharApproxTokenizer,
  findActivePricing,
  pricingReferenceTime,
  orderTechniques,
  runPromptOptimization,
  techniqueParams,
  type PromptOptRunInput,
} from "../../src/index.js";

const snapshot = CatalogSnapshotSchema.parse(
  Object.values(
    import.meta.glob("../../resources/catalog-snapshot.json", { eager: true, import: "default" })
  )[0]
);

const base = (over: Partial<PromptOptRunInput> = {}): PromptOptRunInput => ({
  messages: [{ role: "user", content: "Could you please   summarize the report?\nPlease summarize the report." }],
  techniqueIds: ["dedupe-sentences", "filler-removal", "whitespace-normalize"],
  providerId: "groq",
  modelId: "openai/gpt-oss-20b",
  strategies: snapshot.strategies,
  pricing: snapshot.pricing,
  promptTemplates: snapshot.promptTemplates,
  at: "2026-10-12T12:00:00Z",
  ...over,
});
const tokenizer = new CharApproxTokenizer();

describe("orderTechniques / techniqueParams / pricing", () => {
  it("orders by catalog optimizer.order with llm-compress first", () => {
    expect(
      orderTechniques(["max-output-cap", "filler-removal", "llm-compress", "whitespace-normalize"], snapshot.strategies)
    ).toEqual(["llm-compress", "whitespace-normalize", "filler-removal", "max-output-cap"]);
  });

  it("config overrides catalog params", () => {
    expect(techniqueParams("max-output-cap", { strategies: snapshot.strategies }).maxTokens).toBe(512);
    expect(
      techniqueParams("max-output-cap", { strategies: snapshot.strategies, config: { "max-output-cap": { maxTokens: 64 } } })
        .maxTokens
    ).toBe(64);
  });

  it("never uses a future-dated price", () => {
    const p = [
      { ...snapshot.pricing[0]!, modelId: "m", inputPerMTok: 1, effectiveFrom: "2026-01-01T00:00:00Z" },
      { ...snapshot.pricing[0]!, modelId: "m", inputPerMTok: 2, effectiveFrom: "2026-06-01T00:00:00Z" },
      { ...snapshot.pricing[0]!, modelId: "m", inputPerMTok: 3, effectiveFrom: "2027-01-01T00:00:00Z" },
    ];
    expect(findActivePricing("m", p, "2026-10-12T00:00:00Z")?.inputPerMTok).toBe(2);
    expect(findActivePricing("m", p, "2025-01-01T00:00:00Z")).toBeNull();
    // One reference time for estimator, prompt optimizer and Enhance: the catalog's publishedAt.
    expect(pricingReferenceTime({ publishedAt: "2026-10-12T06:00:00Z" }, "x")).toBe("2026-10-12T06:00:00Z");
    expect(pricingReferenceTime({}, "2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
  });
});

describe("runPromptOptimization", () => {
  it("runs rules in catalog order with per-step tokens and cost", async () => {
    const { result, error } = await runPromptOptimization(base(), { tokenizer });
    expect(error).toBeUndefined();
    expect(result!.steps.map((s) => s.techniqueId)).toEqual(["whitespace-normalize", "filler-removal", "dedupe-sentences"]);
    expect(result!.steps[1]!.messagesAfter[0]!.content).toBe("Summarize the report?\nSummarize the report.");
    // Note: "?" vs "." keys are both "summarize the report" -> second line dropped.
    expect(result!.optimized.messages[0]!.content).toBe("Summarize the report?");
    for (let i = 1; i < result!.steps.length; i++) {
      expect(result!.steps[i]!.inputTokensBefore).toBe(result!.steps[i - 1]!.inputTokensAfter);
    }
    expect(result!.steps[0]!.inputTokensBefore).toBe(result!.original.inputTokens);
    expect(result!.optimized.inputTokens).toBeLessThan(result!.original.inputTokens);
    expect(result!.tokenLabel).toBe("approximate");
    const cost = result!.cost!;
    expect(cost.inputPerMTok).toBe(0.075);
    expect(cost.outputTokensBefore).toBe(500);
    expect(cost.outputTokensAfter).toBe(500);
    expect(cost.usdPer1kCallsBefore).toBeCloseTo((result!.original.inputTokens * 0.075 + 500 * 0.3) / 1000, 6);
    expect(cost.usdPer1kCallsAfter).toBeLessThan(cost.usdPer1kCallsBefore);
  });

  it("output techniques lower the assumed output tokens", async () => {
    const { result } = await runPromptOptimization(
      base({ techniqueIds: ["caveman-output", "max-output-cap"], expectedOutputTokens: 1000 }),
      { tokenizer }
    );
    // cap 512, then caveman midpoint (20-60% -> 40%) => 307
    expect(result!.optimized.params.max_tokens).toBe(512);
    expect(result!.cost!.outputTokensAfter).toBe(Math.round(512 * 0.6));
    expect(result!.optimized.messages[0]!.role).toBe("system");
  });

  it("omits cost when no pricing is effective", async () => {
    const { result } = await runPromptOptimization(base({ at: "2020-01-01T00:00:00Z" }), { tokenizer });
    expect(result!.cost).toBeUndefined();
  });

  it("llm-compress runs first through the completion function", async () => {
    const complete = vi.fn().mockResolvedValue({ content: "```\nSummarize report. Summarize report.\n```", inputTokens: 80, outputTokens: 9 });
    const { result, error } = await runPromptOptimization(
      base({ techniqueIds: ["dedupe-sentences", "llm-compress"] }),
      { tokenizer, complete }
    );
    expect(error).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(1);
    const sent = complete.mock.calls[0]![0] as Array<{ content: string }>;
    expect(sent[0]!.content).toContain("Could you please   summarize the report?");
    expect(sent[0]!.content).not.toContain("{{prompt}}");
    expect(result!.steps.map((s) => [s.techniqueId, s.mode])).toEqual([["llm-compress", "llm"], ["dedupe-sentences", "rule"]]);
    expect(result!.optimized.messages[0]!.content).toBe("Summarize report.");
    expect(result!.llmUsage).toEqual({ inputTokens: 80, outputTokens: 9, costUsd: Number(((80 * 0.075 + 9 * 0.3) / 1e6).toFixed(6)) });
  });

  it("llm failure still returns the rule-only result plus an error", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("HTTP 401"));
    const { result, error } = await runPromptOptimization(
      base({ techniqueIds: ["llm-compress", "filler-removal"] }),
      { tokenizer, complete }
    );
    expect(error).toEqual({ error: "llm-failed", message: "llm-compress failed: HTTP 401" });
    expect(result!.steps[0]).toMatchObject({ techniqueId: "llm-compress", applied: false, note: "Skipped: HTTP 401" });
    expect(result!.steps[1]!.applied).toBe(true);
    expect(result!.llmUsage).toBeUndefined();
  });

  it("llm-only failure returns no result", async () => {
    const { result, error } = await runPromptOptimization(base({ techniqueIds: ["llm-compress"] }), { tokenizer });
    expect(result).toBeUndefined();
    expect(error!.error).toBe("llm-failed");
  });

  it("rejects unknown techniques", async () => {
    const { result, error } = await runPromptOptimization(base({ techniqueIds: ["nope"] }), { tokenizer });
    expect(result).toBeUndefined();
    expect(error).toEqual({ error: "invalid-request", message: "Unknown technique(s): nope" });
  });
});
