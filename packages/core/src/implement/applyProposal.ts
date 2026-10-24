/**
 * Turns one ImplementEditProposal into concrete text edits against the file's current text:
 * a stale check (the original block must still be at its range), the block replacement, and
 * the missing import lines (one insertion, no duplicates). The host maps these edits to a single
 * WorkspaceEdit; tests apply them to strings. Pure.
 *
 * Exports: ProposalEdits, planProposalEdits, applyOffsetEdits
 * Feature: implement optimization (apply)
 */
import type { ImplementEditProposal } from "../protocol/types.js";
import { planImportInsertion } from "./pyImports.js";
import { LineIndex } from "./pySource.js";
import type { OffsetEdit } from "./rebase.js";

export type ProposalEdits =
  | { stale: true; reason: string }
  | { stale: false; edits: OffsetEdit[]; importsAdded: string[] };

/** Edits (ascending, non-overlapping, pre-edit offsets) that apply `p` to `text`. */
export function planProposalEdits(text: string, p: ImplementEditProposal): ProposalEdits {
  const idx = new LineIndex(text);
  const start = idx.offset(p.range.startLine, p.range.startCol);
  const end = idx.offset(p.range.endLine, p.range.endCol);
  if (text.slice(start, end) !== p.original) {
    return { stale: true, reason: `${p.file}:${p.range.startLine + 1} changed since the scan` };
  }
  const edits: OffsetEdit[] = [{ start, end, text: p.modified }];
  const ins = planImportInsertion(text, p.importsToAdd);
  if (ins) {
    if (ins.offset > start && ins.offset < end) return { stale: true, reason: "import position overlaps the block" };
    edits.push({ start: ins.offset, end: ins.offset, text: ins.text });
  }
  edits.sort((a, b) => a.start - b.start || (a.end === a.start ? -1 : 1));
  return { stale: false, edits, importsAdded: ins?.added ?? [] };
}

/** Applies non-overlapping pre-edit-offset edits to `text`. */
export function applyOffsetEdits(text: string, edits: readonly OffsetEdit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start || (a.end === a.start ? 1 : -1))) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}
