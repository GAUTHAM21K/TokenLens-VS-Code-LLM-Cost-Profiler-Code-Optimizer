/**
 * Tests for the catalog-driven adapter map: Groq (openai-compatible) is registered from the
 * bundled catalog, disabled/host-lm providers are skipped, and the map is refreshed in place.
 *
 * Exports: none (test suite)
 * Feature: providers
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CatalogSnapshotSchema,
  OpenAICompatibleAdapter,
  type ProviderAdapter,
} from "@token-optimizer/core";
import {
  createAdapterForProvider,
  syncAdaptersFromCatalog,
} from "../../src/providers/AdapterRegistry.js";

const snapshot = CatalogSnapshotSchema.parse(
  JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../../resources/catalog-snapshot.json"), "utf-8")
  )
);

describe("AdapterRegistry", () => {
  it("registers every enabled catalog provider, including Groq via openai-compatible", () => {
    const map = new Map<string, ProviderAdapter>();
    syncAdaptersFromCatalog(map, snapshot);
    for (const p of snapshot.providers.filter((x) => x.enabled)) {
      expect(map.has(p.id)).toBe(true);
    }
    const groq = map.get("groq");
    expect(groq).toBeInstanceOf(OpenAICompatibleAdapter);
    expect((groq as OpenAICompatibleAdapter).getBaseUrl()).toBe("https://api.groq.com/openai/v1");
    expect(groq?.providerId).toBe("groq");
  });

  it("skips disabled and host-lm providers and refreshes the map in place", () => {
    const base = snapshot.providers.find((p) => p.id === "groq")!;
    expect(createAdapterForProvider({ ...base, enabled: false })).toBeNull();
    expect(createAdapterForProvider({ ...base, adapterType: "host-lm" })).toBeNull();

    const map = new Map<string, ProviderAdapter>([["stale", {} as ProviderAdapter]]);
    syncAdaptersFromCatalog(map, { ...snapshot, providers: [base] });
    expect([...map.keys()]).toEqual(["groq"]);
  });
});
