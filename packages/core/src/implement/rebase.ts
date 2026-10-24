/**
 * Keeps pending Implement proposals valid after another block in the same file is applied:
 * maps a range through the applied text edits (offset arithmetic) and checks the original text
 * is still there. A failed rebase leaves the proposal to the stale check on apply. Pure.
 *
 * Exports: OffsetEdit, rangeText, rebaseRange
 * Feature: implement optimization (apply)
 */
import type { SourceRange } from "../protocol/types.js";
import { LineIndex } from "./pySource.js";

/** A replacement of oldText[start, end) by `text`, in pre-edit offsets. */
export interface OffsetEdit {
  start: number;
  end: number;
  text: string;
}

/** Text of `range` in `text` (0-based line/col). */
export function rangeText(text: string, range: SourceRange): string {
  const idx = new LineIndex(text);
  return text.slice(idx.offset(range.startLine, range.startCol), idx.offset(range.endLine, range.endCol));
}

/**
 * New range of `range` (in oldText) after `edits` produced newText, or null when an edit overlaps
 * the range or the original text is no longer found there.
 */
export function rebaseRange(
  oldText: string,
  newText: string,
  range: SourceRange,
  edits: readonly OffsetEdit[]
): SourceRange | null {
  const oldIdx = new LineIndex(oldText);
  const start = oldIdx.offset(range.startLine, range.startCol);
  const end = oldIdx.offset(range.endLine, range.endCol);
  let delta = 0;
  for (const e of edits) {
    if (e.end <= start) {
      delta += e.text.length - (e.end - e.start);
    } else if (e.start < end) {
      return null; // overlaps
    }
  }
  const ns = start + delta;
  const ne = end + delta;
  if (newText.slice(ns, ne) !== oldText.slice(start, end)) return null;
  return new LineIndex(newText).range(ns, ne);
}
