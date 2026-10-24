/**
 * Tests: ProfileHistoryStore Unit Tests (T060, T065, FR-014, FR-015).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import type { ProjectProfile } from "@token-optimizer/core";

function createMockProfile(version = 1): ProjectProfile {
  return {
    schemaVersion: "1.0",
    projectType: "rag-chatbot",
    overview: "Multi-turn conversational RAG agent system with vector search.",
    techStack: [{ language: "TypeScript", framework: "Next.js" }],
    llm: {
      providers: ["anthropic"],
      usesRag: true,
      usesAgents: false,
      avgPromptTokens: 800,
      avgOutputTokens: 300,
    },
    components: [{ name: "Retriever", description: "Retrieves top-k context snippets" }],
    dataFlow: "User -> API -> Embedder -> Vector DB -> Generator",
    phases: [
      {
        id: "phase-1",
        phaseTypeId: "query-answering",
        track: "runtime",
        name: "Runtime Query Processing",
        source: "llm",
        confirmed: true,
      },
    ],
    scale: {
      requestsPerDay: 5000,
      peakMultiplier: 2.0,
    },
    buildAssumptions: {
      teamSize: 4,
      sprintWeeks: 2,
      iterationsPerFeature: 3,
    },
    constraints: ["sub-second latency"],
    profileVersion: version,
    createdAt: "2026-10-09T00:00:00.000Z",
  };
}

class MockMemento implements vscode.Memento {
  private store = new Map<string, unknown>();

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

describe("ProfileHistoryStore Unit Tests (T060, T065, FR-014, FR-015)", () => {
  let memento: MockMemento;
  let historyStore: ProfileHistoryStore;

  beforeEach(() => {
    memento = new MockMemento();
    historyStore = new ProfileHistoryStore(memento);
  });

  it("monotonically increments profile versions on successive additions", async () => {
    const entry1 = await historyStore.add({
      narrative: "Initial architectural synthesis.",
      profile: createMockProfile(1),
      createdAt: new Date().toISOString(),
      costUsd: 0.015,
      tokens: { inputTokens: 500, outputTokens: 250 },
    });
    expect(entry1.version).toBe(1);
    expect(entry1.profile.profileVersion).toBe(1);

    const entry2 = await historyStore.add({
      narrative: "Refined prompt engineering details.",
      profile: createMockProfile(2),
      createdAt: new Date().toISOString(),
      costUsd: 0.02,
      tokens: { inputTokens: 600, outputTokens: 300 },
    });
    expect(entry2.version).toBe(2);
    expect(entry2.profile.profileVersion).toBe(2);

    const all = historyStore.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].version).toBe(1);
    expect(all[1].version).toBe(2);
  });

  it("sets finalizedAt timestamp and propagates to profile when marking final", async () => {
    await historyStore.add({
      narrative: "Draft profile.",
      profile: createMockProfile(1),
      createdAt: new Date().toISOString(),
    });

    const finalizedTime = "2026-10-09T12:30:00.000Z";
    const finalized = await historyStore.markFinal(1, finalizedTime);

    expect(finalized).toBeDefined();
    expect(finalized?.finalizedAt).toBe(finalizedTime);
    expect(finalized?.profile.finalizedAt).toBe(finalizedTime);

    // Verify persisted in store
    const retrieved = historyStore.getVersion(1);
    expect(retrieved?.finalizedAt).toBe(finalizedTime);
    expect(retrieved?.profile.finalizedAt).toBe(finalizedTime);
  });

  it("evicts oldest versions to strictly enforce maximum 20 versions (FIFO eviction)", async () => {
    // Add 25 versions
    for (let i = 1; i <= 25; i++) {
      await historyStore.add({
        narrative: `Revision #${i}`,
        profile: createMockProfile(i),
        createdAt: new Date().toISOString(),
      });
    }

    const all = historyStore.getAll();
    expect(all).toHaveLength(20);

    // Oldest versions 1-5 should have been evicted; versions 6-25 should remain
    expect(all[0].version).toBe(6);
    expect(all[all.length - 1].version).toBe(25);
    expect(historyStore.getVersion(1)).toBeUndefined();
    expect(historyStore.getVersion(5)).toBeUndefined();
    expect(historyStore.getVersion(6)).toBeDefined();
    expect(historyStore.getVersion(25)).toBeDefined();
  });

  it("supports creating draft with edited phases without incrementing LLM cost", async () => {
    await historyStore.add({
      narrative: "Base version",
      profile: createMockProfile(1),
      createdAt: new Date().toISOString(),
      costUsd: 0.05,
    });

    const editedPhases = [
      {
        id: "phase-custom",
        phaseTypeId: "architecture",
        track: "build" as const,
        name: "Custom Architecture",
        source: "user" as const,
        confirmed: true,
      },
    ];

    const draft = await historyStore.createDraftWithPhases(1, editedPhases);
    expect(draft).toBeDefined();
    expect(draft?.version).toBe(2);
    expect(draft?.profile.phases).toEqual(editedPhases);
    expect(draft?.costUsd).toBe(0);
    expect(draft?.finalizedAt).toBeUndefined();
  });

  it("returns lightweight summaries and drops corrupted or schema-invalid stored records", async () => {
    // Inject valid record and corrupted/invalid records directly into memento
    const validProfile = createMockProfile(1);
    const corruptedRecord = {
      version: 2,
      narrative: "Broken",
      profile: { broken: "not a profile", schemaVersion: 123 },
    };
    const missingProfileRecord = {
      version: 3,
      narrative: "Missing",
    };

    await memento.update("tokenOptimizer.profileHistory", [
      {
        version: 1,
        narrative: "Valid v1",
        profile: validProfile,
        createdAt: "2026-10-09T00:00:00.000Z",
        finalizedAt: "2026-10-09T01:00:00.000Z",
        costUsd: 0.042,
      },
      corruptedRecord,
      missingProfileRecord,
    ]);

    const all = historyStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(1);

    const summaries = historyStore.getSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({
      version: 1,
      createdAt: "2026-10-09T00:00:00.000Z",
      finalizedAt: "2026-10-09T01:00:00.000Z",
      phaseCount: 1,
      costUsd: 0.042,
    });
  });

  it("clears all stored profile history entries", async () => {
    await historyStore.add({
      narrative: "Sample profile",
      profile: createMockProfile(1),
    });
    expect(historyStore.getAll()).toHaveLength(1);

    await historyStore.clear();
    expect(historyStore.getAll()).toHaveLength(0);
    expect(historyStore.getSummaries()).toHaveLength(0);
  });
});
