/**
 * Router parity tests: runs every packages/fixtures/router/*.json case (shared with the Python
 * `ai_optimizer.router.route` pytest suite) through the TS RouterRules, plus reason/edge checks.
 *
 * Exports: none (test suite)
 * Feature: model router
 */
import { describe, it, expect } from "vitest";
import {
  RouterFixtureCaseSchema,
  evaluateComplexity,
  findAdvancedKeyword,
  presetToRouterConfig,
  routePrompt,
  TierRouter,
  type RouterConfig,
} from "../../src/index.js";

const cases = Object.entries(
  import.meta.glob("../../../fixtures/router/*.json", { eager: true, import: "default" })
).map(([p, data]) => [p.split("/").pop() as string, RouterFixtureCaseSchema.parse(data)] as const);

describe("RouterRules golden fixtures", () => {
  it("covers the Phase 0 cases and the Track D d-* cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(13);
    expect(cases.filter(([f]) => f.startsWith("d-")).length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases)("%s", (_file, c) => {
    const input = c.input.kind === "text" ? c.input.text : c.input.messages;
    const d = routePrompt(input, c.config, c.needsTools);
    expect({ tier: d.tier, model: d.model, provider: d.provider }).toEqual(c.expected);
    expect(d.reason.length).toBeGreaterThan(0);
  });
});

describe("RouterRules details", () => {
  const config = cases.find(([f]) => f === "short-text-economy.json")![1].config;

  it("explains the decision", () => {
    expect(routePrompt("Please analyze this", config).reason).toContain('"analyze"');
    expect(routePrompt("hi", config, true).reason).toContain("needs tools");
    const empty: RouterConfig = { ...config, tiers: { ...config.tiers, economy: [] } };
    expect(routePrompt("hi", empty).reason).toContain("tier economy is empty -> standard");
  });

  it("throws when every tier is empty", () => {
    const none: RouterConfig = { ...config, tiers: { economy: [], standard: [], advanced: [] } };
    expect(() => routePrompt("hi", none)).toThrow(/no candidate/);
  });

  it("matches keywords on ASCII word boundaries only", () => {
    expect(findAdvancedKeyword("re-debug it", ["debug"])).toBe("debug");
    expect(findAdvancedKeyword("debugging", ["debug"])).toBeNull();
    expect(findAdvancedKeyword("x", [""])).toBeNull();
  });

  it("routes concise code and reasoning prompts above economy", () => {
    const code = "```ts\n    const result = input => { return { value: result }; }\n```";
    expect(evaluateComplexity(code)).toBeGreaterThanOrEqual(3);
    expect(routePrompt(code, config).tier).toBe("standard");
    expect(routePrompt("Give a proof for this claim", config).tier).toBe("advanced");
  });

  it("routes long repetitive text to economy only when its context window fits", () => {
    const longRepetitive = "hello ".repeat(40);
    const economyWithContext: RouterConfig = {
      ...config,
      tiers: {
        ...config.tiers,
        economy: [{ ...config.tiers.economy[0]!, contextWindow: 1000 }],
      },
      rules: { ...config.rules, maxCharsForEconomy: 20 },
    };
    const economyWithoutContext: RouterConfig = {
      ...config,
      rules: { ...config.rules, maxCharsForEconomy: 20 },
    };
    expect(routePrompt(longRepetitive, economyWithContext).tier).toBe("economy");
    expect(routePrompt(longRepetitive, economyWithoutContext).tier).toBe(config.rules.defaultTier);
  });

  it("presetToRouterConfig copies tiers and rules", () => {
    const preset = { id: "p", label: "P", isDefault: true, version: 1, tiers: config.tiers, rules: config.rules };
    const cfg = presetToRouterConfig(preset);
    expect(cfg).toEqual({ presetId: "p", tiers: config.tiers, rules: config.rules });
    cfg.tiers.economy.pop();
    expect(preset.tiers.economy.length).toBe(config.tiers.economy.length);
    expect(new TierRouter(cfg).route("hi").tier).toBe("economy");
  });
});
