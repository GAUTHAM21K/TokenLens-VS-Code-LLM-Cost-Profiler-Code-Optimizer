/**
 * Tests: Estimate View Component (T073, T074, T134, T135, US3, FR-017-FR-024).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Estimate } from "./Estimate";
import { vscodeBridge } from "../protocol/vscode";
import type {
  EstimationResult,
  Model,
  Pricing,
  Phase as CatalogPhase,
} from "@token-optimizer/core";

const mockCatalogPhases: CatalogPhase[] = [
  {
    id: "architecture",
    name: "Architecture & Scaffolding",
    track: "build",
    sortOrder: 1,
    description: "Initial scoping and scaffolding prompts.",
    archetypes: ["general"],
    defaultParams: {
      callsLow: 1,
      callsExpected: 5,
      callsHigh: 15,
      tokensPerCallLow: 1000,
      tokensPerCallExpected: 4000,
      tokensPerCallHigh: 10000,
      retriesLow: 0,
      retriesExpected: 1,
      retriesHigh: 3,
    },
  },
  {
    id: "query-answering",
    name: "Runtime Query Processing",
    track: "runtime",
    sortOrder: 2,
    description: "User queries processed by runtime RAG and generation pipelines.",
    archetypes: ["general"],
    defaultParams: {
      callsLow: 100,
      callsExpected: 500,
      callsHigh: 2000,
      tokensPerCallLow: 500,
      tokensPerCallExpected: 2000,
      tokensPerCallHigh: 5000,
      retriesLow: 0,
      retriesExpected: 0,
      retriesHigh: 1,
    },
  },
];

const mockModels: Model[] = [
  {
    id: "gpt-4o",
    providerId: "openai",
    label: "GPT-4o",
    contextWindow: 128000,
    maxOutput: 4096,
    tier: "frontier",
    supportsCaching: true,
    supportsBatch: true,
    supportsStructuredOutput: true,
    tokenizer: { kind: "tiktoken" },
    status: "active",
    addedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "mistral-large-2407",
    providerId: "mistral",
    label: "Mistral Large",
    contextWindow: 128000,
    maxOutput: 4096,
    tier: "advanced",
    supportsCaching: false,
    supportsBatch: false,
    supportsStructuredOutput: true,
    tokenizer: { kind: "char-approx" },
    status: "active",
    addedAt: "2026-01-01T00:00:00.000Z",
  },
];

const mockPricing: Pricing[] = [
  {
    modelId: "gpt-4o",
    currency: "USD",
    inputPerMTok: 2.5,
    outputPerMTok: 10.0,
    cachedInputPerMTok: 1.25,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://mock.webview.test/pricing",
    verifiedAt: "2026-10-09T00:00:00.000Z",
  },
  {
    modelId: "mistral-large-2407",
    currency: "USD",
    inputPerMTok: 2.0,
    outputPerMTok: 6.0,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    sourceUrl: "https://mock.webview.test/pricing",
    verifiedAt: "2026-10-09T00:00:00.000Z",
  },
];

const mockEstimation: EstimationResult = {
  profileVersion: 1,
  currency: "USD",
  build: {
    phases: [
      {
        phaseId: "phase-architecture",
        phaseName: "Architecture & Scaffolding",
        params: {
          calls: { low: 1, expected: 5, high: 15 },
          tokensPerCall: { low: 1000, expected: 4000, high: 10000 },
          retries: { low: 0, expected: 1, high: 3 },
          volumeMultiplier: { low: 1, expected: 1, high: 1 },
        },
        tokensByModel: {
          "gpt-4o": {
            inputTokens: 120000,
            outputTokens: 40000,
            cachedInputTokens: 0,
            totalTokens: 160000,
            label: "exact",
          },
        },
        costByModel: {
          "gpt-4o": {
            low: 0.02,
            expected: 0.8,
            high: 12.0,
            currency: "USD",
            pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
          },
        },
        explainTree: {
          label: "Phase Cost: Architecture & Scaffolding",
          formula: "(regularInputCost + cachedInputCost + outputCost)",
          inputs: { calls: 5, tokensPerCall: 4000 },
          result: 0.8,
        },
      },
    ],
    totalByModel: {
      "gpt-4o": {
        low: 0.02,
        expected: 0.8,
        high: 12.0,
        currency: "USD",
        pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
      },
      "mistral-large-2407": {
        low: 0.015,
        expected: 0.6,
        high: 9.0,
        currency: "USD",
        pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
      },
    },
  },
  runtime: {
    phases: [
      {
        phaseId: "phase-query-answering",
        phaseName: "Runtime Query Processing",
        params: {
          calls: { low: 100, expected: 500, high: 2000 },
          tokensPerCall: { low: 500, expected: 2000, high: 5000 },
          retries: { low: 0, expected: 0, high: 1 },
          volumeMultiplier: { low: 1, expected: 1, high: 1.5 },
        },
        tokensByModel: {
          "gpt-4o": {
            inputTokens: 8250000,
            outputTokens: 2750000,
            cachedInputTokens: 4125000,
            totalTokens: 11000000,
            label: "exact",
          },
        },
        costByModel: {
          "gpt-4o": {
            low: 8.5,
            expected: 48.125,
            high: 350.0,
            currency: "USD",
            pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
          },
        },
        explainTree: {
          label: "Phase Cost: Runtime Query Processing",
          formula: "(regularInputCost + cachedInputCost + outputCost)",
          inputs: { calls: 500, tokensPerCall: 2000 },
          result: 48.125,
        },
      },
    ],
    totalByModel: {
      "gpt-4o": {
        low: 8.5,
        expected: 48.125,
        high: 350.0,
        currency: "USD",
        pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
      },
      "mistral-large-2407": {
        low: 7.0,
        expected: 40.0,
        high: 280.0,
        currency: "USD",
        pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
      },
    },
  },
  totalExpectedCost: 48.925,
  generatedAt: "2026-10-09T00:00:00.000Z",
};

describe("Estimate View Component (T073, T074, T134, T135, US3, FR-017-FR-024)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders BUILD and RUNTIME track buttons and switches tracks", () => {
    render(
      <Estimate
        estimation={mockEstimation}
        isLoading={false}
        profileVersion={1}
        catalogPhases={mockCatalogPhases}
        models={mockModels}
        pricing={mockPricing}
      />
    );

    // Initial default is Runtime Track
    expect(screen.getByText("Runtime Track")).toBeDefined();
    expect(screen.getByText("Build Track")).toBeDefined();
    expect(screen.getByText("Runtime Query Processing")).toBeDefined();

    // Switch to Build Track
    fireEvent.click(screen.getByText("Build Track"));
    expect(screen.getByText("Architecture & Scaffolding")).toBeDefined();
  });

  it("displays catalog descriptions on phase rows (T134, FR-018)", () => {
    render(
      <Estimate
        estimation={mockEstimation}
        isLoading={false}
        profileVersion={1}
        catalogPhases={mockCatalogPhases}
        models={mockModels}
        pricing={mockPricing}
      />
    );

    expect(
      screen.getByText("User queries processed by runtime RAG and generation pipelines.")
    ).toBeDefined();
  });

  it("edits an assumption and immediately dispatches estimate/request (FR-020)", () => {
    const postSpy = vi.spyOn(vscodeBridge, "postMessage");

    render(
      <Estimate
        estimation={mockEstimation}
        isLoading={false}
        profileVersion={1}
        catalogPhases={mockCatalogPhases}
        models={mockModels}
        pricing={mockPricing}
      />
    );

    const callsInput = screen.getByLabelText("Runtime Query Processing calls");
    fireEvent.change(callsInput, { target: { value: "800" } });

    expect(postSpy).toHaveBeenCalledWith({
      version: 1,
      type: "estimate/request",
      payload: {
        profileVersion: 1,
        overrides: [
          {
            phaseId: "phase-query-answering",
            callsExpected: 800,
          },
        ],
      },
    });
  });

  it("clicking Explain opens ExplainPopover with formula string (T074, FR-022)", () => {
    render(
      <Estimate
        estimation={mockEstimation}
        isLoading={false}
        profileVersion={1}
        catalogPhases={mockCatalogPhases}
        models={mockModels}
        pricing={mockPricing}
      />
    );

    const explainButton = screen.getByLabelText("Explain Runtime Query Processing");
    fireEvent.click(explainButton);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(
      screen.getByText("Explain: Runtime Query Processing")
    ).toBeDefined();
    expect(
      screen.getByText("(regularInputCost + cachedInputCost + outputCost)")
    ).toBeDefined();

    // Close button dismisses modal
    fireEvent.click(screen.getByLabelText("Close explain popover"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders multi-model comparison table with prices, dates, and 'no cached pricing data' (T135, FR-024)", () => {
    render(
      <Estimate
        estimation={mockEstimation}
        isLoading={false}
        profileVersion={1}
        catalogPhases={mockCatalogPhases}
        models={mockModels}
        pricing={mockPricing}
      />
    );

    // GPT-4o shows cached rate
    expect(screen.getByText("$1.250/M")).toBeDefined();

    // Mistral shows 'no cached pricing data'
    expect(screen.getByText("no cached pricing data")).toBeDefined();

    // Model comparison total explain button
    const explainModelBtn = screen.getByLabelText("Explain total for gpt-4o");
    expect(explainModelBtn).toBeDefined();
    fireEvent.click(explainModelBtn);
    expect(screen.getByText("Model Total: gpt-4o")).toBeDefined();
  });
});
