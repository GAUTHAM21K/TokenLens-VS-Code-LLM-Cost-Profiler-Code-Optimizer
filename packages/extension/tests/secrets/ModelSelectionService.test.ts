/**
 * Tests: ModelSelectionService Unit Tests (T051, FR-002, US1).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect, vi } from "vitest";
import { ModelSelectionService } from "../../src/secrets/ModelSelectionService.js";
import type { CatalogSnapshot, ProviderAdapter, Model } from "@token-optimizer/core";

const mockSnapshot: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00Z",
  providers: [],
  models: [
    {
      id: "claude-3-5-sonnet",
      providerId: "anthropic",
      label: "Claude 3.5 Sonnet",
      contextWindow: 200000,
      tier: "frontier",
      status: "active",
      supportsCaching: true,
      supportsBatch: true,
      supportsStructuredOutput: true,
    } as unknown as Model,
    {
      id: "claude-3-5-haiku",
      providerId: "anthropic",
      label: "Claude 3.5 Haiku",
      contextWindow: 200000,
      tier: "fast",
      status: "active",
      supportsCaching: true,
      supportsBatch: true,
      supportsStructuredOutput: true,
    } as unknown as Model,
    {
      id: "claude-2-deprecated",
      providerId: "anthropic",
      label: "Claude 2",
      contextWindow: 100000,
      tier: "legacy",
      status: "deprecated",
      supportsCaching: false,
      supportsBatch: false,
      supportsStructuredOutput: false,
    } as unknown as Model,
  ],
  pricing: [],
  phases: [],
  strategies: [],
  platforms: [],
  promptTemplates: [],
};

describe("ModelSelectionService Unit Tests (T051, FR-002, US1)", () => {
  it("intersects adapter remote models with active catalog models", async () => {
    const mockAdapter: ProviderAdapter = {
      providerId: "anthropic",
      validateKey: vi.fn(),
      listModels: vi.fn().mockResolvedValue([
        "claude-3-5-sonnet",
        "unknown-future-model", // not in catalog
      ]),
      complete: vi.fn(),
    };

    const service = new ModelSelectionService(
      new Map([["anthropic", mockAdapter]])
    );

    const result = await service.getSelectableModels(
      "anthropic",
      mockSnapshot,
      async () => "key"
    );

    expect(result.map((m) => m.id)).toEqual(["claude-3-5-sonnet"]);
  });

  it("returns empty array without error when intersection is empty", async () => {
    const mockAdapter: ProviderAdapter = {
      providerId: "anthropic",
      validateKey: vi.fn(),
      listModels: vi.fn().mockResolvedValue(["non-matching-id"]),
      complete: vi.fn(),
    };

    const service = new ModelSelectionService(
      new Map([["anthropic", mockAdapter]])
    );

    const result = await service.getSelectableModels(
      "anthropic",
      mockSnapshot,
      async () => "key"
    );

    expect(result).toEqual([]);
  });

  it("falls back to active catalog models when adapter fails or network error occurs", async () => {
    const mockAdapter: ProviderAdapter = {
      providerId: "anthropic",
      validateKey: vi.fn(),
      listModels: vi.fn().mockRejectedValue(new Error("Network error")),
      complete: vi.fn(),
    };

    const service = new ModelSelectionService(
      new Map([["anthropic", mockAdapter]])
    );

    const result = await service.getSelectableModels(
      "anthropic",
      mockSnapshot,
      async () => "key"
    );

    expect(result.map((m) => m.id)).toEqual([
      "claude-3-5-sonnet",
      "claude-3-5-haiku",
    ]);
  });
});
