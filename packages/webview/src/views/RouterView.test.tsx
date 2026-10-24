/**
 * Tests: Router tab — requests the config on mount, renders the tier table, edits candidates and
 * rules, live preview with the unsaved config (stale results ignored), save, export through
 * implement/export, and reset to the catalog preset.
 *
 * Exports: none (test suite)
 * Feature: model router
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import type { HostToWebviewMsg, Model, RouterConfig, RouterPreset, Strategy } from "@token-optimizer/core";
import { RouterView } from "./RouterView";
import { vscodeBridge } from "../protocol/vscode";
import type { CatalogViewData } from "./viewProps";
import { parseKeywords } from "../components/router/RouterConfigEditor";

const config: RouterConfig = {
  presetId: "default",
  tiers: {
    economy: [{ providerId: "groq", modelId: "openai/gpt-oss-20b" }],
    standard: [{ providerId: "groq", modelId: "openai/gpt-oss-120b" }],
    advanced: [{ providerId: "groq", modelId: "qwen/qwen3.8-27b" }],
  },
  rules: { maxCharsForEconomy: 600, advancedKeywords: ["analyze", "debug"], needsToolsMinTier: "standard", defaultTier: "standard" },
};

const catalog: CatalogViewData = {
  providers: [],
  models: [
    { id: "openai/gpt-oss-20b", providerId: "groq" },
    { id: "gpt-4o-mini", providerId: "openai" },
  ] as unknown as Model[],
  pricing: [],
  strategies: [
    { id: "filler-removal", name: "Filler", optimizer: { mode: "rule", ruleId: "f", order: 20, affects: "input" } },
  ] as unknown as Strategy[],
  routerPresets: [{ id: "default", label: "Default", isDefault: true, version: 1, tiers: config.tiers, rules: config.rules }] as RouterPreset[],
  isOffline: true,
};

const host = (msg: HostToWebviewMsg) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: msg }));
  });

describe("RouterView", () => {
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    post = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});
  });
  type Sent = { type: string; payload: { operationId?: string; text?: string; config?: RouterConfig } & Record<string, unknown> };
  const sent = () => post.mock.calls.map((c) => c[0] as Sent);
  const lastPreview = () => sent().filter((m) => m.type === "router/preview").at(-1);

  async function mount() {
    render(<RouterView catalog={catalog} selectedTechniqueIds={["filler-removal", "llm-compress"]} configuredProviderIds={[]} />);
    expect(sent()[0].type).toBe("router/getConfig");
    await host({ version: 1, type: "router/config", payload: { config, source: "catalog-default" } });
  }

  it("renders the tier table and previews live with the current config", async () => {
    await mount();
    expect(within(screen.getByTestId("tier-economy")).getByText("groq/openai/gpt-oss-20b")).toBeTruthy();
    expect(screen.getByText('Catalog preset "default"')).toBeTruthy();
    await waitFor(() => expect(lastPreview()).toBeTruthy());
    const p = lastPreview()!;
    expect(p.payload).toMatchObject({ needsTools: false, config });
    await host({
      version: 1,
      type: "router/previewResult",
      payload: { operationId: p.payload.operationId, decision: { model: "openai/gpt-oss-20b", provider: "groq", tier: "economy", reason: "short prompt (46 <= 600 chars)" } },
    });
    const d = screen.getByTestId("route-decision");
    expect(d.textContent).toContain("economy");
    expect(d.textContent).toContain("groq/openai/gpt-oss-20b");
    expect(d.textContent).toContain("short prompt");

    // a stale (older) result is ignored once a newer preview was requested
    fireEvent.change(screen.getByLabelText("Prompt to route"), { target: { value: "Please analyze this" } });
    await waitFor(() => expect(lastPreview()!.payload.text).toBe("Please analyze this"));
    await host({
      version: 1,
      type: "router/previewResult",
      payload: { operationId: p.payload.operationId, decision: { model: "x", provider: "y", tier: "standard", reason: "old" } },
    });
    expect(screen.getByTestId("route-decision").textContent).not.toContain("old");
  });

  it("edits rules and candidates, previews the unsaved config, saves and exports", async () => {
    await mount();
    fireEvent.change(screen.getByLabelText("Max chars for economy"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Advanced keywords"), { target: { value: "refactor, prove" } });
    fireEvent.change(screen.getByLabelText("Add model to economy"), { target: { value: "openai\u0000gpt-4o-mini" } });
    fireEvent.click(screen.getByLabelText("Add to economy"));
    fireEvent.click(screen.getByLabelText("Move gpt-4o-mini up"));
    fireEvent.change(screen.getByLabelText("3. Default tier"), { target: { value: "advanced" } });
    expect(screen.getByText(/unsaved changes/)).toBeTruthy();

    const expected: RouterConfig = {
      ...config,
      tiers: { ...config.tiers, economy: [{ providerId: "openai", modelId: "gpt-4o-mini" }, ...config.tiers.economy] },
      rules: { ...config.rules, maxCharsForEconomy: 5, advancedKeywords: ["refactor", "prove"], defaultTier: "advanced" },
    };
    await waitFor(() => expect(lastPreview()!.payload.config).toEqual(expected));

    fireEvent.click(screen.getByText("Save config"));
    fireEvent.click(screen.getByText("Export to ai_optimizer"));
    const [save, exp] = sent().filter((m) => m.type === "router/saveConfig" || m.type === "implement/export");
    expect(save.payload).toEqual({ config: expected });
    expect(exp.payload).toMatchObject({ techniqueIds: ["filler-removal"], routerConfig: expected });

    await host({ version: 1, type: "router/configSaved", payload: { config: expected, savedAt: "2026-10-12T00:00:00.000Z" } });
    expect(screen.getByText("Saved workspace config")).toBeTruthy();
    await host({
      version: 1,
      type: "implement/exported",
      payload: { operationId: exp.payload.operationId, targetDir: "ai_optimizer", filesWritten: ["a", "b"] },
    });
    expect(screen.getByText("Exported 2 files to ai_optimizer/")).toBeTruthy();

    fireEvent.click(screen.getByText("Reset to catalog preset"));
    await waitFor(() => expect(lastPreview()!.payload.config).toEqual(config));
    expect((screen.getByLabelText("Advanced keywords") as HTMLInputElement).value).toBe("analyze, debug");
  });

  it("removes candidates and shows router errors", async () => {
    await mount();
    fireEvent.click(screen.getByLabelText("Remove qwen/qwen3.8-27b"));
    expect(within(screen.getByTestId("tier-advanced")).getByText(/empty/)).toBeTruthy();
    await host({ version: 1, type: "router/error", payload: { error: "invalid-request", message: "No candidates." } });
    expect(screen.getByText("No candidates.")).toBeTruthy();
  });

  it("parseKeywords trims, splits and dedupes", () => {
    expect(parseKeywords(" a, b\nb ,, c ")).toEqual(["a", "b", "c"]);
  });
});
