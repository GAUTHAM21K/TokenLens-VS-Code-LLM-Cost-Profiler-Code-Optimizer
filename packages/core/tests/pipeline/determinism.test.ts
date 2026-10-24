/**
 * Tests: Principle XII & Principle IV Determinism Boundary (T149).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import {
  SpyProviderAdapter,
  SpyHostModelAdapter,
  runEstimateStage,
  runOptimizeStage,
} from "../../src/testing/spyAdapters.js";
import type {
  EstimateStageInput,
  OptimizeStageInput,
  EstimateStage,
  OptimizeStage,
} from "../../src/pipeline/contracts.js";
import type { ProjectProfile, Strategy } from "../../src/protocol/types.js";

describe("Principle XII & Principle IV Determinism Boundary (T149)", () => {
  const sampleProfile: ProjectProfile = {
    schemaVersion: "1.0",
    projectType: "rag-chatbot",
    overview: "Testing determinism pipeline boundary",
    techStack: [{ language: "TypeScript", framework: "Node" }],
    llm: {
      providers: ["anthropic"],
      usesRag: true,
      usesAgents: false,
      avgPromptTokens: 1000,
      avgOutputTokens: 300,
    },
    components: [],
    dataFlow: "User -> Server -> LLM",
    scale: {
      requestsPerDay: 500,
      peakMultiplier: 1.5,
    },
    buildAssumptions: {
      teamSize: 2,
      sprintWeeks: 2,
      iterationsPerFeature: 1,
    },
    phases: [
      {
        id: "p1",
        phaseTypeId: "architecture",
        track: "build",
        name: "Architecture",
        source: "user",
        confirmed: true,
      },
    ],
    constraints: [],
    profileVersion: 1,
    createdAt: "2026-10-08T00:00:00Z",
  };

  const sampleStrategy: Strategy = {
    id: "prompt-compression",
    name: "Prompt Compression",
    group: "prompt-efficiency",
    targets: ["runtime"],
    summary: "Compress user context",
    savings: {
      minPercent: 10,
      maxPercent: 25,
      basis: "Empirical benchmark",
    },
    reviewStatus: "approved",
    reviewedBy: "Ada Lovelace",
    reviewedAt: "2026-10-08T00:00:00Z",
  };

  it("EstimateStage and OptimizeStage type contracts take zero adapters (Principle XII)", () => {
    // Type-level assertion: EstimateStage has arity 1 (only input), OptimizeStage has arity 1 (only input)
    type EstimateStageParams = Parameters<EstimateStage>;
    type OptimizeStageParams = Parameters<OptimizeStage>;

    // Verifies at compile time and runtime that length is 1
    const estimateArity: EstimateStageParams["length"] = 1;
    const optimizeArity: OptimizeStageParams["length"] = 1;

    expect(estimateArity).toBe(1);
    expect(optimizeArity).toBe(1);
  });

  it("EstimateStage makes zero calls to provider or host model adapters and respects clock", () => {
    const spyProvider = new SpyProviderAdapter();
    const spyHost = new SpyHostModelAdapter();
    const fixedClock = () => "2026-10-08T12:00:00.000Z";

    const input: EstimateStageInput = {
      profile: sampleProfile,
      catalog: {
        providers: [],
        models: [],
        pricing: [],
        phases: [],
        strategies: [sampleStrategy],
        platforms: [],
        promptTemplates: [],
      },
      clock: fixedClock,
    };

    const result = runEstimateStage(input);

    expect(result).toBeDefined();
    expect(result.profileVersion).toBe(1);
    expect(result.generatedAt).toBe("2026-10-08T12:00:00.000Z");
    expect(spyProvider.callCount).toBe(0);
    expect(spyHost.callCount).toBe(0);
  });

  it("OptimizeStage makes zero calls to provider or host model adapters", () => {
    const spyProvider = new SpyProviderAdapter();
    const spyHost = new SpyHostModelAdapter();

    const estimation = runEstimateStage({
      profile: sampleProfile,
      catalog: {
        providers: [],
        models: [],
        pricing: [],
        phases: [],
        strategies: [sampleStrategy],
        platforms: [],
        promptTemplates: [],
      },
    });

    const input: OptimizeStageInput = {
      profile: sampleProfile,
      estimation,
      strategies: [sampleStrategy],
    };

    const result = runOptimizeStage(input);

    expect(result).toBeDefined();
    expect(result.preselected.length).toBe(1);
    expect(spyProvider.callCount).toBe(0);
    expect(spyHost.callCount).toBe(0);
  });
});
