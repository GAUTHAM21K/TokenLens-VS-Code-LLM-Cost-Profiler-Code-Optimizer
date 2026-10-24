/**
 * Tests: Estimation Golden File Tests (T075, T077, FR-019, Principle IV, C1, M1).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import { estimate } from "../../src/estimation/EstimationEngine.js";
import { ProjectProfileSchema } from "../../src/profile/schema.js";
import { CatalogSnapshotSchema } from "../../src/catalog/schemas.js";
import { EstimationResultSchema } from "../../src/protocol/schemas.js";
import goldenProfileRaw from "../../../fixtures/profiles/ts-rag-chatbot.json";
import goldenEstimateRaw from "../../../fixtures/estimates/ts-rag-chatbot.json";
import catalogSnapshotRaw from "../../../fixtures/catalog/catalog-snapshot.json";

describe("Estimation Golden File Tests (T075, T077, FR-019, Principle IV, C1, M1)", () => {
  const profile = ProjectProfileSchema.parse(goldenProfileRaw);
  const catalog = CatalogSnapshotSchema.parse(catalogSnapshotRaw);

  it("produces valid estimation conforming to EstimationResultSchema", () => {
    const result = estimate(profile, catalog);
    const parsed = EstimationResultSchema.parse(result);
    expect(parsed.profileVersion).toBe(profile.profileVersion);
    expect(parsed.build.phases).toHaveLength(2);
    expect(parsed.runtime.phases).toHaveLength(1);
    expect(parsed.totalExpectedCost).toBeGreaterThan(0);
    expect(parsed.scaleMetrics).toBeDefined();
    expect(parsed.catalogVersion).toBe(catalog.version);
  });

  it("hand-computed sanity test: RAG chatbot at 250 req/day costs ~$55/mo runtime on Sonnet (C1 sanity)", () => {
    const result = estimate(profile, catalog);
    const sonnetRuntime = result.runtime.totalByModel["claude-3-5-sonnet-20241022"];
    expect(sonnetRuntime).toBeDefined();

    // Hand calculation:
    // 250 req/day * 22 days = 5,500 requests/month.
    // 1 call/req, 2000 tokens (750 reg in @ $3/M, 750 cached @ $0.3/M, 500 out @ $15/M)
    // = 5500 * (2.25 + 0.225 + 7.5) / 1000 = $54.86/month
    expect(sonnetRuntime.expected).toBeCloseTo(54.86, 1);

    // Total monthly cost (build + runtime) is ~$58.81/month, NOT $54,862!
    expect(result.totalExpectedCost).toBeGreaterThan(50);
    expect(result.totalExpectedCost).toBeLessThan(70);
  });

  it("matches golden file exactly (byte & numerical determinism)", () => {
    const actual = estimate(profile, catalog);
    expect(actual).toEqual(goldenEstimateRaw);
  });

  it("fails when a phase parameter changes (M1)", () => {
    // Mutate an actual parameter (callsExpected override), not a display name
    const parameterOverride = [
      {
        phaseId: "phase-query-answering",
        callsExpected: 2, // Doubling calls per request changes cost
      },
    ];

    const actual = estimate(profile, catalog, parameterOverride);
    expect(actual.totalExpectedCost).not.toEqual(goldenEstimateRaw.totalExpectedCost);
    expect(actual).not.toEqual(goldenEstimateRaw);
  });
});
