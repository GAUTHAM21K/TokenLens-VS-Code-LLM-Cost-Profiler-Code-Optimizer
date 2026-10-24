/**
 * Tests: StrategyEngine (applicability paths, pre-selection reasons, conflicts, savings) and
 * ConflictResolver, against the bundled catalog techniques and synthetic ones.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator (techniques savings)
 */
import { describe, it, expect } from "vitest";
import {
  evaluateApplicability,
  evaluateStrategies,
  getProfileValue,
  selectStrategies,
} from "../../src/strategies/StrategyEngine.js";
import { findConflicts } from "../../src/strategies/ConflictResolver.js";
import { combineSavings, combineSavingsByChannel, inputCostShare } from "../../src/strategies/SavingsAggregator.js";
import { ProjectProfileSchema, type ProjectProfile } from "../../src/profile/schema.js";
import type { Strategy } from "../../src/protocol/types.js";
import snapshot from "../../resources/catalog-snapshot.json";
import profileFixture from "../../../fixtures/profiles/ts-rag-chatbot.json";

const catalog = snapshot.strategies as Strategy[];
const baseProfile = ProjectProfileSchema.parse(profileFixture);

function withLlm(patch: Partial<ProjectProfile["llm"]>): ProjectProfile {
  return { ...baseProfile, llm: { ...baseProfile.llm, ...patch } };
}

function tech(id: string, extra: Partial<Strategy> = {}): Strategy {
  return {
    id,
    name: id.toUpperCase(),
    group: "test",
    targets: ["runtime"],
    summary: "",
    savings: { minPercent: 10, maxPercent: 20, basis: "test" },
    reviewStatus: "approved",
    reviewedBy: "Tester",
    reviewedAt: "2026-10-12T00:00:00Z",
    ...extra,
  };
}

describe("getProfileValue", () => {
  it("reads nested dot paths and returns undefined for missing ones", () => {
    expect(getProfileValue(baseProfile, "llm.avgPrefixTokens")).toBe(1500);
    expect(getProfileValue(baseProfile, "scale.requestsPerDay")).toBe(250);
    expect(getProfileValue(baseProfile, "llm.nope.deeper")).toBeUndefined();
  });
});

describe("evaluateApplicability", () => {
  it("treats an absent rule as applicable", () => {
    expect(evaluateApplicability(tech("a"), baseProfile).applicable).toBe(true);
  });

  it("supports gte / lte / eq / in", () => {
    const p = baseProfile;
    expect(evaluateApplicability(tech("g", { applicability: { path: "llm.avgPromptTokens", gte: 1800 } }), p).applicable).toBe(true);
    expect(evaluateApplicability(tech("g", { applicability: { path: "llm.avgPromptTokens", gte: 1801 } }), p).applicable).toBe(false);
    expect(evaluateApplicability(tech("l", { applicability: { path: "llm.avgOutputTokens", lte: 600 } }), p).applicable).toBe(true);
    expect(evaluateApplicability(tech("l", { applicability: { path: "llm.avgOutputTokens", lte: 599 } }), p).applicable).toBe(false);
    expect(evaluateApplicability(tech("e", { applicability: { path: "llm.usesRag", eq: true } }), p).applicable).toBe(true);
    expect(evaluateApplicability(tech("e", { applicability: { path: "projectType", eq: "agent" } }), p).applicable).toBe(false);
    expect(evaluateApplicability(tech("i", { applicability: { path: "projectType", in: ["rag-chatbot", "agent"] } }), p).applicable).toBe(true);
    expect(evaluateApplicability(tech("i", { applicability: { path: "projectType", in: ["agent"] } }), p).applicable).toBe(false);
  });

  it("is not applicable when the profile lacks the path, and explains why", () => {
    const r = evaluateApplicability(
      tech("x", { applicability: { path: "llm.avgConversationTurns", gte: 3 } }),
      baseProfile
    );
    expect(r.applicable).toBe(false);
    expect(r.reason).toContain("no value for llm.avgConversationTurns");
  });

  it("rejects malformed rules", () => {
    const r = evaluateApplicability(tech("m", { applicability: { path: "llm.usesRag" } }), baseProfile);
    expect(r.applicable).toBe(false);
    expect(r.reason).toMatch(/malformed/);
  });
});

describe("evaluateStrategies (bundled catalog)", () => {
  it("pre-selects every applicable technique with reasonTemplate values filled in", () => {
    const ev = evaluateStrategies(catalog, baseProfile);
    const ids = ev.selected.map((s) => s.strategyId);
    expect(ids).toContain("filler-removal");
    expect(ids).toContain("cache-prefix-ordering");
    expect(ev.notPreselected).toEqual([]);
    const cache = ev.selected.find((s) => s.strategyId === "cache-prefix-ordering")!;
    expect(cache.reason).toBe("Shared prefix of 1500 tokens qualifies for prompt caching.");
    const ws = ev.selected.find((s) => s.strategyId === "whitespace-normalize")!;
    expect(ws.reason).toMatch(/No applicability rule; applies to every runtime profile/);
  });

  it("explains techniques whose rule fails", () => {
    const ev = evaluateStrategies(catalog, withLlm({ avgPrefixTokens: 200, avgPromptTokens: 100 }));
    const ids = ev.selected.map((s) => s.strategyId);
    expect(ids).not.toContain("cache-prefix-ordering");
    expect(ids).not.toContain("filler-removal");
    const cache = ev.notPreselected.find((s) => s.strategyId === "cache-prefix-ordering")!;
    expect(cache.reason).toBe("Not applicable: llm.avgPrefixTokens = 200 (needs ≥ 1024).");
  });

  it("computes savings with SavingsAggregator over the pre-selected set", () => {
    const ev = evaluateStrategies(catalog, baseProfile);
    const chosen = catalog.filter((s) => ev.selected.some((c) => c.strategyId === s.id));
    expect(ev.savings.runtime).toEqual(combineSavings(chosen, "runtime", inputCostShare(baseProfile)));
    expect(ev.channels.runtime).toEqual(combineSavingsByChannel(chosen, "runtime"));
    expect(ev.savings.build.maxPercent).toBe(0);
    expect(ev.savings.runtime.maxPercent).toBeGreaterThan(0);
    expect(ev.savings.runtime.maxPercent).toBeLessThan(100);
  });

  it("skips unapproved techniques with a reason", () => {
    const ev = evaluateStrategies([tech("a"), tech("d", { reviewStatus: "draft" })], baseProfile);
    expect(ev.selected.map((s) => s.strategyId)).toEqual(["a"]);
    expect(ev.notPreselected[0]).toEqual({ strategyId: "d", reason: "Not approved in the catalog (status: draft)." });
  });

  it("keeps the first of two conflicting applicable techniques and reports the conflict", () => {
    const list = [tech("a", { conflicts: ["b"] }), tech("b"), tech("c")];
    const ev = evaluateStrategies(list, baseProfile);
    expect(ev.selected.map((s) => s.strategyId)).toEqual(["a", "c"]);
    expect(ev.notPreselected[0].strategyId).toBe("b");
    expect(ev.notPreselected[0].reason).toMatch(/conflicts with A/);
    expect(ev.conflicts).toEqual([{ a: "a", b: "b", explanation: expect.stringContaining("A conflicts with B") }]);
  });
});

describe("selectStrategies", () => {
  it("applies a user selection with reasons, conflicts and recomputed savings", () => {
    const list = [tech("a", { conflicts: ["b"] }), tech("b"), tech("c", { applicability: { path: "llm.usesAgents", eq: true } })];
    const ev = selectStrategies(list, baseProfile, ["a", "b", "c"]);
    expect(ev.selected.map((s) => s.strategyId)).toEqual(["a", "b", "c"]);
    expect(ev.selected[2].reason).toMatch(/^Selected by you\. Not applicable: llm.usesAgents = false/);
    expect(ev.conflicts).toHaveLength(1);
    expect(ev.savings.runtime).toEqual(combineSavings(list, "runtime", inputCostShare(baseProfile)));
    expect(selectStrategies(list, baseProfile, []).savings.runtime.maxPercent).toBe(0);
  });

  it("explains unselected techniques", () => {
    const ev = selectStrategies([tech("a"), tech("b")], baseProfile, ["a"]);
    expect(ev.notPreselected).toEqual([{ strategyId: "b", reason: "Applicable, but not selected." }]);
  });

  it("rejects unknown or unapproved ids", () => {
    expect(() => selectStrategies([tech("a")], baseProfile, ["zzz"])).toThrow(/zzz/);
    expect(() => selectStrategies([tech("d", { reviewStatus: "draft" })], null, ["d"])).toThrow(/d/);
  });
});

describe("ConflictResolver", () => {
  it("reports a declared conflict once even when both sides declare it", () => {
    const out = findConflicts([tech("a", { conflicts: ["b"] }), tech("b", { conflicts: ["a"] })]);
    expect(out).toHaveLength(1);
  });

  it("reports unmet requires", () => {
    const all = [tech("a", { requires: ["b"] }), tech("b")];
    expect(findConflicts([all[0]], all)).toEqual([
      { a: "a", b: "b", explanation: "A requires B, which is not selected." },
    ]);
    expect(findConflicts(all, all)).toEqual([]);
  });
});
