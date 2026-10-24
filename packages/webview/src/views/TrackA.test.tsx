/**
 * Tests: Track A webview behaviour. Enhance "Scan Workspace" uses enhance/prefill and shows
 * signals; Optimize renders host reasons and conflicts and sends strategy/set and
 * strategy/evaluate; Estimate shows "with selected techniques" costs from strategy/savingsUpdate.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator (Enhance, techniques savings)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Enhance } from "./Enhance";
import { OptimizeView } from "./OptimizeView";
import { Estimate } from "./Estimate";
import { costWithChannelSavings, costWithSavings } from "../components/estimate/WithTechniquesCost";
import { vscodeBridge } from "../protocol/vscode";
import type { EstimationResult, SavingsRange, Strategy } from "@token-optimizer/core";

function hostSends(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
}

const range = (min: number, max: number): SavingsRange => ({ minPercent: min, maxPercent: max, basis: "test basis" });

function tech(id: string, name: string): Strategy {
  return {
    id,
    name,
    group: "prompt",
    targets: ["runtime"],
    summary: `${name} summary`,
    savings: range(10, 20),
    reviewStatus: "approved",
    reviewedBy: "T",
    reviewedAt: "2026-10-12T00:00:00Z",
  };
}

describe("Track A webview", () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    postSpy = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});
  });

  it("Scan Workspace posts enhance/prefill and fills the description from the host draft", () => {
    render(<Enhance profile={null} narrative="" isStreaming={false} costUsd={0} />);
    fireEvent.click(screen.getByText("Scan Workspace"));
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "enhance/prefill" }));
    expect(screen.getByText("Scanning...")).toBeDefined();

    hostSends({
      version: 1,
      type: "enhance/prefillResult",
      payload: { description: "Project: demo\n\nTech Stack: Python", signals: ["Project: demo", "Tech Stack: Python"] },
    });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Project: demo\n\nTech Stack: Python");
    expect(screen.getByText("Tech Stack: Python")).toBeDefined();
    expect(screen.queryByText(/multi-turn AI application/)).toBeNull();
  });

  it("Scan Workspace shows a prefill error", () => {
    render(<Enhance profile={null} narrative="" isStreaming={false} costUsd={0} />);
    fireEvent.click(screen.getByText("Scan Workspace"));
    hostSends({ version: 1, type: "enhance/prefillError", payload: { error: "invalid-request", message: "Open a workspace folder to scan it." } });
    expect(screen.getByText(/Open a workspace folder/)).toBeDefined();
  });

  it("Optimize evaluates on mount, renders reasons/conflicts, and toggles via strategy/set", () => {
    const strategies = [tech("a", "Alpha"), tech("b", "Beta")];
    render(<OptimizeView strategies={strategies} selectedStrategyIds={["a"]} savings={null} profileVersion={3} />);
    expect(postSpy).toHaveBeenCalledWith({ version: 1, type: "strategy/evaluate", payload: { profileVersion: 3 } });

    hostSends({
      version: 1,
      type: "strategy/selection",
      payload: {
        selected: [{ strategyId: "a", reason: "Prompts average 900 tokens." }],
        notPreselected: [{ strategyId: "b", reason: "Not applicable: llm.usesRag = false (needs = true)." }],
        conflicts: [{ a: "a", b: "b", explanation: "Alpha conflicts with Beta." }],
      },
    });
    expect(screen.getByTestId("reason-a").textContent).toBe("Prompts average 900 tokens.");
    expect(screen.getByTestId("reason-b").textContent).toMatch(/Not applicable/);
    expect(screen.getByText(/Alpha conflicts with Beta/)).toBeDefined();

    fireEvent.click(screen.getByText("Beta"));
    expect(postSpy).toHaveBeenLastCalledWith({ version: 1, type: "strategy/set", payload: { selectedIds: ["a", "b"] } });
    // Checked state follows the host (props), not a local optimistic copy.
    expect((screen.getByLabelText("Beta") as HTMLInputElement).checked).toBe(false);
  });

  it("costWithSavings applies the max and min percent", () => {
    expect(costWithSavings(100, range(10, 40))).toEqual({ low: 60, high: 90 });
  });

  it("costWithChannelSavings discounts input and output spend separately", () => {
    // $30 input with 0–50% input savings, $70 output with 20–40% output savings.
    expect(costWithChannelSavings(30, 70, { input: range(0, 50), output: range(20, 40) })).toEqual({
      low: 15 + 42,
      high: 30 + 56,
    });
  });

  it("Estimate shows build/runtime cost with selected techniques per model", () => {
    const cost = (expected: number) => ({ currency: "USD", low: expected, expected, high: expected });
    const estimation = {
      profileVersion: 2,
      generatedAt: "2026-10-12T00:00:00Z",
      totalExpectedCost: 300,
      build: { phases: [], totalByModel: { m1: cost(100) } },
      runtime: { phases: [], totalByModel: { m1: cost(200) } },
    } as unknown as EstimationResult;
    render(<Estimate estimation={estimation} isLoading={false} profileVersion={2} />);
    expect(postSpy).toHaveBeenCalledWith({ version: 1, type: "strategy/evaluate", payload: { profileVersion: 2 } });

    hostSends({
      version: 1,
      type: "strategy/savingsUpdate",
      payload: { build: range(0, 0), runtime: range(10, 50), conflicts: [] },
    });
    expect(screen.getByLabelText("Runtime with selected techniques for m1").textContent).toBe("$100.00 – $180.00");
    expect(screen.getByLabelText("Build with selected techniques for m1").textContent).toBe("$100.00");
  });
});
