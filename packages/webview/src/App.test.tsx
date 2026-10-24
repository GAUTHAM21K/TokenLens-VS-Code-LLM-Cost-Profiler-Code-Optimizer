/**
 * Tests: Webview Shell (T004, T015, Finding 4, Principle I & II).
 *
 * Exports: none (test suite)
 * Feature: shared protocol / webview shell
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { App } from "./App";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Webview Shell (T004, T015, Finding 4, Principle I & II)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders webview shell and handles tab switching across all 5 views", async () => {
    render(<App />);

    // Brand and header render
    expect(screen.getByText("Token Optimizer")).toBeDefined();
    expect(screen.getByText("vscode")).toBeDefined();

    // Verify initial Enhance tab renders
    expect(screen.getByText("Describe Your AI Feature")).toBeDefined();
    expect(
      screen.getByPlaceholderText(
        /A multi-turn RAG chatbot for customer support/
      )
    ).toBeDefined();

    // Switch to Estimate tab
    fireEvent.click(screen.getByRole("button", { name: /Estimate/ }));
    expect(screen.getByText("Deterministic Estimation")).toBeDefined();
    expect(screen.getByText("No Estimation Computed Yet")).toBeDefined();

    // Switch to Optimize tab
    fireEvent.click(screen.getByRole("button", { name: /^Optimize$/ }));
    expect(screen.getByText("Strategy Selection")).toBeDefined();
    expect(
      screen.getByText(/No strategies discovered yet. Connect catalog/)
    ).toBeDefined();

    // Switch to Implement tab
    fireEvent.click(screen.getByRole("button", { name: /Implement/ }));
    // v2: install / IDE-agent routes are cut scope; the Implement tab is a Phase 0 stub.
    expect(screen.getByRole("heading", { name: /Implement/ })).toBeDefined();

    // New v2 tabs render their stub views
    fireEvent.click(screen.getByRole("button", { name: /Prompt Optimizer/ }));
    expect(screen.getByRole("heading", { name: /Prompt Optimizer/ })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /^Router$/ }));
    expect(screen.getByRole("heading", { name: /Model Router/ })).toBeDefined();

    // Switch to Settings tab
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(screen.getByText("Add Provider API Key")).toBeDefined();
    expect(screen.getByText("Constitution Principle I Enforced")).toBeDefined();
    expect(
      screen.getByPlaceholderText("Paste key here (write-only)...")
    ).toBeDefined();
  });

  it("asserts webview source and templates contain no hardcoded secrets or database URLs", () => {
    const webviewSrcDir = path.resolve(__dirname, "..");
    const filesToScan: string[] = [];

    function collectFiles(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "dist") {
            collectFiles(fullPath);
          }
        } else if (
          entry.name.endsWith(".ts") ||
          entry.name.endsWith(".tsx") ||
          entry.name.endsWith(".html")
        ) {
          filesToScan.push(fullPath);
        }
      }
    }

    collectFiles(webviewSrcDir);

    expect(filesToScan.length).toBeGreaterThan(5);

    for (const filePath of filesToScan) {
      const content = fs.readFileSync(filePath, "utf-8");

      // No MongoDB connection strings
      expect(content).not.toMatch(/mongodb(\+srv)?:\/\//);

      // No hardcoded real API keys
      expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(content).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);

      // No unexpected external tracking URLs (only standard XML/React namespaces allowed)
      const urlMatches = content.match(/https?:\/\/[^\s"'`<>]+/g) || [];
      for (const url of urlMatches) {
        const isAllowed =
          url.includes("w3.org") ||
          url.includes("reactjs.org") ||
          url.includes("github.com") ||
          url.includes("mock.webview.test");
        expect(
          isAllowed,
          `Unexpected external URL found in ${filePath}: ${url}`
        ).toBe(true);
      }
    }
  });

  it("safely handles malformed host messages via Zod validation without crashing", async () => {
    render(<App />);

    // Dispatch malformed message directly to window
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "unknown/maliciousMsg",
            payload: { injection: true },
          },
        })
      );
    });

    // App continues to render normally
    expect(screen.getByText("Token Optimizer")).toBeDefined();
  });

  it("receives catalog/updated and estimate/result, and passes pricing down to EstimateView so models display non-zero rates (C2)", async () => {
    render(<App />);

    // Send catalog/updated with pricing
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            version: 1,
            type: "catalog/updated",
            payload: {
              version: 1,
              schemaVersion: "1.0.0",
              isOffline: false,
              publishedAt: "2026-01-01T00:00:00.000Z",
              strategies: [],
              providers: [],
              platforms: [],
              promptTemplates: [],
              models: [
                {
                  id: "claude-3-5-sonnet",
                  providerId: "anthropic",
                  label: "Claude 3.5 Sonnet",
                  contextWindow: 200000,
                  maxOutput: 8192,
                  tier: "frontier",
                  supportsCaching: true,
                  supportsBatch: false,
                  supportsStructuredOutput: true,
                  tokenizer: { kind: "tiktoken" },
                  status: "active",
                  addedAt: "2026-01-01T00:00:00.000Z",
                },
              ],
              phases: [],
              pricing: [
                {
                  modelId: "claude-3-5-sonnet",
                  currency: "USD",
                  inputPerMTok: 3.0,
                  outputPerMTok: 15.0,
                  cachedInputPerMTok: 0.3,
                  effectiveFrom: "2026-01-01T00:00:00.000Z",
                  sourceUrl: "https://mock.webview.test/pricing",
                  verifiedAt: "2026-10-09T00:00:00.000Z",
                },
              ],
            },
          },
        })
      );
    });

    // Send estimate/result
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            version: 1,
            type: "estimate/result",
            payload: {
              result: {
                profileVersion: 1,
                currency: "USD",
                build: {
                  phases: [],
                  totalByModel: {
                    "claude-3-5-sonnet": {
                      low: 0.1,
                      expected: 1.0,
                      high: 5.0,
                      currency: "USD",
                      pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
                    },
                  },
                },
                runtime: {
                  phases: [],
                  totalByModel: {
                    "claude-3-5-sonnet": {
                      low: 5.0,
                      expected: 50.0,
                      high: 200.0,
                      currency: "USD",
                      pricingVerifiedAt: "2026-10-09T00:00:00.000Z",
                    },
                  },
                },
                totalExpectedCost: 51.0,
                generatedAt: "2026-10-09T00:00:00.000Z",
              },
            },
          },
        })
      );
    });

    // Switch to Estimate tab
    fireEvent.click(screen.getByRole("button", { name: /Estimate/ }));

    // Verify non-zero pricing rates and cached rate are rendered in the model comparison table
    expect(screen.getByText("Claude 3.5 Sonnet")).toBeDefined();
    expect(screen.getByText("$3.00")).toBeDefined();
    expect(screen.getByText("$15.00")).toBeDefined();
    expect(screen.getByText("$0.300/M")).toBeDefined();
    expect(screen.queryByText("no cached pricing data")).toBeNull();
  });
});

