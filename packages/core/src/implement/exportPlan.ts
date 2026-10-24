/**
 * Content of the `ai_optimizer/` package the Implement flow exports into the user's workspace:
 * the copied runtime modules plus two generated JSON files, `catalog_techniques.json` (rule
 * techniques + the selected ids) and `router_config.json` (catalog router preset, Router-tab
 * edits, restricted to the user's enabled models). Pure; the host does the file I/O.
 *
 * Exports: ExportFile, TechniquesJson, defaultRouterPreset, ruleTechniqueIds,
 *   buildCatalogTechniquesJson, restrictRouterConfig, planExportFiles
 * Feature: implement optimization (exporter) + model router
 */
import type { RouterConfig, RouterPreset, Strategy } from "../protocol/types.js";
import { ROUTER_TIERS } from "../router/RouterRules.js";

export interface ExportFile {
  /** Workspace-relative posix path. */
  path: string;
  content: string;
}

export interface TechniquesJson {
  selected: string[];
  techniques: Array<{
    id: string;
    mode: "rule";
    ruleId: string;
    order: number;
    affects: "input" | "output" | "both";
    params: Record<string, unknown>;
  }>;
}

/** The catalog's default router preset (or the first one), if any. */
export function defaultRouterPreset(presets: readonly RouterPreset[] | undefined): RouterPreset | undefined {
  return presets?.find((p) => p.isDefault) ?? presets?.[0];
}

const ruleTechniques = (strategies: readonly Strategy[]) =>
  strategies
    .filter((s) => s.optimizer?.mode === "rule" && s.optimizer.ruleId)
    .sort((a, b) => a.optimizer!.order - b.optimizer!.order || (a.id < b.id ? -1 : 1));

/** Rule-technique ids from `ids` (what the Python runtime can run), in catalog order. */
export function ruleTechniqueIds(strategies: readonly Strategy[], ids: readonly string[]): string[] {
  return ruleTechniques(strategies)
    .map((s) => s.id)
    .filter((id) => ids.includes(id));
}

/** `catalog_techniques.json`: every rule technique's params + the selected ids. */
export function buildCatalogTechniquesJson(
  strategies: readonly Strategy[],
  selectedIds: readonly string[]
): TechniquesJson {
  return {
    selected: ruleTechniqueIds(strategies, selectedIds),
    techniques: ruleTechniques(strategies).map((s) => ({
      id: s.id,
      mode: "rule",
      ruleId: s.optimizer!.ruleId!,
      order: s.optimizer!.order,
      affects: s.optimizer!.affects,
      params: { ...(s.optimizer!.params ?? {}) },
    })),
  };
}

/**
 * Keeps only candidates whose model the user enabled (`enabled[providerId]` lists model ids).
 * With no enabled models, or when the filter would empty every tier, the config is unchanged.
 */
export function restrictRouterConfig(
  config: RouterConfig,
  enabled: Readonly<Record<string, readonly string[]>>
): RouterConfig {
  const any = Object.values(enabled).some((ids) => ids.length > 0);
  if (!any) return config;
  const tiers = { ...config.tiers };
  for (const t of ROUTER_TIERS) {
    tiers[t] = config.tiers[t].filter((c) => enabled[c.providerId]?.includes(c.modelId));
  }
  if (ROUTER_TIERS.every((t) => tiers[t].length === 0)) return config;
  return { ...config, tiers };
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/**
 * Files to write: runtime modules (generated JSON names are replaced) + the generated JSONs,
 * sorted by path.
 */
export function planExportFiles(opts: {
  targetDir: string;
  runtimeFiles: ReadonlyArray<{ name: string; content: string }>;
  techniques: TechniquesJson;
  /** Omitted: the runtime's own router_config.json (if any) is copied unchanged. */
  routerConfig?: RouterConfig;
}): ExportFile[] {
  const dir = opts.targetDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const generated: Record<string, string> = { "catalog_techniques.json": json(opts.techniques) };
  if (opts.routerConfig) generated["router_config.json"] = json(opts.routerConfig);
  const files = new Map<string, string>();
  for (const f of opts.runtimeFiles) if (!(f.name in generated)) files.set(f.name, f.content);
  for (const [name, content] of Object.entries(generated)) files.set(name, content);
  return [...files.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, content]) => ({ path: `${dir}/${name}`, content }));
}
