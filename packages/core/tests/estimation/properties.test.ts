/**
 * Tests: Estimation Property Tests (T076, FR-019, Principle IV, M2).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { estimate } from "../../src/estimation/EstimationEngine.js";
import { ProjectProfileSchema, type ProjectProfile } from "../../src/profile/schema.js";
import { CatalogSnapshotSchema } from "../../src/catalog/schemas.js";
import type { PhaseOverride } from "../../src/protocol/types.js";
import goldenProfileRaw from "../../../fixtures/profiles/ts-rag-chatbot.json";
import catalogSnapshotRaw from "../../../fixtures/catalog/catalog-snapshot.json";

describe("Estimation Property Tests (T076, FR-019, Principle IV, M2)", () => {
  const baseProfile: ProjectProfile = ProjectProfileSchema.parse(goldenProfileRaw);
  const catalog = CatalogSnapshotSchema.parse(catalogSnapshotRaw);

  it("Property (a): Monotonicity - increasing calls, retries, or volume never decreases cost", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 100, max: 4000 }),
        fc.integer({ min: 0, max: 3 }),
        fc.float({ min: 1.0, max: 3.0, noNaN: true }),
        (calls, tokensPerCall, retries, volMult) => {
          const overrides1: PhaseOverride[] = [
            {
              phaseId: "phase-query-answering",
              callsLow: calls,
              callsExpected: calls,
              callsHigh: calls * 2,
              tokensPerCallLow: tokensPerCall,
              tokensPerCallExpected: tokensPerCall,
              tokensPerCallHigh: tokensPerCall * 2,
              retriesExpected: retries,
              volumeMultiplierExpected: volMult,
            },
          ];

          const overrides2: PhaseOverride[] = [
            {
              phaseId: "phase-query-answering",
              callsLow: calls * 2,
              callsExpected: calls * 2,
              callsHigh: calls * 4,
              tokensPerCallLow: tokensPerCall,
              tokensPerCallExpected: tokensPerCall,
              tokensPerCallHigh: tokensPerCall * 2,
              retriesExpected: retries + 1,
              volumeMultiplierExpected: volMult * 1.5,
            },
          ];

          const est1 = estimate(baseProfile, catalog, overrides1);
          const est2 = estimate(baseProfile, catalog, overrides2);

          // For every model, scaling runtime volume parameters must result in cost2 >= cost1
          for (const model of catalog.models) {
            const cost1 = est1.runtime.totalByModel[model.id];
            const cost2 = est2.runtime.totalByModel[model.id];
            if (cost1 && cost2) {
              expect(cost2.expected).toBeGreaterThanOrEqual(cost1.expected);
              expect(cost2.high).toBeGreaterThanOrEqual(cost1.high);
              expect(cost2.low).toBeGreaterThanOrEqual(cost1.low);
            }
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("Property (b): Determinism - identical inputs produce identical outputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 500, max: 5000 }),
        fc.integer({ min: 0, max: 4 }),
        (calls, tokens, retries) => {
          const overrides: PhaseOverride[] = [
            {
              phaseId: "phase-implementation",
              callsLow: calls,
              callsExpected: calls,
              callsHigh: calls * 2,
              tokensPerCallLow: tokens,
              tokensPerCallExpected: tokens,
              tokensPerCallHigh: tokens * 2,
              retriesExpected: retries,
            },
          ];

          const run1 = estimate(baseProfile, catalog, overrides);
          const run2 = estimate(baseProfile, catalog, overrides);

          expect(run1).toEqual(run2);
          expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
        }
      ),
      { numRuns: 500 }
    );
  });

  it("Property (c): Sum of phases equals track total for all models with varied retries and volume", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 3 }),
        fc.float({ min: 1.0, max: 2.0, noNaN: true }),
        (callsArch, callsImpl, callsQuery, retries, volMult) => {
          const overrides: PhaseOverride[] = [
            {
              phaseId: "phase-architecture",
              callsLow: callsArch,
              callsExpected: callsArch,
              callsHigh: callsArch * 2,
              retriesExpected: retries,
            },
            {
              phaseId: "phase-implementation",
              callsLow: callsImpl,
              callsExpected: callsImpl,
              callsHigh: callsImpl * 2,
              retriesExpected: retries,
            },
            {
              phaseId: "phase-query-answering",
              callsLow: callsQuery,
              callsExpected: callsQuery,
              callsHigh: callsQuery * 2,
              retriesExpected: retries,
              volumeMultiplierExpected: volMult,
            },
          ];

          const res = estimate(baseProfile, catalog, overrides);

          for (const model of catalog.models) {
            // Build track verification
            const buildSum = res.build.phases.reduce((acc, p) => {
              return acc + (p.costByModel[model.id]?.expected ?? 0);
            }, 0);
            const buildTrackExpected = res.build.totalByModel[model.id]?.expected ?? 0;
            expect(Math.abs(buildTrackExpected - buildSum)).toBeLessThanOrEqual(0.0002);

            // Runtime track verification
            const runtimeSum = res.runtime.phases.reduce((acc, p) => {
              return acc + (p.costByModel[model.id]?.expected ?? 0);
            }, 0);
            const runtimeTrackExpected = res.runtime.totalByModel[model.id]?.expected ?? 0;
            expect(Math.abs(runtimeTrackExpected - runtimeSum)).toBeLessThanOrEqual(0.0002);
          }
        }
      ),
      { numRuns: 500 }
    );
  });

  it("Property (d): Scaling Linearity - doubling requestsPerDay exactly doubles monthly runtime cost", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 500 }),
        (reqPerDay) => {
          const profile1 = {
            ...baseProfile,
            scale: {
              ...baseProfile.scale!,
              requestsPerDay: reqPerDay,
            },
          };
          const profile2 = {
            ...baseProfile,
            scale: {
              ...baseProfile.scale!,
              requestsPerDay: reqPerDay * 2,
            },
          };

          const est1 = estimate(profile1, catalog);
          const est2 = estimate(profile2, catalog);

          for (const model of catalog.models) {
            const cost1 = est1.runtime.totalByModel[model.id]?.expected ?? 0;
            const cost2 = est2.runtime.totalByModel[model.id]?.expected ?? 0;
            // Linear scaling within rounding tolerance
            expect(Math.abs(cost2 - cost1 * 2)).toBeLessThanOrEqual(0.01);
          }
        }
      ),
      { numRuns: 500 }
    );
  });
});
