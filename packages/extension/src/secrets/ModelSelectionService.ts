/**
 * Resolves enabled models per provider from the catalog and the provider's model list.
 *
 * Exports: ModelSelectionService
 * Feature: settings / API keys
 */
import type { CatalogSnapshot, Model, ProviderAdapter } from "@token-optimizer/core";

export class ModelSelectionService {
  constructor(private readonly adapters: Map<string, ProviderAdapter>) {}

  /**
   * Returns selectable models for a provider by intersecting the provider's
   * active remote models with known catalog models (FR-002).
   */
  public async getSelectableModels(
    providerId: string,
    catalog: CatalogSnapshot,
    getKey?: () => Promise<string>
  ): Promise<Model[]> {
    const catalogModels = (catalog.models || []).filter(
      (m) => m.providerId === providerId && m.status === "active"
    );

    const adapter = this.adapters.get(providerId);
    if (!adapter || !getKey) {
      // Fall back to active catalog models if adapter or key is not available
      return catalogModels;
    }

    try {
      const remoteModelIds = await adapter.listModels(getKey);
      if (!Array.isArray(remoteModelIds) || remoteModelIds.length === 0) {
        return catalogModels;
      }

      const remoteSet = new Set(remoteModelIds);
      // Intersect: return only models present in BOTH catalog and remote response
      return catalogModels.filter((m) => remoteSet.has(m.id));
    } catch {
      // Graceful fallback to catalog models if listModels fails (e.g. offline/network issue)
      return catalogModels;
    }
  }
}
