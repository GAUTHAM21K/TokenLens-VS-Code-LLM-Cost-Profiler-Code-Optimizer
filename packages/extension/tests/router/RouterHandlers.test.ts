/**
 * Unit tests for RouterHandlers: getConfig falls back to the catalog default preset, preview
 * routes with the saved/unsaved config, saveConfig persists to workspaceState, and errors reply
 * a schema-valid router/error.
 *
 * Exports: none (test suite)
 * Feature: model router
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({}));

import { HostToWebviewMsgSchema, type CatalogSnapshot, type RouterConfig } from "@token-optimizer/core";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { FeatureHandlerDeps } from "../../src/webview/handlers/FeatureHandlerDeps.js";
import { RouterHandlers } from "../../src/router/RouterHandlers.js";
import { ROUTER_CONFIG_STATE_KEY } from "../../src/router/routerConfigStore.js";

const config: RouterConfig = {
  presetId: "default",
  tiers: {
    economy: [{ providerId: "groq", modelId: "openai/gpt-oss-20b" }],
    standard: [{ providerId: "groq", modelId: "openai/gpt-oss-120b" }],
    advanced: [{ providerId: "groq", modelId: "qwen/qwen3.8-27b" }],
  },
  rules: { maxCharsForEconomy: 20, advancedKeywords: ["analyze"], needsToolsMinTier: "standard", defaultTier: "standard" },
};

function setup(withPreset = true) {
  const posted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const router = new MessageRouter({
    postMessage: async (m: unknown) => {
      posted.push(HostToWebviewMsgSchema.parse(m) as never);
      return true;
    },
  });
  const store = new Map<string, unknown>();
  const workspaceState = {
    get: (k: string) => store.get(k),
    update: async (k: string, v: unknown) => void store.set(k, v),
    keys: () => [...store.keys()],
  };
  const snapshot = {
    routerPresets: withPreset
      ? [{ id: "default", label: "Default", isDefault: true, version: 1, tiers: config.tiers, rules: config.rules }]
      : [],
  } as unknown as CatalogSnapshot;
  const deps = { router, context: { workspaceState }, getCatalogSnapshot: () => snapshot } as unknown as FeatureHandlerDeps;
  new RouterHandlers(deps).register();
  const send = (type: string, payload: Record<string, unknown>) => router.handleInbound({ version: 1, type, payload });
  return { posted, store, send };
}

describe("RouterHandlers", () => {
  it("getConfig returns the catalog default preset until a config is saved", async () => {
    const { posted, send } = setup();
    await send("router/getConfig", {});
    expect(posted[0]).toEqual({ version: 1, type: "router/config", payload: { config, source: "catalog-default" } });

    const edited = { ...config, rules: { ...config.rules, maxCharsForEconomy: 5 } };
    await send("router/saveConfig", { config: edited });
    expect(posted[1].type).toBe("router/configSaved");
    expect(posted[1].payload.config).toEqual(edited);
    await send("router/getConfig", {});
    expect(posted[2].payload).toEqual({ config: edited, source: "saved" });
  });

  it("preview routes with the saved config, or the unsaved UI config when given", async () => {
    const { posted, send, store } = setup();
    await send("router/preview", { operationId: "p1", text: "hi" });
    expect(posted[0].type).toBe("router/previewResult");
    expect(posted[0].payload).toMatchObject({ operationId: "p1", decision: { tier: "economy", model: "openai/gpt-oss-20b" } });

    await send("router/preview", { text: "hi", needsTools: true });
    expect(posted[1].payload).toMatchObject({ decision: { tier: "standard", provider: "groq" } });

    const ui = { ...config, rules: { ...config.rules, advancedKeywords: ["hi"] } };
    await send("router/preview", { text: "hi", config: ui });
    expect(posted[2].payload).toMatchObject({ decision: { tier: "advanced" } });

    store.set(ROUTER_CONFIG_STATE_KEY, { config: { ...config, rules: { ...config.rules, maxCharsForEconomy: 0 } }, savedAt: "x" });
    await send("router/preview", { text: "hi" });
    expect(posted[3].payload).toMatchObject({ decision: { tier: "standard" } });
  });

  it("replies router/error without a preset or with an all-empty config", async () => {
    const { posted, send } = setup(false);
    await send("router/getConfig", {});
    await send("router/preview", { operationId: "p2", text: "x" });
    const empty = { ...config, tiers: { economy: [], standard: [], advanced: [] } };
    await send("router/preview", { operationId: "p3", text: "x", config: empty });
    expect(posted.map((m) => [m.type, m.payload.error, m.payload.operationId])).toEqual([
      ["router/error", "invalid-request", undefined],
      ["router/error", "invalid-request", "p2"],
      ["router/error", "invalid-request", "p3"],
    ]);
  });
});
