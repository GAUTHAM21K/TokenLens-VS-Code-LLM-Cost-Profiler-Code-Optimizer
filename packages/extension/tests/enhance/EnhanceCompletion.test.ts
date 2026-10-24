/**
 * Tests: Enhance fix (Track A). Host completion of profileVersion/createdAt/schemaVersion and
 * phase defaults, repair prompt listing the exact Zod issues, JSON mode for openai-compatible
 * providers (Groq), prompt field list + example, and effective-date pricing for the call cost.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator (Enhance)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as vscode from "vscode";
import {
  CatalogSnapshotSchema,
  ProjectProfileSchema,
  type CatalogSnapshot,
  type HostToWebviewMsg,
  type ProviderAdapter,
} from "@token-optimizer/core";
import { EnhanceService } from "../../src/enhance/EnhanceService.js";
import { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { KeyService } from "../../src/secrets/KeyService.js";
import {
  LlmProfileSchema,
  PROFILE_SHAPE_PROMPT,
  buildRepairPrompt,
  completeProfile,
  unwrapProfilePayload,
} from "../../src/enhance/profileCompletion.js";
import bundled from "../../resources/catalog-snapshot.json";

const snapshot: CatalogSnapshot = CatalogSnapshotSchema.parse(bundled);
const GROQ_MODEL = "openai/gpt-oss-20b";

class MemoryMemento implements vscode.Memento {
  private store = new Map<string, unknown>();
  keys(): readonly string[] {
    return [...this.store.keys()];
  }
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.store.has(key) ? (this.store.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    this.store.set(key, value);
  }
}

class MemorySecrets implements vscode.SecretStorage {
  private s = new Map<string, string>();
  readonly onDidChange = vi.fn() as unknown as vscode.Event<vscode.SecretStorageChangeEvent>;
  async get(k: string) {
    return this.s.get(k);
  }
  async store(k: string, v: string) {
    this.s.set(k, v);
  }
  async delete(k: string) {
    this.s.delete(k);
  }
}

/** What a model typically sends: no host-owned fields, phases without id/source/confirmed. */
function llmProfile(): Record<string, unknown> {
  return {
    projectType: "rag-chatbot",
    overview: "Support chatbot answering product questions from indexed documentation.",
    techStack: [{ language: "python", framework: "langchain" }],
    llm: { providers: ["groq"], usesRag: true, usesAgents: false, avgPromptTokens: 1800, avgOutputTokens: 400 },
    components: [],
    dataFlow: "Question -> retriever -> LLM -> user",
    phases: [{ phaseTypeId: "query-answering", track: "runtime", name: "Answer questions" }],
    scale: { requestsPerDay: 500 },
    buildAssumptions: { teamSize: 2, sprintWeeks: 2, iterationsPerFeature: 3 },
    constraints: [],
  };
}

describe("profileCompletion helpers", () => {
  it("LLM-facing schema accepts a profile without host-owned fields; the full schema does not", () => {
    expect(LlmProfileSchema.safeParse(llmProfile()).success).toBe(true);
    expect(ProjectProfileSchema.safeParse(llmProfile()).success).toBe(false);
  });

  it("completeProfile fills profileVersion, createdAt, schemaVersion and phase defaults", () => {
    const raw = { ...llmProfile(), finalizedAt: "2026-01-01", profileVersion: 99 };
    const done = completeProfile(raw, {
      profileVersion: 3,
      createdAt: "2026-10-12T00:00:00.000Z",
      catalogPhases: snapshot.phases,
    }) as Record<string, unknown>;
    const parsed = ProjectProfileSchema.parse(done);
    expect(parsed.profileVersion).toBe(3);
    expect(parsed.createdAt).toBe("2026-10-12T00:00:00.000Z");
    expect(parsed.schemaVersion).toBe("1.0");
    expect(parsed.finalizedAt).toBeUndefined();
    expect(parsed.phases[0]).toEqual({
      id: "phase-query-answering",
      phaseTypeId: "query-answering",
      track: "runtime",
      name: "Answer questions",
      source: "llm",
      confirmed: false,
    });
  });

  it("completeProfile takes track and name from the catalog when the model omits them", () => {
    const raw = { ...llmProfile(), phases: [{ phaseTypeId: "architecture" }, { phaseTypeId: "architecture" }] };
    const done = ProjectProfileSchema.parse(
      completeProfile(raw, { profileVersion: 1, createdAt: "x", catalogPhases: snapshot.phases })
    );
    expect(done.phases.map((p) => [p.id, p.track])).toEqual([
      ["phase-architecture", "build"],
      ["phase-architecture-2", "build"],
    ]);
  });

  it("unwrapProfilePayload accepts {narrative, profile} or a bare profile", () => {
    expect(unwrapProfilePayload({ narrative: "n", profile: { a: 1 } })).toEqual({ narrative: "n", profile: { a: 1 } });
    expect(unwrapProfilePayload({ projectType: "x" }).profile).toEqual({ projectType: "x" });
  });

  it("repair prompt lists every Zod issue with path, message and code", () => {
    const bad = { ...llmProfile(), overview: "short", extra: 1, llm: { usesRag: "yes" } };
    const res = LlmProfileSchema.safeParse(bad);
    expect(res.success).toBe(false);
    const prompt = buildRepairPrompt(res.success ? [] : res.error.issues);
    expect(prompt).toContain("- overview: String must contain at least 20 character(s) (too_small)");
    expect(prompt).toContain("- llm.usesRag: Expected boolean, received string (invalid_type)");
    expect(prompt).toContain("- llm.avgPromptTokens: Required (invalid_type)");
    expect(prompt).toContain("Unrecognized key(s) in object: 'extra' (unrecognized_keys)");
    expect(buildRepairPrompt(null)).toContain("not parseable JSON");
  });

  it("the prompt shape lists the fields and carries an example that completes to a valid profile", () => {
    for (const f of ["projectType", "avgPromptTokens", "requestsPerDay", "teamSize", "phaseTypeId"]) {
      expect(PROFILE_SHAPE_PROMPT).toContain(f);
    }
    const example = JSON.parse(PROFILE_SHAPE_PROMPT.slice(PROFILE_SHAPE_PROMPT.indexOf("Example:\n") + 9));
    const done = completeProfile(example.profile, { profileVersion: 1, createdAt: "x", catalogPhases: snapshot.phases });
    expect(ProjectProfileSchema.safeParse(done).success).toBe(true);
  });
});

describe("EnhanceService with Groq (openai-compatible)", () => {
  let posted: HostToWebviewMsg[];
  let adapter: ProviderAdapter;
  let history: ProfileHistoryStore;

  beforeEach(() => {
    posted = [];
    history = new ProfileHistoryStore(new MemoryMemento());
    adapter = { providerId: "groq", validateKey: vi.fn(), listModels: vi.fn(), complete: vi.fn() };
  });

  function service(snap: CatalogSnapshot = snapshot) {
    const keys = new KeyService(new MemorySecrets());
    return new EnhanceService({
      keyService: keys,
      adapters: new Map([["groq", adapter]]),
      getCatalogSnapshot: () => snap,
      postMessage: async (m) => void posted.push(m),
      historyStore: history,
    });
  }

  const run = (svc: EnhanceService) =>
    svc.run({ description: "A support chatbot over our docs.", providerId: "groq", modelId: GROQ_MODEL });

  it("accepts a profile without host fields in one call, using JSON mode and the field list", async () => {
    vi.mocked(adapter.complete).mockResolvedValueOnce({
      content: JSON.stringify({ narrative: "RAG bot.", profile: llmProfile() }),
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    const profile = await run(service());
    expect(profile).not.toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(1);
    const [messages, , opts] = vi.mocked(adapter.complete).mock.calls[0];
    expect(opts).toMatchObject({ model: GROQ_MODEL, responseFormat: "json_object" });
    expect(messages[1].content).toContain(PROFILE_SHAPE_PROMPT);
    expect(profile!.profileVersion).toBe(1);
    expect(profile!.phases[0].confirmed).toBe(false);
    expect(ProjectProfileSchema.safeParse(profile).success).toBe(true);
  });

  it("repairs once with the exact Zod issues in the repair message", async () => {
    vi.mocked(adapter.complete)
      .mockResolvedValueOnce({ content: JSON.stringify({ narrative: "n", profile: { ...llmProfile(), scale: {} } }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ narrative: "n", profile: llmProfile() }) });
    const profile = await run(service());
    expect(profile).not.toBeNull();
    expect(adapter.complete).toHaveBeenCalledTimes(2);
    const repairMessages = vi.mocked(adapter.complete).mock.calls[1][0];
    const last = repairMessages[repairMessages.length - 1].content;
    expect(last).toContain("- scale.requestsPerDay: Required (invalid_type)");
    expect(vi.mocked(adapter.complete).mock.calls[1][2]).toMatchObject({ responseFormat: "json_object" });
  });

  it("does not request JSON mode for adapters without it (anthropic)", async () => {
    const snap = {
      ...snapshot,
      providers: snapshot.providers.map((p) => (p.id === "groq" ? { ...p, adapterType: "anthropic" as const } : p)),
    };
    vi.mocked(adapter.complete).mockResolvedValueOnce({ content: JSON.stringify({ narrative: "n", profile: llmProfile() }) });
    await run(service(snap));
    expect(vi.mocked(adapter.complete).mock.calls[0][2]).not.toHaveProperty("responseFormat");
  });

  it("prices the call with the effective-date lookup, ignoring future-dated rows", async () => {
    const current = snapshot.pricing.find((p) => p.modelId === GROQ_MODEL)!;
    const snap = {
      ...snapshot,
      pricing: [
        { ...current, inputPerMTok: 999, effectiveFrom: "2999-01-01T00:00:00Z" },
        { ...current, effectiveFrom: "2026-01-01T00:00:00Z" },
        ...snapshot.pricing.filter((p) => p.modelId !== GROQ_MODEL),
      ],
    };
    vi.mocked(adapter.complete).mockResolvedValueOnce({
      content: JSON.stringify({ narrative: "n", profile: llmProfile() }),
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    await run(service(snap));
    const result = posted.find((m) => m.type === "enhance/result");
    expect(result?.type === "enhance/result" && result.payload.costUsd).toBeCloseTo(current.inputPerMTok, 6);
  });
});
