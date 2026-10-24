/**
 * Workspace-scoped storage of the Router tab's config (VS Code workspaceState) and resolution of
 * the effective RouterConfig: saved config, else the catalog's default router preset.
 * Shared by RouterHandlers (preview/get/save) and the Implement exporter (router_config.json).
 *
 * Exports: ROUTER_CONFIG_STATE_KEY, StoredRouterConfig, ResolvedRouterConfig, loadSavedRouterConfig,
 *   saveRouterConfig, resolveRouterConfig
 * Feature: model router
 */
import type * as vscode from "vscode";
import {
  RouterConfigSchema,
  defaultRouterPreset,
  presetToRouterConfig,
  type CatalogSnapshot,
  type RouterConfig,
} from "@token-optimizer/core";

export const ROUTER_CONFIG_STATE_KEY = "tokenOptimizer.routerConfig";

export interface StoredRouterConfig {
  config: RouterConfig;
  savedAt: string;
}

export interface ResolvedRouterConfig {
  config: RouterConfig;
  source: "saved" | "catalog-default";
}

/** The saved config, or null when absent or no longer schema-valid. */
export function loadSavedRouterConfig(state: vscode.Memento): StoredRouterConfig | null {
  const raw = state.get<StoredRouterConfig>(ROUTER_CONFIG_STATE_KEY);
  if (!raw) return null;
  const parsed = RouterConfigSchema.safeParse(raw.config);
  return parsed.success ? { config: parsed.data, savedAt: String(raw.savedAt ?? "") } : null;
}

export async function saveRouterConfig(state: vscode.Memento, config: RouterConfig): Promise<StoredRouterConfig> {
  const stored = { config, savedAt: new Date().toISOString() };
  await state.update(ROUTER_CONFIG_STATE_KEY, stored);
  return stored;
}

/** Saved config, else the catalog default preset, else null (no preset in the catalog). */
export function resolveRouterConfig(
  state: vscode.Memento,
  snapshot: CatalogSnapshot | null
): ResolvedRouterConfig | null {
  const saved = loadSavedRouterConfig(state);
  if (saved) return { config: saved.config, source: "saved" };
  const preset = defaultRouterPreset(snapshot?.routerPresets);
  return preset ? { config: presetToRouterConfig(preset), source: "catalog-default" } : null;
}
