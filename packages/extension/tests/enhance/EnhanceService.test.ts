/**
 * Tests: EnhanceService Unit Tests (T059, T064, FR-010-FR-013).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import { EnhanceService } from "../../src/enhance/EnhanceService.js";
import { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { KeyService } from "../../src/secrets/KeyService.js";
import type {
  ProviderAdapter,
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

class MockSecretStorage implements vscode.SecretStorage {
  private secrets = new Map<string, string>();
  readonly onDidChange = vi.fn() as unknown as vscode.Event<vscode.SecretStorageChangeEvent>;

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

function createSampleProfilePayload(): ProjectProfile {
  return {
    schemaVersion: "1.0",
    projectType: "rag-chatbot",
    overview: "Production grade conversational enterprise RAG search application.",
    techStack: [{ language: "TypeScript", framework: "Next.js" }],
    llm: {
      providers: ["anthropic"],
      usesRag: true,
      usesAgents: false,
      avgPromptTokens: 1000,
      avgOutputTokens: 400,
    },
    components: [{ name: "IndexService", description: "Maintains inverted vector index" }],
    dataFlow: "Input query -> Hybrid retrieval -> LLM generation pipeline",
    phases: [
      {
        id: "phase-1",
        phaseTypeId: "query-answering",
        track: "runtime",
        name: "Runtime Query Answering",
        source: "llm",
        confirmed: true,
      },
    ],
    scale: {
      requestsPerDay: 10000,
      peakMultiplier: 2.0,
    },
    buildAssumptions: {
      teamSize: 5,
      sprintWeeks: 2,
      iterationsPerFeature: 3,
    },
    constraints: ["HIPAA compliance"],
    profileVersion: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
  };
}

const mockCatalogSnapshot: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00.000Z",
  providers: [
    {
      id: "anthropic",
      label: "Anthropic",
      adapterType: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      keyFormatHint: "sk-ant-...",
      enabled: true,
    },
  ],
  models: [
    {
      id: "claude-3-5-sonnet",
      providerId: "anthropic",
      label: "Claude 3.5 Sonnet",
      contextWindow: 200000,
      maxOutput: 8192,
      tier: "frontier",
      supportsCaching: true,
      supportsBatch: false,
      supportsStructuredOutput: true,
      tokenizer: { kind: "anthropic-endpoint" },
      status: "active",
      addedAt: "2026-10-09T00:00:00.000Z",
    },
  ],
  pricing: [
    {
      modelId: "claude-3-5-sonnet",
      currency: "USD",
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      effectiveFrom: "2026-10-01T00:00:00Z",
      sourceUrl: "https://anthropic.com/pricing",
      verifiedAt: "2026-10-09T00:00:00Z",
    },
  ],
  phases: [
    {
      id: "query-answering",
      name: "Runtime Query Answering",
      track: "runtime",
      sortOrder: 1,
      description:
        "Handles runtime semantic document retrieval, prompt augmentation, and LLM query execution.",
      shortDescription: "Runtime retrieval and LLM response execution",
      archetypes: ["rag-chatbot", "general"],
      defaultParams: {
        callsLow: 100,
        callsExpected: 1000,
        callsHigh: 5000,
        tokensPerCallLow: 500,
        tokensPerCallExpected: 1500,
        tokensPerCallHigh: 4000,
        retriesLow: 0,
        retriesExpected: 1,
        retriesHigh: 2,
      },
      cacheablePrefix: true,
    },
    {
      id: "architecture",
      name: "Architecture & Scaffolding",
      track: "build",
      sortOrder: 2,
      description:
        "Scaffolds initial project structure, tech stack definitions, and repository setup.",
      shortDescription: "Scaffolding and initial repository setup",
      archetypes: ["rag-chatbot", "general"],
      defaultParams: {
        callsLow: 1,
        callsExpected: 5,
        callsHigh: 10,
        tokensPerCallLow: 1000,
        tokensPerCallExpected: 3000,
        tokensPerCallHigh: 8000,
        retriesLow: 0,
        retriesExpected: 0,
        retriesHigh: 1,
      },
      cacheablePrefix: false,
    },
  ],
  strategies: [],
  platforms: [],
  promptTemplates: [
    {
      id: "enhance-default",
      version: 1,
      purpose: "enhance",
      template: "Prompt for: {{description}}\nPhases:\n{{phasesTaxonomy}}",
      outputSchemaRef: "ProjectProfileSchema",
      active: true,
    },
  ],
};

describe("EnhanceService Unit Tests (T059, T064, FR-010-FR-013)", () => {
  let memento: MockMemento;
  let historyStore: ProfileHistoryStore;
  let secretStorage: MockSecretStorage;
  let keyService: KeyService;
  let postedMessages: HostToWebviewMsg[];
  let mockAdapter: ProviderAdapter;

  beforeEach(async () => {
    memento = new MockMemento();
    historyStore = new ProfileHistoryStore(memento);
    secretStorage = new MockSecretStorage();
    keyService = new KeyService(secretStorage);
    // Use short mock token to satisfy secret scanner
    await keyService.storeKey("anthropic", 0, "mock-key-token");
    postedMessages = [];

    mockAdapter = {
      providerId: "anthropic",
      validateKey: vi.fn(),
      listModels: vi.fn(),
      complete: vi.fn(),
    };
  });

  function createService(snapshot = mockCatalogSnapshot): EnhanceService {
    return new EnhanceService({
      keyService,
      adapters: new Map([["anthropic", mockAdapter]]),
      getCatalogSnapshot: () => snapshot,
      postMessage: async (msg) => {
        postedMessages.push(msg);
      },
      historyStore,
    });
  }

  it("successfully handles valid JSON response and computes costs (Scenario 1)", async () => {
    const validProfile = createSampleProfilePayload();
    const service = createService();

    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: JSON.stringify({
        narrative: "Comprehensive architecture breakdown for RAG chatbot.",
        profile: validProfile,
      }),
      inputTokens: 1000,
      outputTokens: 500,
    });

    const result = await service.run({
      description: "Build an enterprise customer support RAG assistant.",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet",
      keySlot: 0,
    });

    expect(result).toBeDefined();
    expect(result?.projectType).toBe("rag-chatbot");

    // Check posted messages: enhance/stream and enhance/result
    const streamMsgs = postedMessages.filter((m) => m.type === "enhance/stream");
    expect(streamMsgs.length).toBeGreaterThan(0);

    const resultMsg = postedMessages.find((m) => m.type === "enhance/result");
    expect(resultMsg).toBeDefined();
    if (resultMsg && resultMsg.type === "enhance/result") {
      expect(resultMsg.payload.profileVersion).toBe(1);
      expect(resultMsg.payload.inputTokens).toBe(1000);
      expect(resultMsg.payload.outputTokens).toBe(500);
      // Cost: 1000 * 3/1M + 500 * 15/1M = 0.003 + 0.0075 = 0.0105
      expect(resultMsg.payload.costUsd).toBeCloseTo(0.0105, 4);
    }

    // Check store
    const stored = historyStore.getVersion(1);
    expect(stored).toBeDefined();
    expect(stored?.costUsd).toBeCloseTo(0.0105, 4);
  });

  it("repairs malformed JSON on first attempt and succeeds (Scenario 2)", async () => {
    const validProfile = createSampleProfilePayload();
    const service = createService();

    // 1st attempt: malformed JSON
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: "Here is your profile: { corrupted json missing braces",
      inputTokens: 800,
      outputTokens: 50,
    });

    // 2nd attempt (repair): valid JSON in code fences
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: `\`\`\`json\n${JSON.stringify({
        narrative: "Repaired architecture output.",
        profile: validProfile,
      })}\n\`\`\``,
      inputTokens: 900,
      outputTokens: 400,
    });

    const result = await service.run({
      description: "Build an enterprise customer support RAG assistant.",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    expect(result).toBeDefined();
    expect(mockAdapter.complete).toHaveBeenCalledTimes(2);

    const resultMsg = postedMessages.find((m) => m.type === "enhance/result");
    expect(resultMsg).toBeDefined();
    if (resultMsg && resultMsg.type === "enhance/result") {
      expect(resultMsg.payload.inputTokens).toBe(1700);
      expect(resultMsg.payload.outputTokens).toBe(450);
    }
  });

  it("aborts after single repair attempt on double malformed failure (Scenario 3)", async () => {
    const service = createService();

    // 1st call: malformed
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: "Not JSON at all",
      inputTokens: 500,
      outputTokens: 50,
    });

    // 2nd call (repair): still malformed
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: "Still invalid JSON output",
      inputTokens: 600,
      outputTokens: 50,
    });

    const result = await service.run({
      description: "Build an enterprise customer support RAG assistant.",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    expect(result).toBeNull();
    // Strictly exactly one repair attempt made (total 2 calls, never 3)
    expect(mockAdapter.complete).toHaveBeenCalledTimes(2);

    const errorMsg = postedMessages.find((m) => m.type === "enhance/error");
    expect(errorMsg).toBeDefined();
    if (errorMsg && errorMsg.type === "enhance/error") {
      expect(errorMsg.payload.error).toBe("repair-failed");
    }
  });

  it("preserves previous version on double failure without corrupting store (Scenario 4)", async () => {
    // Seed initial version 1
    const initialProfile = createSampleProfilePayload();
    await historyStore.add({
      version: 1,
      narrative: "Initial stable version.",
      profile: initialProfile,
      createdAt: new Date().toISOString(),
      costUsd: 0.01,
    });

    const service = createService();

    // 1st call: malformed
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: "broken",
    });
    // 2nd call: malformed
    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: "still broken",
    });

    const result = await service.run({
      description: "Refining with additional constraints.",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet",
      previousProfileVersion: 1,
    });

    expect(result).toBeNull();

    // History store must still contain version 1 intact and no version 2
    const all = historyStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe(1);
    expect(all[0].narrative).toBe("Initial stable version.");
    expect(historyStore.getVersion(2)).toBeUndefined();
  });

  it("falls back to PhaseSuggester when LLM returns no usable phase types (T133, T147)", async () => {
    const profileWithBogusPhase = createSampleProfilePayload();
    profileWithBogusPhase.phases = [
      {
        id: "bogus",
        phaseTypeId: "nonexistent-phase-type-xyz",
        track: "runtime",
        name: "Unknown Phase",
        source: "llm",
        confirmed: true,
      },
    ];

    const service = createService();

    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: JSON.stringify({
        narrative: "Architecture narrative.",
        profile: profileWithBogusPhase,
      }),
      inputTokens: 500,
      outputTokens: 200,
    });

    const result = await service.run({
      description: "A customer support bot.",
      providerId: "anthropic",
      modelId: "claude-3-5-sonnet",
    });

    expect(result).toBeDefined();
    // Unknown phase should have been replaced by suggested catalog phases
    expect(result?.phases.length).toBeGreaterThan(0);
    const validIds = new Set(mockCatalogSnapshot.phases.map((p) => p.id));
    for (const phase of result!.phases) {
      expect(validIds.has(phase.phaseTypeId)).toBe(true);
      expect(phase.source).toBe("taxonomy-suggestion");
      expect(phase.confirmed).toBe(false);
    }
  });

  it("records taxonomyBudgetLevel in result and narrative stream when budget degrades", async () => {
    // Clone snapshot with small-window model (e.g. 793 window -> degrades to short)
    const customSnapshot: CatalogSnapshot = {
      ...mockCatalogSnapshot,
      models: [
        {
          id: "small-model",
          providerId: "anthropic",
          label: "Small Model",
          contextWindow: 760,
          maxOutput: 100,
          tier: "economy",
          supportsCaching: false,
          supportsBatch: false,
          supportsStructuredOutput: true,
          tokenizer: { kind: "tiktoken" },
          status: "active",
          addedAt: "2026-10-09",
        },
      ],
    };

    const service = createService(customSnapshot);

    vi.mocked(mockAdapter.complete).mockResolvedValueOnce({
      content: JSON.stringify({
        narrative: "Synthesized architecture.",
        profile: createSampleProfilePayload(),
      }),
      inputTokens: 300,
      outputTokens: 100,
    });

    const result = await service.run({
      description: "A customer support bot.",
      providerId: "anthropic",
      modelId: "small-model",
    });

    expect(result).toBeDefined();

    // Verify stream contained taxonomy budget level notice
    const streamMsgs = postedMessages.filter(
      (m): m is Extract<HostToWebviewMsg, { type: "enhance/stream" }> =>
        m.type === "enhance/stream"
    );
    expect(streamMsgs.length).toBeGreaterThan(0);
    const fullStreamText = streamMsgs.map((m) => m.payload.delta).join("");
    expect(fullStreamText).toContain("[Taxonomy budget level: short");

    // Verify result contained taxonomyBudgetLevel
    const resultMsg = postedMessages.find(
      (m): m is Extract<HostToWebviewMsg, { type: "enhance/result" }> =>
        m.type === "enhance/result"
    );
    expect(resultMsg).toBeDefined();
    expect(resultMsg?.payload.taxonomyBudgetLevel).toBe("short");

    // Verify historyLoaded was sent
    const historyMsg = postedMessages.find(
      (m): m is Extract<HostToWebviewMsg, { type: "enhance/historyLoaded" }> =>
        m.type === "enhance/historyLoaded"
    );
    expect(historyMsg).toBeDefined();
    expect(historyMsg?.payload.summaries).toHaveLength(1);
  });

  it("posts enhance/error when model context window is too small for Enhance", async () => {
    // Model with contextWindow smaller than fixed overhead + compact tokens
    const tinySnapshot: CatalogSnapshot = {
      ...mockCatalogSnapshot,
      models: [
        {
          id: "tiny-model",
          providerId: "anthropic",
          label: "Tiny Model",
          contextWindow: 720,
          maxOutput: 100,
          tier: "economy",
          supportsCaching: false,
          supportsBatch: false,
          supportsStructuredOutput: true,
          tokenizer: { kind: "tiktoken" },
          status: "active",
          addedAt: "2026-10-09",
        },
      ],
    };

    const service = createService(tinySnapshot);

    const result = await service.run({
      description: "A customer support bot.",
      providerId: "anthropic",
      modelId: "tiny-model",
    });

    expect(result).toBeNull();
    const errorMsg = postedMessages.find(
      (m): m is Extract<HostToWebviewMsg, { type: "enhance/error" }> =>
        m.type === "enhance/error"
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.payload.error).toBe("llm-failed");
    expect(errorMsg?.payload.message).toMatch(/is too small for Enhance/i);
  });
});
