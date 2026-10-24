/**
 * Validates every golden fixture file under packages/fixtures/{optimizer,router} against the
 * frozen fixture schemas, so Track B/C/D cannot drift from the shared format.
 *
 * Exports: none (test suite)
 * Feature: prompt optimizer + model router (parity tests)
 */
import { describe, it, expect } from "vitest";
import { OptimizerFixtureCaseSchema, RouterFixtureCaseSchema } from "../../src/index.js";

// Vite's import.meta.glob (Vitest) keeps packages/core free of node:fs imports (typed in
// tests/vite-glob.d.ts).
const toCases = (mods: Record<string, unknown>) =>
  Object.entries(mods).map(([p, data]) => [p.split("/").pop() as string, data] as const);
const optimizerCases = toCases(
  import.meta.glob("../../../fixtures/optimizer/*.json", { eager: true, import: "default" })
);
const routerCases = toCases(
  import.meta.glob("../../../fixtures/router/*.json", { eager: true, import: "default" })
);

describe("golden fixture format", () => {
  const optimizer = optimizerCases;
  const router = routerCases;

  it("has at least two cases per suite", () => {
    expect(optimizer.length).toBeGreaterThanOrEqual(2);
    expect(router.length).toBeGreaterThanOrEqual(2);
  });

  it.each(optimizer)("optimizer/%s matches OptimizerFixtureCaseSchema", (file, data) => {
    const parsed = OptimizerFixtureCaseSchema.parse(data);
    expect(`${parsed.id}.json`).toBe(file);
  });

  it.each(router)("router/%s matches RouterFixtureCaseSchema", (file, data) => {
    const parsed = RouterFixtureCaseSchema.parse(data);
    expect(`${parsed.id}.json`).toBe(file);
  });
});
