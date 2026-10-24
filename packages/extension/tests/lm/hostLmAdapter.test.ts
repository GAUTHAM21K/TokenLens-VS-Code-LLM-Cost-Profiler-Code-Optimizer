/**
 * Tests: HostLmAdapter Unit Tests (T049, FR-007, FR-055, Principle VII).
 *
 * Exports: none (test suite)
 * Feature: providers
 */
import { describe, it, expect, vi } from "vitest";

interface MockVscodeLm {
  selectChatModels?: (...args: unknown[]) => Promise<unknown[]>;
  sendChatRequest?: (...args: unknown[]) => Promise<unknown>;
}

const mockLmState: { lm?: MockVscodeLm } = {};

vi.mock("vscode", () => ({
  get lm() {
    return mockLmState.lm;
  },
  LanguageModelChatMessage: {
    User: (text: string) => ({ role: "user", content: text }),
    Assistant: (text: string) => ({ role: "assistant", content: text }),
  },
  CancellationTokenSource: class {
    token = { isCancellationRequested: false };
  },
}));

import { HostLmAdapter } from "../../src/lm/HostLmAdapter.js";
import type { Provider } from "@token-optimizer/core";

describe("HostLmAdapter Unit Tests (T049, FR-007, FR-055, Principle VII)", () => {
  const sampleProvider: Provider = {
    id: "copilot",
    label: "GitHub Copilot",
    adapterType: "host-lm",
    enabled: true,
    hostLm: {
      vendor: "test-vendor",
      family: "test-family",
    },
  } as unknown as Provider;

  it("extracts selector directly from catalog provider definition with no hardcoded literals", () => {
    const adapter = new HostLmAdapter(sampleProvider);
    expect(adapter.getSelector()).toEqual({
      vendor: "test-vendor",
      family: "test-family",
    });
  });

  it("handles missing vscode.lm gracefully by reporting unavailable", async () => {
    mockLmState.lm = undefined;
    const adapter = new HostLmAdapter(sampleProvider);
    const available = await adapter.isAvailable();
    expect(available).toBe(false);

    const models = await adapter.listModels();
    expect(models).toEqual([]);
  });

  it("queries selectChatModels with the catalog selector", async () => {
    const mockSelect = vi.fn().mockResolvedValue([
      { id: "model-1", name: "Model 1" },
      { id: "model-2", name: "Model 2" },
    ]);

    mockLmState.lm = {
      selectChatModels: mockSelect,
    };

    const adapter = new HostLmAdapter(sampleProvider);
    const available = await adapter.isAvailable();
    expect(available).toBe(true);
    expect(mockSelect).toHaveBeenCalledWith({
      vendor: "test-vendor",
      family: "test-family",
    });

    const models = await adapter.listModels();
    expect(models).toEqual(["model-1", "model-2"]);
  });
});
