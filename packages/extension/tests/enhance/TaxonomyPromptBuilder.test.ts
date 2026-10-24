/**
 * Tests: TaxonomyPromptBuilder Unit & Snapshot Tests (Budget-Driven Ladder).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import {
  TaxonomyPromptBuilder,
  type BuildTaxonomyPromptOptions,
} from "../../src/enhance/TaxonomyPromptBuilder.js";
import type { Phase } from "@token-optimizer/core";

const mockCatalogPhases: Phase[] = [
  {
    id: "architecture",
    name: "Architecture & Scaffolding",
    track: "build",
    sortOrder: 1,
    description:
      "Scaffolds initial project structure, tech stack definitions, and repository setup.",
    shortDescription: "Scaffolding and initial repository setup",
    archetypes: ["general"],
    defaultParams: {
      callsLow: 1,
      callsExpected: 2,
      callsHigh: 5,
      tokensPerCallLow: 100,
      tokensPerCallExpected: 500,
      tokensPerCallHigh: 1000,
      retriesLow: 0,
      retriesExpected: 0,
      retriesHigh: 1,
    },
    cacheablePrefix: false,
  },
  {
    id: "implementation",
    name: "Implementation & Feature Coding",
    track: "build",
    sortOrder: 2,
    description:
      "Core feature development across front-end, backend, and database modules.",
    shortDescription: "Core feature coding across modules",
    archetypes: ["general"],
    defaultParams: {
      callsLow: 2,
      callsExpected: 4,
      callsHigh: 10,
      tokensPerCallLow: 200,
      tokensPerCallExpected: 1000,
      tokensPerCallHigh: 3000,
      retriesLow: 0,
      retriesExpected: 1,
      retriesHigh: 2,
    },
    cacheablePrefix: false,
  },
  {
    id: "query-answering",
    name: "Runtime Query & Retrieval Answering",
    track: "runtime",
    sortOrder: 3,
    description:
      "Handles runtime semantic document retrieval, prompt augmentation, and LLM query execution.",
    shortDescription: "Runtime retrieval and LLM response execution",
    archetypes: ["rag", "agent"],
    defaultParams: {
      callsLow: 1,
      callsExpected: 1,
      callsHigh: 2,
      tokensPerCallLow: 500,
      tokensPerCallExpected: 2000,
      tokensPerCallHigh: 4000,
      retriesLow: 0,
      retriesExpected: 0,
      retriesHigh: 1,
    },
    cacheablePrefix: true,
  },
];

describe("TaxonomyPromptBuilder Unit & Snapshot Tests (Budget-Driven Ladder)", () => {
  it("selects 'full' level when budget is comfortably large and matches snapshot", () => {
    const options: BuildTaxonomyPromptOptions = {
      modelContextWindow: 128000,
      modelMaxOutput: 4096,
      description: "A customer support AI agent for SaaS documentation.",
      catalogPhases: mockCatalogPhases,
    };

    const result = TaxonomyPromptBuilder.buildTaxonomyText(options);
    expect(result.level).toBe("full");
    expect(result.estimatedTaxonomyTokens).toBeLessThanOrEqual(result.availableBudgetTokens);

    // Snapshot of full prompt text
    expect(result.phasesTaxonomyText).toMatchInlineSnapshot(`
      "- architecture (build): Architecture & Scaffolding - Scaffolds initial project structure, tech stack definitions, and repository setup.
      - implementation (build): Implementation & Feature Coding - Core feature development across front-end, backend, and database modules.
      - query-answering (runtime): Runtime Query & Retrieval Answering - Handles runtime semantic document retrieval, prompt augmentation, and LLM query execution."
    `);
  });

  it("degrades to 'short' level when budget cannot fit full descriptions and matches snapshot", () => {
    // Overhead = reservedOutput (100) + fixedInstructions (600) + overview (8) = 708 tokens.
    // Full tokens is ~104 tokens. Short tokens is ~76 tokens.
    // With modelContextWindow = 793, availableBudget = 85 tokens (fits short, but not full).
    const options: BuildTaxonomyPromptOptions = {
      modelContextWindow: 793,
      modelMaxOutput: 100,
      description: "A customer support AI agent.",
      catalogPhases: mockCatalogPhases,
    };

    const result = TaxonomyPromptBuilder.buildTaxonomyText(options);
    expect(result.level).toBe("short");
    expect(result.estimatedTaxonomyTokens).toBeLessThanOrEqual(result.availableBudgetTokens);

    // Snapshot of short prompt text
    expect(result.phasesTaxonomyText).toMatchInlineSnapshot(`
      "- architecture (build): Architecture & Scaffolding - Scaffolding and initial repository setup
      - implementation (build): Implementation & Feature Coding - Core feature coding across modules
      - query-answering (runtime): Runtime Query & Retrieval Answering - Runtime retrieval and LLM response execution"
    `);
  });

  it("degrades to 'compact' (names and IDs only) when short descriptions exceed budget and matches snapshot", () => {
    // Overhead = 708 tokens.
    // Compact tokens is ~44 tokens. Short tokens is ~76 tokens.
    // With modelContextWindow = 758, availableBudget = 50 tokens (fits compact, but not short).
    const options: BuildTaxonomyPromptOptions = {
      modelContextWindow: 758,
      modelMaxOutput: 100,
      description: "A customer support AI agent.",
      catalogPhases: mockCatalogPhases,
    };

    const result = TaxonomyPromptBuilder.buildTaxonomyText(options);
    expect(result.level).toBe("compact");
    expect(result.estimatedTaxonomyTokens).toBeLessThanOrEqual(result.availableBudgetTokens);

    // Snapshot of compact prompt text
    expect(result.phasesTaxonomyText).toMatchInlineSnapshot(`
      "- architecture (build): Architecture & Scaffolding
      - implementation (build): Implementation & Feature Coding
      - query-answering (runtime): Runtime Query & Retrieval Answering"
    `);
  });

  it("throws clear 'model context too small for Enhance' error when even compact cannot fit", () => {
    // With modelContextWindow = 738, availableBudget = 30 tokens (< 44 compact tokens).
    const options: BuildTaxonomyPromptOptions = {
      modelContextWindow: 738,
      modelMaxOutput: 100,
      description: "A customer support AI agent.",
      catalogPhases: mockCatalogPhases,
    };

    expect(() => TaxonomyPromptBuilder.buildTaxonomyText(options)).toThrowError(
      /is too small for Enhance/i
    );
  });

  it("guarantees budget logic NEVER produces an over-limit prompt across varying context sizes", () => {
    const testWindows = [680, 700, 750, 800, 1000, 2048, 4096, 8192, 32768, 128000];

    for (const windowSize of testWindows) {
      try {
        const result = TaxonomyPromptBuilder.buildTaxonomyText({
          modelContextWindow: windowSize,
          modelMaxOutput: 1000,
          description: "Production SaaS application with multi-turn retrieval.",
          catalogPhases: mockCatalogPhases,
        });

        // The chosen level must strictly fit within availableBudgetTokens
        expect(result.estimatedTaxonomyTokens).toBeLessThanOrEqual(
          result.availableBudgetTokens
        );
      } catch (err: unknown) {
        // If it throws, it must only throw the context too small error
        expect((err as Error).message).toMatch(/is too small for Enhance/i);
      }
    }
  });
});
