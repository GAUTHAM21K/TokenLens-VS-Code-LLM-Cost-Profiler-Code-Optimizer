/**
 * Tests for PromptOptHandlers: `promptopt/run` -> schema-valid `promptopt/result` (rules only, and
 * with llm-compress through a spy adapter), `promptopt/error` for llm failures (rule-only result
 * still sent), missing catalog and unknown model.
 *
 * Exports: none (test suite)
 * Feature: prompt optimizer
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import {
  HostToWebviewMsgSchema,
  type CatalogSnapshot,
  type HostToWebviewMsg,
  type PromptOptRunMsg,
  type ProviderAdapter,
} from "@token-optimizer/core";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { FeatureHandlerDeps } from "../../src/webview/handlers/FeatureHandlerDeps.js";
import { PromptOptHandlers } from "../../src/promptopt/PromptOptHandlers.js";

function setup(snapshot: CatalogSnapshot | null, complete?: ProviderAdapter["complete"]) {
  const posted: HostToWebviewMsg[] = [];
  const router = new MessageRouter({
    postMessage: async (m: unknown) => {
      posted.push(HostToWebviewMsgSchema.parse(m));
      return true;
    },
  });
  const adapters = new Map<string, ProviderAdapter>();
  if (complete) adapters.set("groq", { providerId: "groq", complete } as unknown as ProviderAdapter);
  const keyService = { getKeyGetter: () => async () => "test-key" };
  const deps = { router, adapters, keyService, getCatalogSnapshot: () => snapshot } as unknown as FeatureHandlerDeps;
  const handlers = new PromptOptHandlers(deps);
  handlers.register();
  return { posted, handlers, router };
}

const run = (payload: Partial<PromptOptRunMsg["payload"]> = {}): PromptOptRunMsg => ({
  version: 1,
  type: "promptopt/run",
  payload: {
    operationId: "op1",
    messages: [{ role: "user", content: "Could you please summarize the report? Summarize the report." }],
    techniqueIds: ["filler-removal", "dedupe-sentences", "max-output-cap"],
    providerId: "groq",
    modelId: "openai/gpt-oss-20b",
    ...payload,
  },
});

async function loadSnapshot(): Promise<CatalogSnapshot> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(new URL("../../resources/catalog-snapshot.json", import.meta.url), "utf8");
  return JSON.parse(raw) as CatalogSnapshot;
}

describe("PromptOptHandlers", () => {
  it("answers a rule-only run with a promptopt/result", async () => {
    const { posted, handlers } = setup(await loadSnapshot());
    await handlers.run(run());
    expect(posted.map((m) => m.type)).toEqual(["promptopt/result"]);
    const p = posted[0]!.payload as Extract<HostToWebviewMsg, { type: "promptopt/result" }>["payload"];
    expect(p.operationId).toBe("op1");
    expect(p.optimized.messages[0]!.content).toBe("Summarize the report?");
    expect(p.optimized.params.max_tokens).toBe(512);
    expect(p.steps).toHaveLength(3);
    expect(p.optimized.inputTokens).toBeLessThan(p.original.inputTokens);
    expect(p.cost!.usdPer1kCallsAfter).toBeLessThan(p.cost!.usdPer1kCallsBefore);
  });

  it("runs llm-compress through the selected model's adapter", async () => {
    const complete = vi.fn().mockResolvedValue({ content: "Summarize report.", inputTokens: 50, outputTokens: 4 });
    const { posted, handlers } = setup(await loadSnapshot(), complete);
    await handlers.run(run({ techniqueIds: ["llm-compress"] }));
    expect(complete).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), { model: "openai/gpt-oss-20b", temperature: 0 });
    const p = posted[0]!.payload as Extract<HostToWebviewMsg, { type: "promptopt/result" }>["payload"];
    expect(p.optimized.messages[0]!.content).toBe("Summarize report.");
    expect(p.llmUsage!.inputTokens).toBe(50);
  });

  it("llm failure sends the rule-only result and a promptopt/error", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("No key configured for provider 'groq' (slot 0)"));
    const { posted, handlers } = setup(await loadSnapshot(), complete);
    await handlers.run(run({ techniqueIds: ["llm-compress", "filler-removal"] }));
    expect(posted.map((m) => m.type)).toEqual(["promptopt/result", "promptopt/error"]);
    expect(posted[1]!.payload).toMatchObject({ operationId: "op1", error: "no-key" });
    expect((posted[1]!.payload as { message: string }).message).toContain("Rule techniques were still applied.");
  });

  it("errors without a catalog or for an unknown model", async () => {
    const a = setup(null);
    await a.handlers.run(run());
    expect(a.posted[0]!.payload).toMatchObject({ error: "invalid-request" });
    const b = setup(await loadSnapshot());
    await b.handlers.run(run({ modelId: "nope" }));
    expect(b.posted[0]!.payload).toMatchObject({ error: "no-model" });
  });

  it("is registered on the router for promptopt/run", async () => {
    const { posted, router } = setup(await loadSnapshot());
    expect(await router.handleInbound(run())).toBe(true);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.type).toBe("promptopt/result");
  });
});
