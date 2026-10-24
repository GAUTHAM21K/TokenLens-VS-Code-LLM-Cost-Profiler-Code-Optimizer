/**
 * Tests: EnhanceHandlers Unit Tests (T061, T148, FR-015, FR-052).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [],
  },
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      path: parts.join("/"),
      fsPath: parts.join("/"),
    }),
  },
}));

import { EnhanceHandlers } from "../../src/webview/handlers/EnhanceHandlers.js";
import { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { EnhanceService } from "../../src/enhance/EnhanceService.js";
import type {
  CatalogSnapshot,
  HostToWebviewMsg,
  ProjectProfile,
} from "@token-optimizer/core";

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

function createProfileWithPhases(phases: ProjectProfile["phases"]): ProjectProfile {
  return {
    schemaVersion: "1.0",
    projectType: "rag-chatbot",
    overview: "Enterprise customer service intelligent assistant.",
    techStack: [{ language: "TypeScript" }],
    llm: {
      providers: ["anthropic"],
      usesRag: true,
      usesAgents: false,
      avgPromptTokens: 500,
      avgOutputTokens: 200,
    },
    components: [],
    dataFlow: "User -> Server -> Model",
    phases,
    scale: { requestsPerDay: 1000 },
    buildAssumptions: { teamSize: 2, sprintWeeks: 2, iterationsPerFeature: 2 },
    constraints: [],
    profileVersion: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
  };
}

const mockCatalog: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00Z",
  providers: [],
  models: [],
  pricing: [],
  phases: [
    {
      id: "architecture",
      name: "Architecture & Scaffolding",
      track: "build",
      sortOrder: 1,
      description: "Architecture setup",
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
      id: "query-answering",
      name: "Query Processing",
      track: "runtime",
      sortOrder: 2,
      description: "Runtime QA",
      archetypes: ["general"],
      defaultParams: {
        callsLow: 10,
        callsExpected: 100,
        callsHigh: 1000,
        tokensPerCallLow: 100,
        tokensPerCallExpected: 500,
        tokensPerCallHigh: 1000,
        retriesLow: 0,
        retriesExpected: 0,
        retriesHigh: 1,
      },
      cacheablePrefix: true,
    },
  ],
  strategies: [],
  platforms: [],
  promptTemplates: [],
};

describe("EnhanceHandlers Unit Tests (T061, T148, FR-015, FR-052)", () => {
  let memento: MockMemento;
  let historyStore: ProfileHistoryStore;
  let router: MessageRouter;
  let postedMessages: HostToWebviewMsg[];
  let enhanceService: EnhanceService;
  let handlers: EnhanceHandlers;

  beforeEach(() => {
    memento = new MockMemento();
    historyStore = new ProfileHistoryStore(memento);
    router = new MessageRouter();
    postedMessages = [];

    router.setTarget({
      postMessage: async (msg) => {
        postedMessages.push(msg as HostToWebviewMsg);
        return true;
      },
    });

    enhanceService = {
      run: vi.fn(),
    } as unknown as EnhanceService;

    handlers = new EnhanceHandlers({
      context: {} as vscode.ExtensionContext,
      router,
      enhanceService,
      historyStore,
      getCatalogSnapshot: () => mockCatalog,
    });
    handlers.register();
  });

  it("refuses finalization when profile has zero phases (Refusal 1)", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Empty phases profile",
      profile: createProfileWithPhases([]),
      createdAt: new Date().toISOString(),
    });

    await router.handleInbound({
      version: 1,
      type: "enhance/finalize",
      payload: { profileVersion: 1 },
    });

    const errorMsg = postedMessages.find((m) => m.type === "enhance/error");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "enhance/error") {
      expect(errorMsg.payload.message).toContain("at least one phase is required");
    }
  });

  it("refuses finalization when a phase has unknown phaseTypeId (Refusal 2)", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Invalid phase profile",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "completely-unknown-type",
          track: "build",
          name: "Unknown",
          source: "user",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    await router.handleInbound({
      version: 1,
      type: "enhance/finalize",
      payload: { profileVersion: 1 },
    });

    const errorMsg = postedMessages.find((m) => m.type === "enhance/error");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "enhance/error") {
      expect(errorMsg.payload.message).toContain("unknown catalog phase type");
    }
  });

  it("refuses finalization when any phase is unconfirmed (Refusal 3)", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Unconfirmed phase profile",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture & Scaffolding",
          source: "taxonomy-suggestion",
          confirmed: false,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    await router.handleInbound({
      version: 1,
      type: "enhance/finalize",
      payload: { profileVersion: 1 },
    });

    const errorMsg = postedMessages.find((m) => m.type === "enhance/error");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "enhance/error") {
      expect(errorMsg.payload.message).toContain("all phases must be confirmed");
    }
  });

  it("successfully finalizes profile when all phases are valid and confirmed", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Valid profile",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture & Scaffolding",
          source: "llm",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    await router.handleInbound({
      version: 1,
      type: "enhance/finalize",
      payload: { profileVersion: 1 },
    });

    const finalizedMsg = postedMessages.find((m) => m.type === "enhance/profileFinalized");
    expect(finalizedMsg).toBeDefined();
    if (finalizedMsg && finalizedMsg.type === "enhance/profileFinalized") {
      expect(finalizedMsg.payload.profileVersion).toBe(1);
    }

    const entry = historyStore.getVersion(1);
    expect(entry?.finalizedAt).toBeDefined();
  });

  it("creates next draft version with zero adapter calls on enhance/editPhases", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Initial version",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture",
          source: "llm",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    const newPhases = [
      {
        id: "p1",
        phaseTypeId: "architecture",
        track: "build" as const,
        name: "Renamed Architecture",
        source: "user" as const,
        confirmed: true,
      },
      {
        id: "p2",
        phaseTypeId: "query-answering",
        track: "runtime" as const,
        name: "Query Processing",
        source: "user" as const,
        confirmed: true,
      },
    ];

    await router.handleInbound({
      version: 1,
      type: "enhance/editPhases",
      payload: {
        profileVersion: 1,
        phases: newPhases,
      },
    });

    // Zero adapter calls
    expect(enhanceService.run).not.toHaveBeenCalled();

    // Checked phasesUpdated message
    const updatedMsg = postedMessages.find((m) => m.type === "enhance/phasesUpdated");
    expect(updatedMsg).toBeDefined();
    if (updatedMsg && updatedMsg.type === "enhance/phasesUpdated") {
      expect(updatedMsg.payload.profileVersion).toBe(2);
      expect(updatedMsg.payload.phases).toHaveLength(2);
      expect(updatedMsg.payload.problems).toHaveLength(0);
    }

    // Version 2 exists in store
    const v2 = historyStore.getVersion(2);
    expect(v2).toBeDefined();
    expect(v2?.profile.phases).toHaveLength(2);
  });

  it("sends history summaries on webview/ready handshake and on enhance/getHistory", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Initial version",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture",
          source: "llm",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
      costUsd: 0.015,
    });

    // 1. webview/ready handshake
    await router.handleInbound({
      version: 1,
      type: "webview/ready",
      payload: {},
    });

    const readyHistoryMsg = postedMessages.find((m) => m.type === "enhance/historyLoaded");
    expect(readyHistoryMsg).toBeDefined();
    if (readyHistoryMsg && readyHistoryMsg.type === "enhance/historyLoaded") {
      expect(readyHistoryMsg.payload.summaries).toHaveLength(1);
      expect(readyHistoryMsg.payload.summaries[0].version).toBe(1);
      expect(readyHistoryMsg.payload.summaries[0].phaseCount).toBe(1);
    }

    // 2. Explicit enhance/getHistory
    postedMessages = [];
    await router.handleInbound({
      version: 1,
      type: "enhance/getHistory",
      payload: {},
    });

    const explicitHistoryMsg = postedMessages.find((m) => m.type === "enhance/historyLoaded");
    expect(explicitHistoryMsg).toBeDefined();
    if (explicitHistoryMsg && explicitHistoryMsg.type === "enhance/historyLoaded") {
      expect(explicitHistoryMsg.payload.summaries).toHaveLength(1);
    }
  });

  it("fetches full profile on enhance/getVersion and returns enhance/versionLoaded", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Initial architectural synthesis.",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture",
          source: "llm",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    await router.handleInbound({
      version: 1,
      type: "enhance/getVersion",
      payload: { version: 1 },
    });

    const versionMsg = postedMessages.find((m) => m.type === "enhance/versionLoaded");
    expect(versionMsg).toBeDefined();
    if (versionMsg && versionMsg.type === "enhance/versionLoaded") {
      expect(versionMsg.payload.entry.version).toBe(1);
      expect(versionMsg.payload.entry.narrative).toBe("Initial architectural synthesis.");
      expect(versionMsg.payload.entry.profile.phases).toHaveLength(1);
    }
  });

  it("clears stored profile history on enhance/clearHistory and sends enhance/historyCleared", async () => {
    await historyStore.add({
      version: 1,
      narrative: "Initial version",
      profile: createProfileWithPhases([
        {
          id: "p1",
          phaseTypeId: "architecture",
          track: "build",
          name: "Architecture",
          source: "llm",
          confirmed: true,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    expect(historyStore.getAll()).toHaveLength(1);

    await router.handleInbound({
      version: 1,
      type: "enhance/clearHistory",
      payload: {},
    });

    const clearedMsg = postedMessages.find((m) => m.type === "enhance/historyCleared");
    expect(clearedMsg).toBeDefined();
    expect(historyStore.getAll()).toHaveLength(0);
  });
});
