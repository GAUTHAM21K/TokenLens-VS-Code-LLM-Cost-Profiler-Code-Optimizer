/**
 * Tests: PhaseSuggester.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import { suggestPhases } from "../../src/phases/PhaseSuggester.js";
import type { Phase } from "../../src/protocol/types.js";

const sampleCatalogPhases: Phase[] = [
  {
    id: "architecture",
    name: "Architecture & Scaffolding",
    track: "build",
    sortOrder: 1,
    description: "Initial architectural scoping and scaffolding prompts.",
    archetypes: ["rag-chatbot", "coding-agent", "general"],
    defaultParams: {
      callsLow: 1,
      callsExpected: 5,
      callsHigh: 15,
      tokensPerCallLow: 1000,
      tokensPerCallExpected: 4000,
      tokensPerCallHigh: 10000,
      retriesLow: 0,
      retriesExpected: 1,
      retriesHigh: 3,
    },
    cacheablePrefix: false,
  },
  {
    id: "implementation",
    name: "Feature Implementation",
    track: "build",
    sortOrder: 2,
    description: "Iterative agentic code generation and unit testing cycles.",
    archetypes: ["rag-chatbot", "coding-agent", "general"],
    defaultParams: {
      callsLow: 5,
      callsExpected: 20,
      callsHigh: 80,
      tokensPerCallLow: 800,
      tokensPerCallExpected: 2500,
      tokensPerCallHigh: 8000,
      retriesLow: 0,
      retriesExpected: 2,
      retriesHigh: 5,
    },
    cacheablePrefix: true,
  },
  {
    id: "query-answering",
    name: "Runtime Query Processing",
    track: "runtime",
    sortOrder: 3,
    description: "User queries processed by runtime RAG and generation pipelines.",
    archetypes: ["rag-chatbot", "general"],
    defaultParams: {
      callsLow: 100,
      callsExpected: 1000,
      callsHigh: 10000,
      tokensPerCallLow: 500,
      tokensPerCallExpected: 2000,
      tokensPerCallHigh: 6000,
      retriesLow: 0,
      retriesExpected: 0,
      retriesHigh: 1,
    },
    cacheablePrefix: true,
  },
];

describe("PhaseSuggester", () => {
  it("produces byte-identical output across repeated calls (determinism)", () => {
    const profile = {
      projectType: "rag-chatbot",
      llm: {
        usesRag: true,
        usesAgents: false,
        avgPromptTokens: 500,
        avgOutputTokens: 200,
      },
    };

    const first = suggestPhases(profile, sampleCatalogPhases);
    const second = suggestPhases(profile, sampleCatalogPhases);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("ensures every returned phaseTypeId exists in the catalog fixture", () => {
    const profile = {
      projectType: "rag-chatbot",
      llm: {
        usesRag: true,
        usesAgents: false,
        avgPromptTokens: 500,
        avgOutputTokens: 200,
      },
    };

    const suggested = suggestPhases(profile, sampleCatalogPhases);
    expect(suggested.length).toBeGreaterThan(0);

    const catalogIds = new Set(sampleCatalogPhases.map((p) => p.id));
    for (const phase of suggested) {
      expect(catalogIds.has(phase.phaseTypeId)).toBe(true);
      expect(phase.source).toBe("taxonomy-suggestion");
      expect(phase.confirmed).toBe(false);
    }
  });

  it("handles coding-agent profile and matches archetypes", () => {
    const profile = {
      projectType: "coding-agent",
      llm: {
        usesRag: false,
        usesAgents: true,
        avgPromptTokens: 1000,
        avgOutputTokens: 500,
      },
    };

    const suggested = suggestPhases(profile, sampleCatalogPhases);
    expect(suggested.length).toBeGreaterThan(0);
    for (const phase of suggested) {
      expect(phase.source).toBe("taxonomy-suggestion");
      expect(phase.confirmed).toBe(false);
    }
  });

  it("returns empty array when catalog phases list is empty", () => {
    const profile = {
      projectType: "unknown",
      llm: {
        usesRag: false,
        usesAgents: false,
        avgPromptTokens: 100,
        avgOutputTokens: 50,
      },
    };

    const suggested = suggestPhases(profile, []);
    expect(suggested).toEqual([]);
  });
});
