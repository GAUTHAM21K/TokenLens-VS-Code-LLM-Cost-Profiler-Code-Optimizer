/**
 * Tests: PhaseResolver (T067, FR-017, FR-052, Principle IV).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import {
  PhaseResolver,
  resolvePhases,
  UnconfirmedPhaseError,
  UnknownPhaseTypeError,
  PhaseTrackMismatchError,
} from "../../src/phases/PhaseResolver.js";
import type { ConfirmedPhase, Phase } from "../../src/protocol/types.js";

const mockCatalogPhases: Phase[] = [
  {
    id: "architecture",
    name: "Architecture & Scaffolding",
    track: "build",
    sortOrder: 1,
    description: "Initial architectural scoping and scaffolding prompts.",
    archetypes: ["general", "rag-chatbot"],
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
    id: "code-generation",
    name: "Code Generation",
    track: "build",
    sortOrder: 2,
    description: "Iterative feature coding and test generation.",
    archetypes: ["general", "coding-agent"],
    defaultParams: {
      callsLow: 5,
      callsExpected: 20,
      callsHigh: 50,
      tokensPerCallLow: 500,
      tokensPerCallExpected: 2000,
      tokensPerCallHigh: 8000,
      retriesLow: 0,
      retriesExpected: 1,
      retriesHigh: 2,
    },
    cacheablePrefix: true,
  },
  {
    id: "user-query",
    name: "User Query Execution",
    track: "runtime",
    sortOrder: 1,
    description: "Live inference on user-initiated conversational requests.",
    archetypes: ["general", "rag-chatbot"],
    defaultParams: {
      callsLow: 100,
      callsExpected: 500,
      callsHigh: 2000,
      tokensPerCallLow: 400,
      tokensPerCallExpected: 1500,
      tokensPerCallHigh: 4000,
      retriesLow: 0,
      retriesExpected: 0,
      retriesHigh: 1,
      volumeMultiplierLow: 1,
      volumeMultiplierExpected: 1,
      volumeMultiplierHigh: 1.5,
    },
    cacheablePrefix: true,
  },
];

describe("PhaseResolver (T067, FR-017, FR-052, Principle IV)", () => {
  it("resolves confirmed phases and attaches catalog attributes deterministically", () => {
    const profilePhases: ConfirmedPhase[] = [
      {
        id: "p-user-query",
        phaseTypeId: "user-query",
        track: "runtime",
        name: "User Query Execution",
        source: "llm",
        confirmed: true,
      },
      {
        id: "p-arch",
        phaseTypeId: "architecture",
        track: "build",
        name: "Architecture & Scaffolding",
        source: "llm",
        confirmed: true,
      },
    ];

    const result1 = resolvePhases(profilePhases, mockCatalogPhases);
    const result2 = PhaseResolver.resolve(profilePhases, mockCatalogPhases);

    // Byte-identical determinism
    expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));

    // Build phases sorted first, then runtime
    expect(result1).toHaveLength(2);
    expect(result1[0].track).toBe("build");
    expect(result1[0].id).toBe("p-arch");
    expect(result1[0].description).toBe(
      "Initial architectural scoping and scaffolding prompts."
    );
    expect(result1[0].defaultParams.callsExpected).toBe(5);

    expect(result1[1].track).toBe("runtime");
    expect(result1[1].id).toBe("p-user-query");
    expect(result1[1].cacheablePrefix).toBe(true);
  });

  it("sorts within the same track by catalog sortOrder ascending", () => {
    const profilePhases: ConfirmedPhase[] = [
      {
        id: "p-code",
        phaseTypeId: "code-generation",
        track: "build",
        name: "Code Generation",
        source: "llm",
        confirmed: true,
      },
      {
        id: "p-arch",
        phaseTypeId: "architecture",
        track: "build",
        name: "Architecture & Scaffolding",
        source: "llm",
        confirmed: true,
      },
    ];

    const result = resolvePhases(profilePhases, mockCatalogPhases);
    expect(result[0].phaseTypeId).toBe("architecture");
    expect(result[1].phaseTypeId).toBe("code-generation");
  });

  it("throws UnconfirmedPhaseError when a phase is not confirmed", () => {
    const profilePhases: ConfirmedPhase[] = [
      {
        id: "p-unconfirmed",
        phaseTypeId: "architecture",
        track: "build",
        name: "Unconfirmed Phase",
        source: "taxonomy-suggestion",
        confirmed: false,
      },
    ];

    expect(() => resolvePhases(profilePhases, mockCatalogPhases)).toThrowError(
      UnconfirmedPhaseError
    );
  });

  it("throws UnknownPhaseTypeError when phaseTypeId does not exist in catalog", () => {
    const profilePhases: ConfirmedPhase[] = [
      {
        id: "p-mystery",
        phaseTypeId: "nonexistent-type",
        track: "build",
        name: "Nonexistent Type",
        source: "user",
        confirmed: true,
      },
    ];

    expect(() => resolvePhases(profilePhases, mockCatalogPhases)).toThrowError(
      UnknownPhaseTypeError
    );
  });

  it("throws PhaseTrackMismatchError when phase track contradicts catalog phase type", () => {
    const profilePhases: ConfirmedPhase[] = [
      {
        id: "p-mismatch",
        phaseTypeId: "architecture", // catalog defines "build"
        track: "runtime", // profile incorrectly says "runtime"
        name: "Mismatched Track",
        source: "user",
        confirmed: true,
      },
    ];

    expect(() => resolvePhases(profilePhases, mockCatalogPhases)).toThrowError(
      PhaseTrackMismatchError
    );
  });

  it("returns an empty array when profilePhases is empty", () => {
    expect(resolvePhases([], mockCatalogPhases)).toEqual([]);
  });
});
