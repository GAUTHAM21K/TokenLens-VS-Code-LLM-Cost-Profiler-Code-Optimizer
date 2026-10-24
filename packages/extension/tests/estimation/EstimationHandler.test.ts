/**
 * Tests: EstimationHandler (T072, FR-019, SC-003).
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

import { EstimationHandler } from "../../src/estimation/EstimationHandler.js";
import { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
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

const mockCatalog: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00.000Z",
  providers: [
    {
      id: "openai",
      label: "OpenAI",
      adapterType: "openai",
      keyFormatHint: "sk-...",
      enabled: true,
    },
  ],
  models: [
    {
      id: "gpt-4o",
      providerId: "openai",
      label: "GPT-4o",
      contextWindow: 128000,
      maxOutput: 4096,
      tier: "frontier",
      supportsCaching: true,
      supportsBatch: true,
      supportsStructuredOutput: true,
      tokenizer: { kind: "tiktoken" },
      status: "active",
      addedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  pricing: [
    {
      modelId: "gpt-4o",
      currency: "USD",
      inputPerMTok: 2.5,
      outputPerMTok: 10.0,
      cachedInputPerMTok: 1.25,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      sourceUrl: "https://openai.com/api/pricing/",
      verifiedAt: "2026-10-09T00:00:00.000Z",
    },
  ],
  phases: [
    {
      id: "architecture",
      name: "Architecture & Scaffolding",
      track: "build",
      sortOrder: 1,
      description: "Initial scoping and scaffolding.",
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
      id: "query-answering",
      name: "Runtime Query Processing",
      track: "runtime",
      sortOrder: 2,
      description: "Online queries and responses.",
      archetypes: ["general", "rag-chatbot"],
      defaultParams: {
        callsLow: 100,
        callsExpected: 500,
        callsHigh: 2000,
        tokensPerCallLow: 500,
        tokensPerCallExpected: 2000,
        tokensPerCallHigh: 5000,
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

const sampleProfile: ProjectProfile = {
  schemaVersion: "1.0",
  projectType: "rag-chatbot",
  overview: "Enterprise customer service intelligent assistant.",
  techStack: [{ language: "TypeScript" }],
  llm: {
    providers: ["openai"],
    usesRag: true,
    usesAgents: false,
    avgPromptTokens: 1500,
    avgOutputTokens: 500,
  },
  components: [],
  dataFlow: "User -> Server -> Model",
  phases: [
    {
      id: "p-arch",
      phaseTypeId: "architecture",
      track: "build",
      name: "Architecture & Scaffolding",
      source: "llm",
      confirmed: true,
    },
    {
      id: "p-query",
      phaseTypeId: "query-answering",
      track: "runtime",
      name: "Runtime Query Processing",
      source: "llm",
      confirmed: true,
    },
  ],
  scale: { requestsPerDay: 500, monthlyDays: 22 },
  buildAssumptions: {
    teamSize: 2,
    sprintWeeks: 2,
    iterationsPerFeature: 3,
  },
  constraints: [],
  profileVersion: 1,
  createdAt: "2026-10-09T00:00:00.000Z",
  finalizedAt: "2026-10-09T00:00:00.000Z",
};

describe("EstimationHandler (T072, FR-019, SC-003)", () => {
  let router: MessageRouter;
  let postedMessages: HostToWebviewMsg[];
  let historyStore: ProfileHistoryStore;
  let handler: EstimationHandler;

  beforeEach(async () => {
    postedMessages = [];
    router = new MessageRouter({
      postMessage: async (msg) => {
        postedMessages.push(msg as HostToWebviewMsg);
        return true;
      },
    });

    const memento = new MockMemento();
    historyStore = new ProfileHistoryStore(memento);
    await historyStore.add({
      version: 1,
      narrative: "Initial profile",
      profile: sampleProfile,
      createdAt: "2026-10-09T00:00:00.000Z",
    });

    const mockContext = {
      workspaceState: memento,
    } as unknown as vscode.ExtensionContext;

    handler = new EstimationHandler({
      context: mockContext,
      router,
      historyStore,
      getCatalogSnapshot: () => mockCatalog,
      postMessage: async (msg) => {
        postedMessages.push(msg);
        return true;
      },
    });

    handler.register();
  });

  it("receives estimate/request, calls estimate(), and posts estimate/result", async () => {
    await router.handleInbound({
      version: 1,
      type: "estimate/request",
      payload: {
        operationId: "op-123",
        profileVersion: 1,
      },
    });

    expect(postedMessages).toHaveLength(1);
    const resultMsg = postedMessages[0];
    expect(resultMsg.type).toBe("estimate/result");
    if (resultMsg.type === "estimate/result") {
      expect(resultMsg.payload.operationId).toBe("op-123");
      expect(resultMsg.payload.result.profileVersion).toBe(1);
      expect(resultMsg.payload.result.build.phases).toHaveLength(1);
      expect(resultMsg.payload.result.runtime.phases).toHaveLength(1);
      expect(resultMsg.payload.result.totalExpectedCost).toBeGreaterThan(0);
    }
  });

  it("applies overrides when provided in estimate/request", async () => {
    await router.handleInbound({
      version: 1,
      type: "estimate/request",
      payload: {
        operationId: "op-override",
        profileVersion: 1,
        overrides: [
          {
            phaseId: "p-arch",
            callsExpected: 20, // default was 5
            callsHigh: 30, // default was 15
          },
        ],
      },
    });

    expect(postedMessages).toHaveLength(1);
    const resultMsg = postedMessages[0];
    if (resultMsg.type === "estimate/result") {
      const archPhase = resultMsg.payload.result.build.phases[0];
      const params = archPhase.params as { calls: { expected: number } };
      expect(params.calls.expected).toBe(20);
    }
  });

  it("logs warning if duration exceeds 50ms threshold", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Force performance.now difference > 50ms
    let count = 0;
    const originalNow = performance.now;
    vi.spyOn(performance, "now").mockImplementation(() => {
      count++;
      return count === 1 ? 0 : 75; // 75ms duration
    });

    await router.handleInbound({
      version: 1,
      type: "estimate/request",
      payload: {
        profileVersion: 1,
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("threshold: 75.00ms (SC-003)")
    );

    warnSpy.mockRestore();
    vi.spyOn(performance, "now").mockImplementation(originalNow);
  });
});
