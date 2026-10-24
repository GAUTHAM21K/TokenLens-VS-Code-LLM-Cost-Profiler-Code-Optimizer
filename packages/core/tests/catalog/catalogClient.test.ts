/**
 * Tests: CatalogClient Unit Tests (T039, FR-043, FR-045, Principle X).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect, vi } from "vitest";
import {
  CatalogClient,
  MemoryCatalogStorage,
  type CatalogSnapshot,
} from "../../src/index.js";

const sampleValidSnapshot: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00Z",
  providers: [
    {
      id: "anthropic",
      label: "Anthropic Claude",
      adapterType: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      keyFormatHint: "sk-ant-...",
      enabled: true,
    },
  ],
  models: [
    {
      id: "claude-3-5-sonnet-20241022",
      providerId: "anthropic",
      label: "Claude 3.5 Sonnet",
      contextWindow: 200000,
      maxOutput: 8192,
      tier: "frontier",
      supportsCaching: true,
      supportsBatch: true,
      supportsStructuredOutput: true,
      tokenizer: {
        kind: "anthropic-endpoint",
      },
      status: "active",
      addedAt: "2026-10-09T00:00:00Z",
    },
  ],
  pricing: [
    {
      modelId: "claude-3-5-sonnet-20241022",
      currency: "USD",
      inputPerMTok: 3.0,
      outputPerMTok: 15.0,
      effectiveFrom: "2026-10-01T00:00:00Z",
      sourceUrl: "https://www.anthropic.com/pricing",
      verifiedAt: "2026-10-09T00:00:00Z",
    },
  ],
  phases: [
    {
      id: "architecture",
      name: "Architecture",
      track: "build",
      sortOrder: 1,
      description: "Architecture phase",
      archetypes: ["general"],
      defaultParams: {
        callsLow: 1,
        callsExpected: 5,
        callsHigh: 10,
        tokensPerCallLow: 500,
        tokensPerCallExpected: 2000,
        tokensPerCallHigh: 5000,
        retriesLow: 0,
        retriesExpected: 1,
        retriesHigh: 2,
      },
    },
  ],
  strategies: [
    {
      id: "prompt-caching",
      name: "Prompt Caching",
      group: "caching",
      targets: ["build", "runtime"],
      summary: "Enable prompt caching",
      savings: {
        minPercent: 30,
        maxPercent: 70,
        basis: "Cache read rates",
      },
      reviewStatus: "approved",
      reviewedBy: "Ada Lovelace",
      reviewedAt: "2026-10-09T00:00:00Z",
    },
  ],
  platforms: [
    {
      id: "vscode",
      label: "VS Code",
      detect: { appNames: ["Code"] },
      artifactTargets: [
        {
          kind: "instruction",
          pathTemplate: ".vscode/instructions.md",
          format: "markdown",
        },
      ],
      isDefault: true,
    },
  ],
  promptTemplates: [
    {
      id: "enhance-default",
      version: 1,
      purpose: "enhance",
      template: "Template {{var}}",
      active: true,
    },
  ],
};

describe("CatalogClient Unit Tests (T039, FR-043, FR-045, Principle X)", () => {
  it("Scenario 1: 200 OK fetches, Zod-validates, caches snapshot and ETag", async () => {
    const storage = new MemoryCatalogStorage();
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ etag: '"sha-12345"' }),
      json: async () => sampleValidSnapshot,
    });

    const client = new CatalogClient({
      baseUrl: "https://catalog.token-optimizer.dev/v1",
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.getCatalogSnapshot();

    expect(result.snapshot.version).toBe(1);
    expect(result.fromCache).toBe(false);
    expect(result.isOffline).toBe(false);
    expect(result.etag).toBe('"sha-12345"');

    // Storage should contain cached snapshot and ETag
    expect(await storage.get("catalog:snapshot")).toEqual(sampleValidSnapshot);
    expect(await storage.get("catalog:etag")).toBe('"sha-12345"');
  });

  it("Scenario 2: 304 Not Modified short-circuits and returns cached snapshot", async () => {
    const storage = new MemoryCatalogStorage();
    await storage.set("catalog:snapshot", sampleValidSnapshot);
    await storage.set("catalog:etag", '"sha-12345"');

    const mockFetch = vi.fn().mockImplementation((url, init) => {
      expect(init.headers["If-None-Match"]).toBe('"sha-12345"');
      return Promise.resolve({
        status: 304,
        headers: new Headers(),
      });
    });

    const client = new CatalogClient({
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.getCatalogSnapshot();

    expect(result.snapshot).toEqual(sampleValidSnapshot);
    expect(result.fromCache).toBe(true);
    expect(result.isOffline).toBe(false);
    expect(result.etag).toBe('"sha-12345"');
  });

  it("Scenario 3a: Network error with cache returns cached snapshot with isOffline=true", async () => {
    const storage = new MemoryCatalogStorage();
    await storage.set("catalog:snapshot", sampleValidSnapshot);
    await storage.set("catalog:etag", '"sha-12345"');

    const mockFetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const client = new CatalogClient({
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const result = await client.getCatalogSnapshot();

    expect(result.snapshot).toEqual(sampleValidSnapshot);
    expect(result.fromCache).toBe(true);
    expect(result.isOffline).toBe(true);
  });

  it("Scenario 3b: Network error without cache throws error for caller fallback", async () => {
    const storage = new MemoryCatalogStorage();
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network offline"));

    const client = new CatalogClient({
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getCatalogSnapshot()).rejects.toThrow("Network offline");
  });

  it("Scenario 4: Rejects malformed payload with Zod error and does not cache", async () => {
    const storage = new MemoryCatalogStorage();
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ etag: '"sha-bad"' }),
      json: async () => ({ invalid: "corrupted payload" }),
    });

    const client = new CatalogClient({
      storage,
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    await expect(client.getCatalogSnapshot()).rejects.toThrow();
    expect(await storage.get("catalog:snapshot")).toBeUndefined();
    expect(await storage.get("catalog:etag")).toBeUndefined();
  });
});
