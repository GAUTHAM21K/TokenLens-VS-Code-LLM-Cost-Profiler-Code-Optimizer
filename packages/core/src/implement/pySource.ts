/**
 * Minimal Python source helpers for the Implement scanner: masks string literals and comments
 * (so regex detectors never match inside them), paren-balanced call scanning, top-level argument
 * splitting and offset <-> line/column conversion. Pure, no Python parser.
 *
 * Exports: MaskedSource, maskPython, findClosing, splitTopLevel, LineIndex, detectEol
 * Feature: implement optimization (scanner)
 */
import type { SourceRange } from "../protocol/types.js";

export interface MaskedSource {
  /** Same length as the input; string contents and comments are spaces (newlines kept). */
  masked: string;
  /** [start, end) offsets of every string literal, delimiters included (prefix excluded). */
  strings: Array<[number, number]>;
}

/** Masks comments and string literal contents; quote delimiters stay so strings remain atoms. */
export function maskPython(text: string): MaskedSource {
  const out = text.split("");
  const strings: Array<[number, number]> = [];
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n" && out[k] !== "\r") out[k] = " ";
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "#") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      blank(i, j);
      i = j;
    } else if (c === '"' || c === "'") {
      const triple = text.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      let closed = false;
      while (j < n) {
        if (text[j] === "\\") {
          j += 2;
          continue;
        }
        if (!triple && text[j] === "\n") break; // unterminated single-line string
        if (text.startsWith(q, j)) {
          closed = true;
          break;
        }
        j++;
      }
      j = Math.min(j, n);
      blank(i + q.length, j);
      if (closed) j += q.length;
      strings.push([i, j]);
      i = j;
    } else {
      i++;
    }
  }
  return { masked: out.join(""), strings };
}

const OPEN = "([{";
const CLOSE = ")]}";

/** Index of the bracket matching the opener at `openIdx` in masked text, or -1. */
export function findClosing(masked: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/** [start, end) segments of masked[start, end) split at depth-0 commas. */
export function splitTopLevel(masked: string, start: number, end: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  let depth = 0;
  let segStart = start;
  for (let i = start; i < end; i++) {
    const c = masked[i];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    else if (c === "," && depth === 0) {
      segs.push([segStart, i]);
      segStart = i + 1;
    }
  }
  segs.push([segStart, end]);
  return segs;
}

/** "\r\n" when the file uses CRLF, else "\n". */
export function detectEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Offset <-> 0-based line/column (columns in UTF-16 units, as VS Code positions). */
export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(private readonly text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.starts.push(i + 1);
  }

  position(offset: number): { line: number; col: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: offset - this.starts[lo] };
  }

  offset(line: number, col: number): number {
    if (line >= this.starts.length) return this.text.length;
    return Math.min(this.starts[line] + col, this.text.length);
  }

  range(start: number, end: number): SourceRange {
    const s = this.position(start);
    const e = this.position(end);
    return { startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col };
  }

  lineStart(offset: number): number {
    return this.starts[this.position(offset).line];
  }
}
