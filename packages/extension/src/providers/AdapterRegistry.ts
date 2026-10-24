/**
 * Builds the provider-adapter map from the catalog instead of a hard-coded list: each enabled
 * catalog provider gets the adapter for its `adapterType` (the plan's "adapterKind"), with the
 * catalog `baseUrl`. This is what makes Groq (openai-compatible) work without code changes.
 *
 * Exports: createAdapterForProvider, syncAdaptersFromCatalog
 * Feature: providers (shared by Enhance, key validation, prompt optimizer llm techniques)
 */
import {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  MistralAdapter,
  OpenAICompatibleAdapter,
  type CatalogSnapshot,
  type Provider,
  type ProviderAdapter,
} from "@token-optimizer/core";

/** Returns an adapter for a catalog provider, or null when it is disabled or host-managed. */
export function createAdapterForProvider(
  provider: Provider,
  fetchFn?: typeof fetch
): ProviderAdapter | null {
  if (!provider.enabled) return null;
  const baseUrl = provider.baseUrl || undefined;
  switch (provider.adapterType) {
    case "anthropic":
      return new AnthropicAdapter({ baseUrl, fetchFn });
    case "openai":
      return new OpenAIAdapter({ baseUrl, fetchFn });
    case "google":
      return new GoogleAdapter({ baseUrl, fetchFn });
    case "mistral":
      return new MistralAdapter({ baseUrl, fetchFn });
    case "openai-compatible":
      if (!baseUrl) return null;
      return new OpenAICompatibleAdapter({ providerId: provider.id, baseUrl, fetchFn });
    case "host-lm":
      return null; // served by HostLmAdapter (VS Code LM API), not an HTTP adapter
    default:
      return null;
  }
}

/**
 * Replaces the contents of `target` (kept by reference in the services) with adapters for the
 * snapshot's providers. Call on every catalog update.
 */
export function syncAdaptersFromCatalog(
  target: Map<string, ProviderAdapter>,
  snapshot: CatalogSnapshot,
  fetchFn?: typeof fetch
): void {
  target.clear();
  for (const provider of snapshot.providers) {
    const adapter = createAdapterForProvider(provider, fetchFn);
    if (adapter) target.set(provider.id, adapter);
  }
}
