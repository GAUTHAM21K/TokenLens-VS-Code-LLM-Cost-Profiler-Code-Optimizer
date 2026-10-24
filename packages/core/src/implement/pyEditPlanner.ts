/**
 * Deterministic Implement planner (no LLM): finds LangChain call sites in one Python file and
 * turns each into an ImplementEditProposal (original block, modified block, imports to add).
 *   P1 agent:        create_agent(...)        -> add/extend middleware=[PromptOptimizationMiddleware([...]),
 *                                               ModelRouterMiddleware()]
 *   P2 invoke:       <llm>.invoke|ainvoke|stream(arg) -> <llm>.invoke(optimize_messages(arg, [...]))
 *   P3 construction: <llm> = ChatXxx(...)/init_chat_model(...) used at an invoke site (router)
 *                    -> get_model(arg, <ctor kwargs>).invoke(...): the constructor's keyword
 *                    arguments (e.g. temperature=0) are forwarded; model identity
 *                    (model / model_name / model_provider, positional args) is left to the router
 * With both features an invoke site yields ONE router proposal that also wraps the input, so
 * blocks never overlap. Sites already rewritten are skipped (idempotent re-scans).
 * Calls are found on string/comment-masked text with paren balancing (multi-line safe).
 *
 * Exports: ImplementFeature, PlanFileOptions, LLM_CONSTRUCTORS, IMPLEMENT_IMPORTS, ROUTED_INPUT, pyList,
 *   findLlmVariables, LlmConstruction, findLlmConstructors, planPythonFile
 * Feature: implement optimization (planner)
 */
import type { ImplementEditProposal } from "../protocol/types.js";
import {
  detectEol,
  findClosing,
  LineIndex,
  maskPython,
  splitTopLevel,
  type MaskedSource,
} from "./pySource.js";

export type ImplementFeature = "optimizer" | "router";

export interface PlanFileOptions {
  features: readonly ImplementFeature[];
  /** Rule technique ids passed to optimize_messages / PromptOptimizationMiddleware. */
  techniqueIds: readonly string[];
}

export const LLM_CONSTRUCTORS = ["ChatOpenAI", "ChatAnthropic", "ChatGroq", "init_chat_model"] as const;

export const IMPLEMENT_IMPORTS = {
  optimizeMessages: "from ai_optimizer import optimize_messages",
  getModel: "from ai_optimizer import get_model",
  promptMiddleware: "from ai_optimizer.middleware import PromptOptimizationMiddleware",
  routerMiddleware: "from ai_optimizer.middleware import ModelRouterMiddleware",
} as const;

const INVOKE_METHODS = ["invoke", "ainvoke", "stream"];

/** Walrus target used when a routed, non-trivial input must be evaluated only once. */
export const ROUTED_INPUT = "routed_input";

/** Python list literal of strings: ["a", "b"]. */
export function pyList(items: readonly string[]): string {
  return `[${items.map((s) => JSON.stringify(s)).join(", ")}]`;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function applyEdits(text: string, base: number, edits: Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start - base) + e.text + out.slice(e.end - base);
  }
  return out;
}

/** Paren depth at every offset of the masked text (depth before the char). */
function depthMap(masked: string): Int32Array {
  const d = new Int32Array(masked.length + 1);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    d[i] = depth;
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
  }
  d[masked.length] = depth;
  return d;
}

/** Trimmed [start, end) of a segment using masked whitespace (comments count as blank). */
function trimSeg(masked: string, [s, e]: [number, number]): [number, number] | null {
  while (s < e && /\s/.test(masked[s])) s++;
  while (e > s && /\s/.test(masked[e - 1])) e--;
  return s < e ? [s, e] : null;
}

/** Constructor keyword arguments that pick the model; the router decides those instead. */
const MODEL_IDENTITY_KWARGS = new Set(["model", "model_name", "model_provider"]);

/** One statement-level `<name> = ChatXxx(...)` / `init_chat_model(...)` assignment. */
export interface LlmConstruction {
  name: string;
  /** Offset of the assignment statement. */
  offset: number;
  /** Keyword arguments to forward to get_model, as source text (e.g. `temperature=0`). */
  kwargs: string[];
}

/** Statement-level chat-model constructions, in source order, with their forwardable kwargs. */
export function findLlmConstructors(text: string, src: MaskedSource = maskPython(text)): LlmConstruction[] {
  const ctor = LLM_CONSTRUCTORS.join("|");
  const re = new RegExp(
    `^[ \\t]*((?:self\\.)?[A-Za-z_]\\w*)[ \\t]*(?::[^=\\n]*)?=[ \\t]*(?:[A-Za-z_]\\w*\\.)*(?:${ctor})\\s*\\(`,
    "gm"
  );
  const masked = src.masked;
  const depth = depthMap(masked);
  const found: LlmConstruction[] = [];
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    if (depth[m.index] !== 0) continue;
    const open = m.index + m[0].length - 1;
    const close = findClosing(masked, open);
    const kwargs: string[] = [];
    if (close > 0) {
      for (const seg of splitTopLevel(masked, open + 1, close)) {
        const t = trimSeg(masked, seg);
        if (!t) continue;
        const kw = /^([A-Za-z_]\w*)\s*=(?!=)/.exec(masked.slice(...t));
        if (kw && !MODEL_IDENTITY_KWARGS.has(kw[1])) kwargs.push(text.slice(...t));
      }
    }
    found.push({ name: m[1], offset: m.index, kwargs });
  }
  return found;
}

/** Names assigned from a LangChain chat-model constructor at statement level. */
export function findLlmVariables(text: string, src: MaskedSource = maskPython(text)): Set<string> {
  return new Set(findLlmConstructors(text, src).map((c) => c.name));
}

/**
 * Appends `item` to a comma-separated container whose contents are text[innerStart, innerEnd),
 * keeping the container's one-line or one-item-per-line style and its trailing comma.
 */
function appendItem(text: string, masked: string, innerStart: number, innerEnd: number, item: string): Edit {
  const eol = detectEol(text);
  let last = innerEnd - 1;
  while (last >= innerStart && /\s/.test(masked[last])) last--;
  if (last < innerStart) return { start: innerStart, end: innerStart, text: item };
  const trailingComma = masked[last] === ",";
  if (!text.slice(innerStart, innerEnd).includes("\n")) {
    return { start: last + 1, end: last + 1, text: (trailingComma ? " " : ", ") + item };
  }
  const lineStartOf = (o: number) => text.lastIndexOf("\n", o - 1) + 1;
  const indentOf = (o: number) => /^[ \t]*/.exec(text.slice(lineStartOf(o)))![0];
  const indent =
    lineStartOf(last) === lineStartOf(innerStart) ? indentOf(innerStart) + "    " : indentOf(last);
  let at = text.indexOf("\n", last);
  if (at < 0) at = text.length;
  if (text[at - 1] === "\r") at--;
  at = Math.min(at, innerEnd);
  return {
    start: at,
    end: at,
    text: (trailingComma ? "" : ",") + eol + indent + item + (trailingComma ? "," : ""),
  };
}

function proposalId(pattern: string, file: string, line: number, col: number): string {
  const id = `${pattern}@${file}:${line + 1}:${col}`;
  return id.length <= 200 ? id : `${pattern}@...${id.slice(-(200 - pattern.length - 4))}`;
}

/** All proposals for one file, ordered by position. `file` is workspace-relative (posix). */
export function planPythonFile(
  file: string,
  text: string,
  fileHash: string,
  opts: PlanFileOptions
): ImplementEditProposal[] {
  const wantOpt = opts.features.includes("optimizer") && opts.techniqueIds.length > 0;
  const wantRouter = opts.features.includes("router");
  if (!wantOpt && !wantRouter) return [];
  const src = maskPython(text);
  const { masked } = src;
  const lines = new LineIndex(text);
  const techList = pyList(opts.techniqueIds);
  const out: ImplementEditProposal[] = [];

  const push = (
    start: number,
    end: number,
    edits: Edit[],
    p: Pick<ImplementEditProposal, "feature" | "pattern" | "importsToAdd" | "description">
  ) => {
    const range = lines.range(start, end);
    const original = text.slice(start, end);
    out.push({
      id: proposalId(p.pattern, file, range.startLine, range.startCol),
      file,
      range,
      original,
      modified: applyEdits(original, start, edits),
      importsToAdd: p.importsToAdd,
      feature: p.feature,
      pattern: p.pattern,
      fileHash,
      description: p.description,
    });
  };

  // P1: create_agent(...) -> middleware list
  const agentRe = /(?<![\w.])(?:[A-Za-z_]\w*\.)*create_agent\s*\(/g;
  for (let m = agentRe.exec(masked); m; m = agentRe.exec(masked)) {
    if (/\bdef\s+$/.test(masked.slice(Math.max(0, m.index - 20), m.index))) continue;
    const open = m.index + m[0].length - 1;
    const close = findClosing(masked, open);
    if (close < 0) continue;
    const segs = splitTopLevel(masked, open + 1, close);
    const mwSeg = segs.find(([s, e]) => /^\s*middleware\s*=(?!=)/.test(masked.slice(s, e)));
    const existing = mwSeg ? text.slice(mwSeg[0], mwSeg[1]) : "";
    const items: string[] = [];
    const imports: string[] = [];
    if (wantOpt && !existing.includes("PromptOptimizationMiddleware")) {
      items.push(`PromptOptimizationMiddleware(${techList})`);
      imports.push(IMPLEMENT_IMPORTS.promptMiddleware);
    }
    if (wantRouter && !existing.includes("ModelRouterMiddleware")) {
      items.push("ModelRouterMiddleware()");
      imports.push(IMPLEMENT_IMPORTS.routerMiddleware);
    }
    if (items.length === 0) continue;
    let edit: Edit;
    if (mwSeg) {
      const eq = masked.indexOf("=", mwSeg[0]);
      const value = trimSeg(masked, [eq + 1, mwSeg[1]]);
      if (!value) continue;
      const closeBracket = masked[value[0]] === "[" ? findClosing(masked, value[0]) : -1;
      if (closeBracket === value[1] - 1) {
        edit = appendItem(text, masked, value[0] + 1, closeBracket, items.join(", "));
      } else {
        const v = text.slice(value[0], value[1]);
        edit = { start: value[0], end: value[1], text: `[*${v}, ${items.join(", ")}]` };
      }
    } else {
      edit = appendItem(text, masked, open + 1, close, `middleware=[${items.join(", ")}]`);
    }
    const names = items.map((i) => i.slice(0, i.indexOf("("))).join(" + ");
    push(m.index, close + 1, [edit], {
      feature: wantOpt && items[0].startsWith("Prompt") ? "optimizer" : "router",
      pattern: "agent",
      importsToAdd: imports,
      description: `Add ${names} to create_agent(...)`,
    });
  }

  // P2 / P3: <llm>.invoke(arg) where <llm> came from a chat-model constructor
  const constructions = findLlmConstructors(text, src);
  const llmVars = new Set(constructions.map((c) => c.name));
  /** Kwargs of the closest construction of `name` before `at` (else its first one). */
  const ctorKwargs = (name: string, at: number): string[] => {
    const mine = constructions.filter((c) => c.name === name);
    return ([...mine].reverse().find((c) => c.offset < at) ?? mine[0])?.kwargs ?? [];
  };
  if (llmVars.size > 0) {
    const callRe = new RegExp(
      `(?<![\\w.])((?:self\\.)?[A-Za-z_]\\w*)\\s*\\.\\s*(${INVOKE_METHODS.join("|")})\\s*\\(`,
      "g"
    );
    for (let m = callRe.exec(masked); m; m = callRe.exec(masked)) {
      const receiver = m[1];
      if (!llmVars.has(receiver)) continue;
      const open = m.index + m[0].length - 1;
      const close = findClosing(masked, open);
      if (close < 0) continue;
      const segs = splitTopLevel(masked, open + 1, close)
        .map((s) => trimSeg(masked, s))
        .filter((s): s is [number, number] => s !== null);
      let arg: [number, number] | undefined = segs.find((s) => !/^[A-Za-z_]\w*\s*=(?!=)/.test(masked.slice(...s)));
      if (arg && arg !== segs[0]) arg = undefined; // positional input must come first
      if (!arg) {
        const kw = segs.find((s) => /^input\s*=(?!=)/.test(masked.slice(...s)));
        if (kw) arg = trimSeg(masked, [masked.indexOf("=", kw[0]) + 1, kw[1]]) ?? undefined;
      }
      if (!arg || masked[arg[0]] === "*") continue;
      const optimizeCall = /^optimize_messages\s*\(/.exec(masked.slice(arg[0], arg[1]));
      const alreadyOptimized = optimizeCall !== null;
      const doOpt = wantOpt && !alreadyOptimized;
      if (!doOpt && !wantRouter) continue;

      const edits: Edit[] = [];
      const imports: string[] = [];
      // The input the router sees (for an already-optimized site: the inner, raw input).
      let routeSpan: [number, number] = arg;
      if (alreadyOptimized) {
        const innerOpen = arg[0] + optimizeCall[0].length - 1;
        const innerClose = findClosing(masked, innerOpen);
        const first = innerClose > 0 ? trimSeg(masked, splitTopLevel(masked, innerOpen + 1, innerClose)[0]) : null;
        if (first) routeSpan = first;
      }
      // Non-trivial inputs are evaluated once: get_model(routed_input := <expr>) is evaluated
      // before the call arguments, which then reuse `routed_input`.
      const simple = /^[A-Za-z_][\w.]*$/.test(masked.slice(...routeSpan));
      const routeText = text.slice(...routeSpan);
      const useWalrus = wantRouter && !simple;
      const inputText = (s: [number, number]) =>
        useWalrus && s[0] === routeSpan[0] && s[1] === routeSpan[1] ? ROUTED_INPUT : text.slice(...s);
      if (doOpt) {
        edits.push({ start: arg[0], end: arg[1], text: `optimize_messages(${inputText(arg)}, ${techList})` });
        imports.push(IMPLEMENT_IMPORTS.optimizeMessages);
      } else if (useWalrus) {
        edits.push({ start: routeSpan[0], end: routeSpan[1], text: ROUTED_INPUT });
      }
      if (wantRouter) {
        const routed = useWalrus ? `${ROUTED_INPUT} := ${routeText}` : routeText;
        const fwd = ctorKwargs(receiver, m.index).map((k) => `, ${k}`).join("");
        edits.push({ start: m.index, end: m.index + receiver.length, text: `get_model(${routed}${fwd})` });
        imports.push(IMPLEMENT_IMPORTS.getModel);
      }
      const method = m[2];
      push(m.index, close + 1, edits, {
        feature: wantRouter ? "router" : "optimizer",
        pattern: wantRouter ? "construction" : "invoke",
        importsToAdd: imports,
        description: wantRouter
          ? `Route ${receiver}.${method}(...) through get_model()` + (doOpt ? " and optimize its input" : "")
          : `Optimize the input of ${receiver}.${method}(...) with ${opts.techniqueIds.length} technique(s)`,
      });
    }
  }

  return out.sort((a, b) => a.range.startLine - b.range.startLine || a.range.startCol - b.range.startCol);
}
