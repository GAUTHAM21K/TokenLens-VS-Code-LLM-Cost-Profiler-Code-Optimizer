/**
 * Pure state helpers for the Implement proposals list: replace on a user scan, merge on a host
 * re-scan (after a stale block: keep applied rows, keep skips by file + original text, take
 * fresh proposals for the rest), status updates from `implement/blockResult` (including the rebased
 * ranges of the same file's other blocks, so their file:line labels follow the edit), and technique ids.
 *
 * Exports: RESCAN_PREFIX, rowsFromScan, mergeRescan, withStatus, withRebasedRanges, ruleTechniques
 * Feature: implement optimization
 */
import type { ImplementEditProposal, SourceRange, Strategy } from "@token-optimizer/core";
import type { BlockStatus, ProposalRow } from "./ProposalCard";

/** operationId prefix the host uses for the automatic re-scan after a stale block. */
export const RESCAN_PREFIX = "rescan-";

const byPosition = (a: ProposalRow, b: ProposalRow) =>
  a.proposal.file.localeCompare(b.proposal.file) || a.proposal.range.startLine - b.proposal.range.startLine;

export function rowsFromScan(proposals: ImplementEditProposal[]): ProposalRow[] {
  return proposals.map((proposal) => ({ proposal, status: "pending" }));
}

export function mergeRescan(prev: ProposalRow[], fresh: ImplementEditProposal[]): ProposalRow[] {
  const applied = prev.filter((r) => r.status === "applied");
  const skippedKeys = new Set(
    prev.filter((r) => r.status === "skipped").map((r) => `${r.proposal.file}\0${r.proposal.original}`)
  );
  const rows: ProposalRow[] = fresh.map((proposal) => ({
    proposal,
    status: skippedKeys.has(`${proposal.file}\0${proposal.original}`) ? "skipped" : "pending",
  }));
  return [...applied, ...rows].sort(byPosition);
}

export function withStatus(rows: ProposalRow[], id: string, status: BlockStatus, message?: string): ProposalRow[] {
  return rows.map((r) => (r.proposal.id === id ? { ...r, status, message } : r));
}

/** Moves rows to the ranges the host rebased them to after an apply. */
export function withRebasedRanges(
  rows: ProposalRow[],
  rebased: ReadonlyArray<{ proposalId: string; range: SourceRange }> | undefined
): ProposalRow[] {
  if (!rebased || rebased.length === 0) return rows;
  const byId = new Map(rebased.map((r) => [r.proposalId, r.range]));
  return rows.map((r) => {
    const range = byId.get(r.proposal.id);
    return range ? { ...r, proposal: { ...r.proposal, range } } : r;
  });
}

/** Rule techniques (the ones the Python runtime runs), in catalog order. */
export function ruleTechniques(strategies: Strategy[]): Strategy[] {
  return strategies
    .filter((s) => s.optimizer?.mode === "rule")
    .sort((a, b) => (a.optimizer?.order ?? 0) - (b.optimizer?.order ?? 0));
}
