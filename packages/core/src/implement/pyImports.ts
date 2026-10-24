/**
 * Import handling for Implement edits: decides which `from M import S` lines a file is missing
 * and where they go (after the module docstring and the leading import block). Pure.
 *
 * Exports: ImportInsertion, isImported, missingImports, planImportInsertion
 * Feature: implement optimization (planner)
 */
import { detectEol, findClosing, maskPython, type MaskedSource } from "./pySource.js";

export interface ImportInsertion {
  /** Offset in the original text where `text` is inserted. */
  offset: number;
  text: string;
  /** The import lines that were missing (subset of the request, in request order). */
  added: string[];
}

const FROM_IMPORT = /^from\s+([\w.]+)\s+import\s+([\w*]+)$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `from module import symbol` (or that exact line) is already present in the file. */
export function isImported(text: string, line: string, src: MaskedSource = maskPython(text)): boolean {
  const m = FROM_IMPORT.exec(line.trim());
  if (!m) return text.split(/\r?\n/).some((l) => l.trim() === line.trim());
  const [, mod, sym] = m;
  const re = new RegExp(`^[ \\t]*from[ \\t]+${escapeRe(mod)}[ \\t]+import[ \\t]+`, "gm");
  for (let hit = re.exec(src.masked); hit; hit = re.exec(src.masked)) {
    const from = hit.index + hit[0].length;
    let names: string;
    if (src.masked[from] === "(") {
      const close = findClosing(src.masked, from);
      names = src.masked.slice(from + 1, close < 0 ? undefined : close);
    } else {
      const nl = src.masked.indexOf("\n", from);
      names = src.masked.slice(from, nl < 0 ? undefined : nl);
    }
    for (const part of names.split(",")) {
      const words = part.trim().split(/\s+/);
      const bound = words.length === 3 && words[1] === "as" ? words[2] : words[0];
      if (bound === sym || words[0] === "*") return true;
    }
  }
  return false;
}

/** Request lines not yet imported, de-duplicated, in request order. */
export function missingImports(text: string, lines: readonly string[]): string[] {
  const src = maskPython(text);
  const out: string[] = [];
  for (const l of lines) if (!out.includes(l) && !isImported(text, l, src)) out.push(l);
  return out;
}

/** End offset (after the newline) of the line containing `offset`. */
function lineEnd(text: string, offset: number): number {
  const nl = text.indexOf("\n", offset);
  return nl < 0 ? text.length : nl + 1;
}

/**
 * Where the missing imports go: after the last import of the leading import block, else after the
 * module docstring (with a blank line before), else before the first statement.
 */
export function planImportInsertion(text: string, lines: readonly string[]): ImportInsertion | null {
  const added = missingImports(text, lines);
  if (added.length === 0) return null;
  const eol = detectEol(text);
  const src = maskPython(text);
  const { masked } = src;
  let p = 0;
  let docEnd = -1;
  let importEnd = -1;
  let firstStmt = -1;
  for (;;) {
    while (p < masked.length && /\s/.test(masked[p])) p++; // blanks and masked comments
    if (p >= masked.length) break;
    const str = src.strings.find(([s]) => s === p || (s > p && /^[rRbBuUfF]{1,2}$/.test(text.slice(p, s))));
    if (firstStmt < 0 && docEnd < 0 && importEnd < 0 && str) {
      docEnd = lineEnd(text, str[1]);
      p = docEnd;
      continue;
    }
    const rest = masked.slice(p, lineEnd(masked, p));
    if (/^(import|from)\s/.test(rest)) {
      let end = p;
      // follow parenthesised and backslash-continued imports
      for (;;) {
        const le = lineEnd(masked, end);
        const segment = masked.slice(end, le);
        const paren = segment.indexOf("(");
        if (paren >= 0) {
          const close = findClosing(masked, end + paren);
          end = lineEnd(masked, close < 0 ? masked.length - 1 : close);
          break;
        }
        if (/\\\r?\n$/.test(segment)) {
          end = le;
          continue;
        }
        end = le;
        break;
      }
      importEnd = end;
      p = end;
      continue;
    }
    firstStmt = p;
    break;
  }
  const block = added.join(eol) + eol;
  if (importEnd >= 0) {
    const needsEol = importEnd === text.length && !text.endsWith("\n");
    return { offset: importEnd, text: (needsEol ? eol : "") + block, added };
  }
  if (docEnd >= 0) {
    const needsEol = docEnd === text.length && !text.endsWith("\n");
    return { offset: docEnd, text: (needsEol ? eol : "") + eol + block, added };
  }
  const at = firstStmt >= 0 ? text.lastIndexOf("\n", firstStmt - 1) + 1 : 0;
  return { offset: at, text: block + (firstStmt >= 0 ? eol : ""), added };
}
