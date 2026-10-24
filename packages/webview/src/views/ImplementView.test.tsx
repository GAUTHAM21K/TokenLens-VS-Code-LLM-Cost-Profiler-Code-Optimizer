/**
 * Tests: Implement tab — technique list from the Optimize selection, export/scan messages,
 * proposal cards (original vs modified, Apply / Skip / Open diff), status updates, Apply-all
 * sequencing, and the merge after a host re-scan of a stale block.
 *
 * Exports: none (test suite)
 * Feature: implement optimization
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { HostToWebviewMsg, ImplementEditProposal, Strategy } from "@token-optimizer/core";
import { ImplementView } from "./ImplementView";
import { vscodeBridge } from "../protocol/vscode";
import type { CatalogViewData } from "./viewProps";
import { mergeRescan } from "../components/implement/proposalState";

const strategies = [
  { id: "filler-removal", name: "Filler removal", optimizer: { mode: "rule", ruleId: "f", order: 20, affects: "input" } },
  { id: "whitespace-normalize", name: "Whitespace", optimizer: { mode: "rule", ruleId: "w", order: 10, affects: "input" } },
  { id: "llm-compress", name: "LLM compress", optimizer: { mode: "llm", promptTemplateId: "c", order: 5, affects: "input" } },
] as unknown as Strategy[];

const catalog: CatalogViewData = {
  providers: [],
  models: [],
  pricing: [],
  strategies,
  routerPresets: [],
  isOffline: true,
};

const proposal = (n: number, file = "summarizer.py"): ImplementEditProposal => ({
  id: `invoke@${file}:${n}:4`,
  file,
  range: { startLine: n - 1, startCol: 4, endLine: n - 1, endCol: 20 },
  original: `llm.invoke(p${n})`,
  modified: `llm.invoke(optimize_messages(p${n}, ["whitespace-normalize"]))`,
  importsToAdd: ["from ai_optimizer import optimize_messages"],
  feature: "optimizer",
  pattern: "invoke",
  fileHash: "c".repeat(64),
  description: "Optimize the input",
});

const host = (msg: HostToWebviewMsg) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: msg }));
  });

describe("ImplementView", () => {
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.restoreAllMocks();
    post = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});
  });

  const sent = () => post.mock.calls.map((c) => c[0] as { type: string; payload: Record<string, unknown> });

  it("lists rule techniques pre-selected from the Optimize tab and sends export + scan", async () => {
    render(
      <ImplementView catalog={catalog} selectedTechniqueIds={["filler-removal", "llm-compress"]} configuredProviderIds={[]} />
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]); // whitespace (order 10), filler (20); llm excluded
    expect(screen.queryByText("LLM compress")).toBeNull();

    fireEvent.click(screen.getByText("Export ai_optimizer"));
    expect((screen.getByText("Scan workspace").closest("button") as HTMLButtonElement).disabled).toBe(true);
    await host({ version: 1, type: "implement/exported", payload: { targetDir: "ai_optimizer", filesWritten: [] } });
    fireEvent.click(screen.getByRole("radio", { name: "Prompt optimizer" }));
    fireEvent.click(screen.getByText("Scan workspace"));
    expect(sent().map((m) => [m.type, m.payload.techniqueIds, m.payload.features])).toEqual([
      ["implement/export", ["filler-removal"], undefined],
      ["implement/scan", ["filler-removal"], ["optimizer"]],
    ]);
  });

  it("blocks scanning the optimizer without techniques, but allows router-only", () => {
    render(<ImplementView catalog={catalog} selectedTechniqueIds={[]} configuredProviderIds={[]} />);
    fireEvent.click(screen.getByRole("radio", { name: "Prompt optimizer" }));
    expect((screen.getByText("Scan workspace").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Model router" }));
    fireEvent.click(screen.getByText("Scan workspace"));
    expect(sent()[0].payload.features).toEqual(["router"]);
  });

  it("renders proposals with previews, applies/skips/diffs and tracks status", async () => {
    render(<ImplementView catalog={catalog} selectedTechniqueIds={["whitespace-normalize"]} configuredProviderIds={[]} />);
    await host({ version: 1, type: "implement/exported", payload: { targetDir: "ai_optimizer", filesWritten: ["ai_optimizer/a.py"] } });
    expect(screen.getByText("Exported 1 files to ai_optimizer/")).toBeTruthy();
    await host({
      version: 1,
      type: "implement/proposals",
      payload: { operationId: "scan-1", filesScanned: 3, proposals: [proposal(22), proposal(31)] },
    });
    const cards = screen.getAllByTestId("proposal");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("summarizer.py:22")).toBeTruthy();
    expect(within(cards[0]).getByText("llm.invoke(p22)")).toBeTruthy();
    expect(within(cards[0]).getByText(/optimize_messages\(p22/)).toBeTruthy();
    expect(within(cards[0]).getByText("+ from ai_optimizer import optimize_messages")).toBeTruthy();

    fireEvent.click(within(cards[0]).getByText("Apply"));
    expect(within(cards[0]).getByTestId("status").textContent).toBe("applying");
    // The host rebased the other block of the file one line down (the added import line).
    await host({
      version: 1,
      type: "implement/blockResult",
      payload: {
        proposalId: proposal(22).id,
        status: "applied",
        message: "Applied (+1 import line).",
        rebased: [{ proposalId: proposal(31).id, range: { startLine: 31, startCol: 4, endLine: 31, endCol: 20 } }],
      },
    });
    expect(within(cards[0]).getByTestId("status").textContent).toBe("applied");
    expect(within(cards[1]).getByText("summarizer.py:32")).toBeTruthy();

    fireEvent.click(within(cards[1]).getByText("Open diff"));
    fireEvent.click(within(cards[1]).getByText("Skip"));
    await host({ version: 1, type: "implement/blockResult", payload: { proposalId: proposal(31).id, status: "skipped" } });
    expect(within(cards[1]).getByTestId("status").textContent).toBe("skipped");
    expect(sent().map((m) => m.type)).toEqual(["implement/applyBlock", "implement/openDiff", "implement/skipBlock"]);
    expect(screen.getByText(/1 applied · 1 skipped · 0 remaining/)).toBeTruthy();
  });

  it("Apply all remaining sends one block at a time and stops on a stale result", async () => {
    render(<ImplementView catalog={catalog} selectedTechniqueIds={["whitespace-normalize"]} configuredProviderIds={[]} />);
    await host({
      version: 1,
      type: "implement/proposals",
      payload: { operationId: "scan-1", filesScanned: 1, proposals: [proposal(1), proposal(2), proposal(3)] },
    });
    fireEvent.click(screen.getByText("Apply all remaining"));
    const applies = () => sent().filter((m) => m.type === "implement/applyBlock").map((m) => m.payload.proposalId);
    expect(applies()).toEqual([proposal(1).id]);
    await host({ version: 1, type: "implement/blockResult", payload: { proposalId: proposal(1).id, status: "applied" } });
    expect(applies()).toEqual([proposal(1).id, proposal(2).id]);
    await host({ version: 1, type: "implement/blockResult", payload: { proposalId: proposal(2).id, status: "stale" } });
    expect(applies()).toHaveLength(2);

    // host re-scan: applied rows stay, the rest is replaced by fresh proposals
    await host({
      version: 1,
      type: "implement/proposals",
      payload: { operationId: "rescan-1", filesScanned: 1, proposals: [proposal(4), proposal(5)] },
    });
    expect(screen.getAllByTestId("status").map((s) => s.textContent)).toEqual(["applied", "pending", "pending"]);
    expect(screen.getByText(/re-scanned/)).toBeTruthy();
  });

  it("mergeRescan keeps skips by file + original text", () => {
    const skipped = { proposal: proposal(7), status: "skipped" as const };
    const moved = { ...proposal(8), original: proposal(7).original };
    expect(mergeRescan([skipped], [moved]).map((r) => r.status)).toEqual(["skipped"]);
  });

  it("shows host errors", async () => {
    render(<ImplementView catalog={catalog} selectedTechniqueIds={[]} configuredProviderIds={[]} />);
    await host({ version: 1, type: "implement/error", payload: { error: "invalid-request", message: "Open a folder to scan." } });
    expect(screen.getByText("Open a folder to scan.")).toBeTruthy();
  });
});
