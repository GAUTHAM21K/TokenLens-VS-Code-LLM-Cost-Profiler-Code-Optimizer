/**
 * Tests: BundledSnapshotLoader Unit Tests (T033, Principle X).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect } from "vitest";
import { BundledSnapshotLoader } from "../../src/index.js";

const sampleValidJson = JSON.stringify({
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
      id: "claude-3-5-sonnet",
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
      modelId: "claude-3-5-sonnet",
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
});

describe("BundledSnapshotLoader Unit Tests (T033, Principle X)", () => {
  it("loads and validates bundled catalog snapshot JSON via injected readFile", async () => {
    const loader = new BundledSnapshotLoader(async () => sampleValidJson);

    const snapshot = await loader.load("mock-snapshot.json");

    expect(snapshot.version).toBe(1);
    expect(snapshot.schemaVersion).toBe("1.0");
    expect(snapshot.providers.length).toBe(1);
    expect(snapshot.models.length).toBe(1);
    expect(snapshot.pricing.length).toBe(1);
    expect(snapshot.phases.length).toBe(1);
    expect(snapshot.platforms.length).toBe(1);
  });

  it("throws descriptive error when JSON syntax is corrupted", async () => {
    const loader = new BundledSnapshotLoader(async () => "{ invalid json syntax ");

    await expect(loader.load("mock-path.json")).rejects.toThrow(
      "Failed to parse bundled snapshot JSON"
    );
  });

  it("throws descriptive error when JSON schema is invalid", async () => {
    const loader = new BundledSnapshotLoader(async () =>
      JSON.stringify({ version: "not-a-number" })
    );

    await expect(loader.load("mock-path.json")).rejects.toThrow(
      "failed schema validation"
    );
  });
});
