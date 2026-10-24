/**
 * Props shared by the v2 feature views (Prompt Optimizer, Implement, Router). App.tsx owns the
 * catalog and the cross-tab technique selection and passes them down; each view subscribes to
 * its own host messages via vscodeBridge. FROZEN CONTRACT for Phase 1 view tracks.
 *
 * Exports: CatalogViewData, FeatureViewProps, ModelRef
 * Feature: webview shell (all v2 features)
 */
import type {
  Model,
  Pricing,
  Provider,
  RouterPreset,
  Strategy,
} from "@token-optimizer/core";

export interface CatalogViewData {
  providers: Provider[];
  models: Model[];
  pricing: Pricing[];
  /** Approved techniques (catalog `strategies`), shared by estimator and prompt optimizer. */
  strategies: Strategy[];
  routerPresets: RouterPreset[];
  /** null until the first `catalog/updated` arrives. */
  isOffline: boolean | null;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
  keySlot?: number;
}

export interface FeatureViewProps {
  catalog: CatalogViewData;
  /** Techniques selected on the Optimize tab (pre-selection for the other tabs). */
  selectedTechniqueIds: string[];
  /** Enhance model from Settings, else the first usable catalog model; undefined = ask the user. */
  defaultModel?: ModelRef;
  /** Provider ids that have a stored API key. */
  configuredProviderIds: string[];
}
