/**
 * Tests for PromptOptimizerView: techniques grouped by mode with savings, model picker, run via
 * button and Ctrl+Enter (promptopt/run payload), result rendering (side-by-side, totals, steps,
 * copy) and host errors.
 *
 * Exports: none (test suite)
 * Feature: prompt optimizer
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Model, Pricing, Provider, Strategy, WebviewToHostMsg } from "@token-optimizer/core";
import { PromptOptimizerView } from "./PromptOptimizerView";
import { vscodeBridge } from "../protocol/vscode";
import type { CatalogViewData } from "./viewProps";

const technique = (id: string, name: string, mode: "rule" | "llm", order: number): Strategy =>
  ({
    id,
    name,
    group: "prompt",
    targets: ["runtime"],
    summary: `${name} summary`,
    savings: { minPercent: 2, maxPercent: 9, basis: "b" },
    optimizer:
      mode === "rule"
        ? { mode, ruleId: id, order, affects: "input" }
        : { mode, promptTemplateId: "compress-default", order, affects: "input" },
    reviewStatus: "approved",
  }) as unknown as Strategy;

const catalog: CatalogViewData = {
  providers: [{ id: "groq", label: "Groq", enabled: true } as unknown as Provider],
  models: [
    { id: "openai/gpt-oss-20b", providerId: "groq", label: "GPT-OSS 20B", status: "active" } as unknown as Model,
  ],
  pricing: [] as Pricing[],
  strategies: [
    technique("filler-removal", "Filler removal", "rule", 20),
    technique("whitespace-normalize", "Whitespace normalize", "rule", 10),
    technique("llm-compress", "LLM compress", "llm", 5),
    {
      ...technique("caveman-output", "Terse output", "rule", 30),
      optimizer: { mode: "rule", ruleId: "caveman-output", order: 30, affects: "output" },
    } as Strategy,
    { ...technique("other", "Not an optimizer technique", "rule", 1), optimizer: undefined } as Strategy,
  ],
  routerPresets: [],
  isOffline: false,
};

const hostSend = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });

function lastRun(spy: ReturnType<typeof vi.spyOn>) {
  const call = spy.mock.calls.at(-1)![0] as Extract<WebviewToHostMsg, { type: "promptopt/run" }>;
  expect(call.type).toBe("promptopt/run");
  return call.payload;
}

describe("PromptOptimizerView", () => {
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    post = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => undefined);
  });

  const renderView = (selected: string[] = []) =>
    render(
      <PromptOptimizerView
        catalog={catalog}
        selectedTechniqueIds={selected}
        configuredProviderIds={["groq"]}
        defaultModel={{ providerId: "groq", modelId: "openai/gpt-oss-20b" }}
      />
    );

  it("groups optimizer techniques by mode with savings and pre-selects defaults", () => {
    renderView();
    expect(screen.getByText(/Rule techniques/)).toBeDefined();
    expect(screen.getByText(/LLM techniques/)).toBeDefined();
    expect(screen.queryByText("Not an optimizer technique")).toBeNull();
    expect(screen.getAllByText(/2–9% input/)).toHaveLength(3);
    expect((screen.getByLabelText("Filler removal") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("LLM compress") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("option", { name: /GPT-OSS 20B/ })).toBeDefined();
  });

  it("sends promptopt/run in catalog order on Ctrl+Enter and renders the result", () => {
    renderView(["filler-removal", "llm-compress"]);
    const box = screen.getByLabelText("Prompt");
    fireEvent.change(box, { target: { value: "Please do it." } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const p = lastRun(post);
    expect(p.techniqueIds).toEqual(["llm-compress", "filler-removal"]);
    expect(p.messages).toEqual([{ role: "user", content: "Please do it." }]);
    expect(p).toMatchObject({ providerId: "groq", modelId: "openai/gpt-oss-20b" });
    expect(screen.getByRole("button", { name: /Optimizing/ })).toBeDefined();

    hostSend({
      version: 1,
      type: "promptopt/result",
      payload: {
        operationId: p.operationId,
        original: { messages: p.messages, params: {}, inputTokens: 4 },
        optimized: { messages: [{ role: "user", content: "Do it." }], params: {}, inputTokens: 2 },
        steps: [
          {
            techniqueId: "llm-compress",
            mode: "llm",
            applied: false,
            messagesAfter: p.messages,
            paramsAfter: {},
            inputTokensBefore: 4,
            inputTokensAfter: 4,
            note: "Skipped: HTTP 401",
          },
          {
            techniqueId: "filler-removal",
            mode: "rule",
            applied: true,
            messagesAfter: [{ role: "user", content: "Do it." }],
            paramsAfter: {},
            inputTokensBefore: 4,
            inputTokensAfter: 2,
          },
        ],
        tokenLabel: "approximate",
        cost: {
          providerId: "groq",
          modelId: "openai/gpt-oss-20b",
          inputPerMTok: 0.075,
          outputPerMTok: 0.3,
          outputTokensBefore: 500,
          outputTokensAfter: 500,
          usdPer1kCallsBefore: 0.1503,
          usdPer1kCallsAfter: 0.15015,
        },
      },
    });
    hostSend({
      version: 1,
      type: "promptopt/error",
      payload: { operationId: p.operationId, error: "llm-failed", message: "llm-compress failed: HTTP 401" },
    });

    expect(screen.getByTestId("promptopt-optimized").textContent).toBe("Do it.");
    expect(screen.getByTestId("promptopt-totals").textContent).toMatch(/≈2 \(50\.0%\)/);
    expect(screen.getByTestId("promptopt-totals").textContent).toMatch(/Per 1k calls on openai\/gpt-oss-20b/);
    expect(screen.getByTestId("promptopt-steps").textContent).toMatch(/Skipped: HTTP 401/);
    expect(screen.getByRole("alert").textContent).toMatch(/HTTP 401/);
    expect(screen.getByRole("button", { name: /Optimize/ })).toBeDefined();
  });

  it("ignores results for another operation and copies the optimized prompt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderView();
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Hi  there" } });
    fireEvent.click(screen.getByRole("button", { name: /Optimize/ }));
    const p = lastRun(post);
    const payload = {
      original: { messages: p.messages, params: {}, inputTokens: 3 },
      optimized: { messages: [{ role: "user", content: "Hi there" }], params: { max_tokens: 512 }, inputTokens: 2 },
      steps: [],
      tokenLabel: "exact",
    };
    hostSend({ version: 1, type: "promptopt/result", payload: { ...payload, operationId: "stale" } });
    expect(screen.queryByTestId("promptopt-result")).toBeNull();
    hostSend({ version: 1, type: "promptopt/result", payload: { ...payload, operationId: p.operationId } });
    expect(screen.getByText(/max_tokens 512/)).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy optimized prompt" }));
    });
    expect(writeText).toHaveBeenCalledWith("Hi there");
  });

  it("does not run with an empty prompt", () => {
    renderView();
    fireEvent.keyDown(screen.getByLabelText("Prompt"), { key: "Enter", ctrlKey: true });
    expect(post).not.toHaveBeenCalled();
  });

  it("warns when selected strategies estimate quality retention below 85%", () => {
    renderView(["caveman-output"]);
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Explain this." } });
    fireEvent.click(screen.getByRole("button", { name: /Optimize/ }));
    const payload = lastRun(post);
    hostSend({
      version: 1,
      type: "promptopt/result",
      payload: {
        operationId: payload.operationId,
        original: { messages: payload.messages, params: {}, inputTokens: 3 },
        optimized: { messages: payload.messages, params: {}, inputTokens: 3 },
        steps: [],
        tokenLabel: "exact",
      },
    });
    expect(screen.getByTestId("promptopt-totals").textContent).toMatch(/Estimated quality retention:\s*80\s*%/);
    expect(screen.getByRole("alert").textContent).toContain("Review aggressive compression");
  });
});
