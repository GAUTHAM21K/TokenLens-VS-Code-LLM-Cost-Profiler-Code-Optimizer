/**
 * Deterministic rule techniques of the prompt optimizer, as pure functions over a text or over a
 * request ({messages, params}). Semantics are pinned by packages/fixtures/optimizer/README.md and
 * must stay byte-identical to the Python runtime (`ai_optimizer.techniques`).
 *
 * Exports: RuleParams, OptimizerRequest, RuleTechnique, RULE_TECHNIQUES, isRuleTechnique,
 *   whitespaceNormalizeText, fillerRemovalText, dedupeSentencesLines, cavemanText
 * Feature: prompt optimizer
 */
import type { PromptMessage, PromptParams } from "../protocol/types.js";

export type RuleParams = Record<string, unknown>;

export interface OptimizerRequest {
  messages: PromptMessage[];
  params: PromptParams;
}

export interface RuleTechnique {
  text(text: string, params: RuleParams): string;
  request(req: OptimizerRequest, params: RuleParams, preserveSystemPrefix?: boolean): OptimizerRequest;
}

interface TextSpan {
  start: number;
  end: number;
  value: string;
}

function jsonEnd(text: string, start: number): number | null {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
      if (stack.length === 0) return i + 1;
    }
  }
  return null;
}

function structuredSpans(text: string, minify = false): TextSpan[] {
  const spans: TextSpan[] = [];
  const fences = /```([^\n]*)\n([\s\S]*?)\n[ \t]*```/g;
  for (const match of text.matchAll(fences)) {
    const start = match.index!;
    const end = start + match[0].length;
    let value = match[0];
    if (minify && /^\s*json\s*$/i.test(match[1]!)) {
      try {
        value = `${match[0].slice(0, match[0].indexOf(match[2]!))}${JSON.stringify(JSON.parse(match[2]!))}\n\x60\x60\x60`;
      } catch {
        // Malformed JSON remains byte-for-byte unchanged.
      }
    }
    spans.push({ start, end, value });
  }
  let fenceIndex = 0;
  for (let i = 0; i < text.length; i++) {
    while (fenceIndex < spans.length && spans[fenceIndex]!.end <= i) fenceIndex++;
    if (fenceIndex < spans.length && spans[fenceIndex]!.start <= i) {
      i = spans[fenceIndex]!.end - 1;
      continue;
    }
    if (text[i] !== "{" && text[i] !== "[") continue;
    const end = jsonEnd(text, i);
    if (end === null) continue;
    const candidate = text.slice(i, end);
    try {
      spans.push({ start: i, end, value: minify ? JSON.stringify(JSON.parse(candidate)) : candidate });
      i = end - 1;
    } catch {
      // Braces in prose and malformed structures are not rewritten.
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

function transformOutsideStructured(text: string, transform: (plain: string) => string): string {
  const spans = structuredSpans(text);
  let cursor = 0;
  let masked = "";
  const replacements: Array<{ marker: string; value: string }> = [];
  for (const span of spans) {
    if (span.start < cursor) continue;
    let marker = `__STRUCTURED_${replacements.length}__`;
    while (text.includes(marker)) marker = `_${marker}_`;
    masked += text.slice(cursor, span.start) + marker;
    replacements.push({ marker, value: span.value });
    cursor = span.end;
  }
  masked += text.slice(cursor);
  const transformed = transform(masked);
  return replacements.reduce((result, item) => result.replace(item.marker, item.value), transformed);
}

/** Minifies valid JSON objects/arrays while preserving surrounding prompt text and malformed input. */
export function minifyStructuredDataText(text: string): string {
  const spans = structuredSpans(text, true);
  let cursor = 0;
  let result = "";
  for (const span of spans) {
    result += text.slice(cursor, span.start) + span.value;
    cursor = span.end;
  }
  return result + text.slice(cursor);
}

// ─── whitespace-normalize ───────────────────────────────────────────────────

const RULE_LINE = /^(?:-{3,}|\*{3,}|_{3,})$/;

/** `\r\n`→`\n`, drop rule lines, collapse inner space runs, strip trailing ws, ≤1 blank line, trim. */
export function whitespaceNormalizeText(text: string): string {
  return transformOutsideStructured(text, (plain) => {
    const out: string[] = [];
    for (const raw of plain.replace(/\r\n/g, "\n").split("\n")) {
      if (RULE_LINE.test(raw.trim())) continue;
      const indent = /^[ \t]*/.exec(raw)![0];
      const line = (indent + raw.slice(indent.length).replace(/[ \t]+/g, " ")).replace(/\s+$/, "");
      if (line === "" && out.length > 0 && out[out.length - 1] === "") continue;
      out.push(line);
    }
    return out.join("\n").trim();
  });
}

// ─── filler-removal ─────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseList(params: RuleParams): string[] {
  const raw = Array.isArray(params.phrases) ? params.phrases : [];
  const phrases = raw.filter((p): p is string => typeof p === "string" && p.length > 0);
  // Longest first; Array.prototype.sort is stable, so ties keep list order.
  return phrases.map((p, i) => ({ p, i })).sort((a, b) => b.p.length - a.p.length || a.i - b.i).map((x) => x.p);
}

function cleanFillerLine(original: string, line: string): string {
  let s = line.replace(/[ \t]+/g, " ");
  s = s.replace(/ +(?=[,.;:!?])/g, "");
  s = s.replace(/^, ?/, "");
  s = s.trim();
  // First non-whitespace character of the original line (pinned by c-filler-removal-text).
  const first = original.trimStart().charAt(0);
  const now = s.charAt(0);
  if (/^\p{Lu}$/u.test(first) && /^\p{Ll}$/u.test(now)) {
    s = now.toUpperCase() + s.slice(1);
  }
  return s;
}

/** Removes catalog filler phrases (word-bounded, case-insensitive), then tidies touched lines. */
export function fillerRemovalText(text: string, params: RuleParams): string {
  const patterns = phraseList(params).map(
    (p) => new RegExp(`(?<![A-Za-z0-9])${escapeRegex(p)}(?![A-Za-z0-9])`, "gi")
  );
  if (patterns.length === 0) return text;
  return transformOutsideStructured(text, (plain) => plain
    .split("\n")
    .map((original) => {
      let line = original;
      for (const re of patterns) line = line.replace(re, "");
      return line === original ? original : cleanFillerLine(original, line);
    })
    .join("\n"));
}

// ─── dedupe-sentences ───────────────────────────────────────────────────────

function sentenceKey(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/**
 * Drops sentences whose key was already seen in `seen` (shared across a whole request).
 * Returns the kept text; a line that lost all its sentences is removed.
 */
export function dedupeSentencesLines(text: string, seen: Set<string>): string {
  return transformOutsideStructured(text, (plain) => {
    const lines: string[] = [];
    for (const line of plain.split("\n")) {
      const sentences = line.split(/(?<=[.!?])\s+/);
      const kept = sentences.filter((s) => {
        const key = sentenceKey(s);
        if (key === "") return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (kept.length === 0) continue;
      lines.push(kept.join(" "));
    }
    return lines.join("\n");
  });
}

// ─── caveman-output ─────────────────────────────────────────────────────────

function instructionOf(params: RuleParams): string {
  return typeof params.instruction === "string" ? params.instruction : "";
}

export function cavemanText(text: string, params: RuleParams): string {
  const instruction = instructionOf(params);
  return instruction ? `${text}\n\n${instruction}` : text;
}

// ─── registry ───────────────────────────────────────────────────────────────

const mapContents = (
  req: OptimizerRequest,
  fn: (m: PromptMessage) => string
): OptimizerRequest => ({
  messages: req.messages.map((m) => ({ role: m.role, content: fn(m) })),
  params: { ...req.params },
});

export const RULE_TECHNIQUES: Record<string, RuleTechnique> = {
  "whitespace-normalize": {
    text: (t) => whitespaceNormalizeText(t),
    request: (req) => mapContents(req, (m) => whitespaceNormalizeText(m.content)),
  },
  "filler-removal": {
    text: (t, p) => fillerRemovalText(t, p),
    request: (req, p) =>
      mapContents(req, (m) => (m.role === "assistant" ? m.content : fillerRemovalText(m.content, p))),
  },
  "dedupe-sentences": {
    text: (t) => dedupeSentencesLines(t, new Set()),
    request: (req) => {
      const seen = new Set<string>();
      return mapContents(req, (m) => dedupeSentencesLines(m.content, seen));
    },
  },
  "cache-prefix-ordering": {
    text: (t) => t,
    request: (req) => ({
      messages: [
        ...req.messages.filter((m) => m.role === "system"),
        ...req.messages.filter((m) => m.role !== "system"),
      ].map((m) => ({ ...m })),
      params: { ...req.params },
    }),
  },
  "caveman-output": {
    text: (t, p) => cavemanText(t, p),
    request: (req, p, preserveSystemPrefix = false) => {
      const instruction = instructionOf(p);
      const messages = req.messages.map((m) => ({ ...m }));
      if (instruction) {
        const system = messages.find((m) => m.role === "system");
        if (preserveSystemPrefix) {
          let systemEnd = 0;
          for (let i = 0; i < messages.length; i++) {
            if (messages[i]!.role === "system") systemEnd = i + 1;
          }
          messages.splice(systemEnd, 0, { role: "system", content: instruction });
        } else if (system) {
          system.content = `${system.content}\n\n${instruction}`;
        } else {
          messages.unshift({ role: "system", content: instruction });
        }
      }
      return { messages, params: { ...req.params } };
    },
  },
  "max-output-cap": {
    text: (t) => t,
    request: (req, p) => {
      const cap = typeof p.maxTokens === "number" && p.maxTokens > 0 ? Math.floor(p.maxTokens) : undefined;
      const params = { ...req.params };
      if (cap !== undefined) params.max_tokens = Math.min(params.max_tokens ?? cap, cap);
      return { messages: req.messages.map((m) => ({ ...m })), params };
    },
  },
  "minify-structured-data": {
    text: (t) => minifyStructuredDataText(t),
    request: (req) => mapContents(req, (m) => minifyStructuredDataText(m.content)),
  },
  minify_structured_data: {
    text: (t) => minifyStructuredDataText(t),
    request: (req) => mapContents(req, (m) => minifyStructuredDataText(m.content)),
  },
};

export function isRuleTechnique(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULE_TECHNIQUES, id);
}
