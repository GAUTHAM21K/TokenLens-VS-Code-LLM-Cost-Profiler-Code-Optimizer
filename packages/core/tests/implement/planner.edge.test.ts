/**
 * Edge-case tests for the Implement core: string/comment masking, multi-line and keyword inputs,
 * extending an existing middleware list, CRLF files, import placement/dedupe, range rebasing,
 * stale detection, export file content and the scan path filter.
 *
 * Exports: none (test suite)
 * Feature: implement optimization
 */
import { describe, it, expect } from "vitest";
import {
  applyOffsetEdits,
  buildCatalogTechniquesJson,
  findLlmConstructors,
  findLlmVariables,
  isImported,
  maskPython,
  planExportFiles,
  planImportInsertion,
  planProposalEdits,
  planPythonFile,
  rangeText,
  rebaseRange,
  restrictRouterConfig,
  scanExcludeGlob,
  shouldScanPythonPath,
  type ImplementFeature,
  type RouterConfig,
  type Strategy,
} from "../../src/index.js";

const H = "b".repeat(64);
const plan = (text: string, features: ImplementFeature[] = ["optimizer"], ids = ["whitespace-normalize"]) =>
  planPythonFile("app.py", text, H, { features, techniqueIds: ids });
const W = `["whitespace-normalize"]`;

describe("maskPython", () => {
  it("blanks comments and string contents, keeps length, quotes and newlines", () => {
    const src = `x = "a(b" + '''q\n)'''  # c(\ny = f"{z}"`;
    const { masked, strings } = maskPython(src);
    expect(masked.length).toBe(src.length);
    expect(masked).toBe(`x = "   " + ''' \n '''      \ny = f"   "`);
    expect(strings.length).toBe(3);
  });

  it("handles escapes and unterminated strings", () => {
    expect(maskPython(`a = "x\\"y" + b`).masked).toBe(`a = "    " + b`);
    expect(maskPython(`a = "oops\nb = 1`).masked).toBe(`a = "    \nb = 1`);
  });
});

describe("planPythonFile edge cases", () => {
  it("ignores call sites in strings and comments and non-LLM receivers", () => {
    const text = [
      "llm = ChatOpenAI(model='gpt-4o')",
      "other = make_thing()",
      "# llm.invoke(x)",
      "s = 'llm.invoke(y)'",
      "other.invoke(z)",
      "self_llm.invoke(q)",
      "",
    ].join("\n");
    expect(plan(text)).toEqual([]);
  });

  it("only treats statement-level assignments as LLM constructions", () => {
    const text = "agent = create_agent(\n    model=init_chat_model('x'),\n)\nmodel.invoke('hi')\n";
    expect([...findLlmVariables(text)]).toEqual([]);
    const typed = "llm: BaseChatModel = langchain_groq.ChatGroq(model='m')\nself.chat = ChatAnthropic()\n";
    expect([...findLlmVariables(typed)].sort()).toEqual(["llm", "self.chat"]);
  });

  it("wraps keyword input=, keeps other args, handles nested parens", () => {
    const text = "llm = ChatGroq()\nr = llm.ainvoke(input=build(a, (b, c)), config=cfg)\n";
    const [p] = plan(text);
    expect(p.modified).toBe(`llm.ainvoke(input=optimize_messages(build(a, (b, c)), ${W}), config=cfg)`);
    expect(p.pattern).toBe("invoke");
  });

  it("skips calls without an input or with *args", () => {
    expect(plan("llm = ChatGroq()\nllm.invoke()\nllm.invoke(*xs)\n")).toEqual([]);
  });

  it("extends an existing middleware list (multi-line, trailing comma) and wraps a middleware variable", () => {
    const text = [
      "agent = create_agent(",
      "    model,",
      "    middleware=[",
      "        Logging(),",
      "    ],",
      ")",
      "other = create_agent(model, middleware=extra)",
      "",
    ].join("\n");
    const [a, b] = plan(text, ["router"]);
    expect(a.modified).toBe(
      "create_agent(\n    model,\n    middleware=[\n        Logging(),\n        ModelRouterMiddleware(),\n    ],\n)"
    );
    expect(b.modified).toBe("create_agent(model, middleware=[*extra, ModelRouterMiddleware()])");
  });

  it("appends to one-line calls and empty calls; skips agents that already have the middleware", () => {
    const [one] = plan("a = create_agent(model, tools=[t])\n", ["router"]);
    expect(one.modified).toBe("create_agent(model, tools=[t], middleware=[ModelRouterMiddleware()])");
    const [empty] = plan("a = create_agent()\n", ["router"]);
    expect(empty.modified).toBe("create_agent(middleware=[ModelRouterMiddleware()])");
    const done = "a = create_agent(m, middleware=[ModelRouterMiddleware()])\n";
    expect(plan(done, ["router"])).toEqual([]);
    expect(plan(done, ["optimizer", "router"]).map((p) => p.modified)).toEqual([
      `create_agent(m, middleware=[ModelRouterMiddleware(), PromptOptimizationMiddleware(${W})])`,
    ]);
    expect(plan("def create_agent(x):\n    pass\n", ["router"])).toEqual([]);
  });

  it("puts a new kwarg before a closing paren on the last-arg line, after a trailing comment", () => {
    const [p] = plan("a = create_agent(\n    model,  # the model\n    tools=[t])\n", ["router"]);
    expect(p.modified).toBe(
      "create_agent(\n    model,  # the model\n    tools=[t],\n    middleware=[ModelRouterMiddleware()])"
    );
    const [q] = plan("a = create_agent(\n    model,  # the model\n)\n", ["router"]);
    expect(q.modified).toBe("create_agent(\n    model,  # the model\n    middleware=[ModelRouterMiddleware()],\n)");
  });

  it("optimizer with no techniques yields nothing; no features yields nothing", () => {
    expect(plan("llm = ChatGroq()\nllm.invoke(x)\n", ["optimizer"], [])).toEqual([]);
    expect(plan("llm = ChatGroq()\nllm.invoke(x)\n", [])).toEqual([]);
  });

  it("works on CRLF files (columns exclude \\r, new lines use CRLF)", () => {
    const text = '"""Doc."""\r\n\r\nimport os\r\n\r\nllm = ChatGroq()\r\nout = llm.invoke(p)\r\na = create_agent(\r\n    llm,\r\n)\r\n';
    const ps = plan(text, ["optimizer", "router"]);
    expect(ps.map((p) => p.pattern)).toEqual(["construction", "agent"]);
    expect(ps[0].range).toEqual({ startLine: 5, startCol: 6, endLine: 5, endCol: 19 });
    expect(rangeText(text, ps[0].range)).toBe(ps[0].original);
    expect(ps[1].modified).toBe(
      `create_agent(\r\n    llm,\r\n    middleware=[PromptOptimizationMiddleware(${W}), ModelRouterMiddleware()],\r\n)`
    );
    const r = planProposalEdits(text, ps[0]);
    if (r.stale) throw new Error("stale");
    expect(applyOffsetEdits(text, r.edits)).toContain(
      "import os\r\nfrom ai_optimizer import optimize_messages\r\nfrom ai_optimizer import get_model\r\n\r\nllm"
    );
  });
});

describe("imports", () => {
  it("detects existing imports in any form", () => {
    const text = "from ai_optimizer import (\n    get_model,\n    optimize_messages as om,\n)\n";
    expect(isImported(text, "from ai_optimizer import get_model")).toBe(true);
    expect(isImported(text, "from ai_optimizer import optimize_messages")).toBe(false);
    expect(isImported("from ai_optimizer import *\n", "from ai_optimizer import get_model")).toBe(true);
    expect(isImported("# from ai_optimizer import get_model\n", "from ai_optimizer import get_model")).toBe(false);
  });

  it("inserts after the docstring when there are no imports, before code otherwise", () => {
    const docOnly = '"""Doc\nstring."""\n\nx = 1\n';
    const ins = planImportInsertion(docOnly, ["from a import b"])!;
    expect(applyOffsetEdits(docOnly, [{ start: ins.offset, end: ins.offset, text: ins.text }])).toBe(
      '"""Doc\nstring."""\n\nfrom a import b\n\nx = 1\n'
    );
    const bare = "#!/usr/bin/env python\nx = 1\n";
    const ins2 = planImportInsertion(bare, ["from a import b", "from a import b"])!;
    expect(ins2.added).toEqual(["from a import b"]);
    expect(applyOffsetEdits(bare, [{ start: ins2.offset, end: ins2.offset, text: ins2.text }])).toBe(
      "#!/usr/bin/env python\nfrom a import b\n\nx = 1\n"
    );
    expect(planImportInsertion("", ["from a import b"])).toEqual({ offset: 0, text: "from a import b\n", added: ["from a import b"] });
  });

  it("follows parenthesised and continued imports and keeps later imports out of the header", () => {
    const text = "from x import (\n    a,\n    b,\n)\nimport y, \\\n    z\nfoo()\nimport late\n";
    const ins = planImportInsertion(text, ["from a import b"])!;
    expect(text.slice(0, ins.offset)).toBe("from x import (\n    a,\n    b,\n)\nimport y, \\\n    z\n");
    expect(planImportInsertion(text, ["from x import a"])).toBeNull();
  });
});

describe("stale + rebase", () => {
  const text = "llm = ChatGroq()\nllm.invoke(a)\nllm.invoke(b)\n";

  it("marks a block stale when its original text moved or changed", () => {
    const [, second] = plan(text);
    expect(planProposalEdits(text.replace("invoke(b)", "invoke(bb)"), second).stale).toBe(true);
  });

  it("rebases pending ranges through applied edits", () => {
    const [first, second] = plan(text);
    const r = planProposalEdits(text, first);
    if (r.stale) throw new Error("stale");
    const after = applyOffsetEdits(text, r.edits);
    const moved = rebaseRange(text, after, second.range, r.edits)!;
    expect(moved.startLine).toBe(second.range.startLine + 2); // import line + blank line
    expect(rangeText(after, moved)).toBe(second.original);
    expect(rebaseRange(text, after, first.range, r.edits)).toBeNull(); // overlaps the applied block
    expect(rebaseRange(text, "changed", second.range, r.edits)).toBeNull();
  });
});

describe("export plan", () => {
  const strategies = [
    { id: "b-rule", optimizer: { mode: "rule", ruleId: "b", order: 20, affects: "input" } },
    { id: "a-rule", optimizer: { mode: "rule", ruleId: "a", order: 10, affects: "output", params: { k: 1 } } },
    { id: "llm-x", optimizer: { mode: "llm", promptTemplateId: "t", order: 5, affects: "input" } },
    { id: "plain" },
  ] as unknown as Strategy[];

  it("catalog_techniques.json: rule techniques in order, selection filtered to rule ids", () => {
    expect(buildCatalogTechniquesJson(strategies, ["llm-x", "b-rule", "a-rule", "nope"])).toEqual({
      selected: ["a-rule", "b-rule"],
      techniques: [
        { id: "a-rule", mode: "rule", ruleId: "a", order: 10, affects: "output", params: { k: 1 } },
        { id: "b-rule", mode: "rule", ruleId: "b", order: 20, affects: "input", params: {} },
      ],
    });
  });

  const cfg: RouterConfig = {
    presetId: "default",
    tiers: {
      economy: [{ providerId: "groq", modelId: "small" }, { providerId: "openai", modelId: "mini" }],
      standard: [{ providerId: "groq", modelId: "mid" }],
      advanced: [{ providerId: "anthropic", modelId: "big" }],
    },
    rules: { maxCharsForEconomy: 10, advancedKeywords: [], needsToolsMinTier: "standard", defaultTier: "standard" },
  };

  it("router config keeps only enabled models, unless nothing would remain", () => {
    expect(restrictRouterConfig(cfg, {}).tiers).toEqual(cfg.tiers);
    expect(restrictRouterConfig(cfg, { groq: ["small", "mid"] }).tiers).toEqual({
      economy: [{ providerId: "groq", modelId: "small" }],
      standard: [{ providerId: "groq", modelId: "mid" }],
      advanced: [],
    });
    expect(restrictRouterConfig(cfg, { mistral: ["x"] })).toBe(cfg);
  });

  it("export files: runtime modules + generated JSON (generated wins), sorted", () => {
    const files = planExportFiles({
      targetDir: "lib\\ai_optimizer/",
      runtimeFiles: [
        { name: "router.py", content: "r" },
        { name: "router_config.json", content: "stale" },
        { name: "__init__.py", content: "i" },
      ],
      techniques: { selected: [], techniques: [] },
      routerConfig: cfg,
    });
    expect(files.map((f) => f.path)).toEqual([
      "lib/ai_optimizer/__init__.py",
      "lib/ai_optimizer/catalog_techniques.json",
      "lib/ai_optimizer/router.py",
      "lib/ai_optimizer/router_config.json",
    ]);
    expect(JSON.parse(files[3].content)).toEqual(cfg);
  });
});

describe("scan paths", () => {
  it("skips venvs, VCS, deps, caches and the exported package", () => {
    expect(shouldScanPythonPath("app/main.py")).toBe(true);
    expect(shouldScanPythonPath("main.txt")).toBe(false);
    for (const p of [".venv/lib/x.py", "a/venv/x.py", ".git/x.py", "node_modules/p/x.py", "lib/site-packages/x.py", "a/__pycache__/x.py", "ai_optimizer/router.py"]) {
      expect(shouldScanPythonPath(p)).toBe(false);
    }
    expect(shouldScanPythonPath("ai_optimizer_extra/x.py")).toBe(true);
    expect(shouldScanPythonPath("pkg/opt/router.py", "pkg/opt")).toBe(false);
    expect(scanExcludeGlob("pkg/opt/")).toBe(
      "{**/venv/**,**/.venv/**,**/.git/**,**/node_modules/**,**/site-packages/**,**/__pycache__/**,pkg/opt/**}"
    );
  });
});

describe("router: constructor kwargs are forwarded to get_model", () => {
  it("drops model identity, keeps the other kwargs (multi-line too), uses the closest construction", () => {
    const text = [
      "from langchain_openai import ChatOpenAI",
      "llm = ChatOpenAI(model=\"gpt-4o\", temperature=0)",
      "a = llm.invoke(q)",
      "llm = ChatOpenAI(",
      "    model_name=\"gpt-4o-mini\",",
      "    max_tokens=256,",
      "    timeout=30,",
      ")",
      "b = llm.invoke(q)",
      "m = init_chat_model(\"openai/gpt-oss-20b\", model_provider=\"groq\")",
      "c = m.invoke(q)",
      "",
    ].join("\n");
    expect(findLlmConstructors(text).map((c) => [c.name, c.kwargs])).toEqual([
      ["llm", ["temperature=0"]],
      ["llm", ["max_tokens=256", "timeout=30"]],
      ["m", []],
    ]);
    expect(plan(text, ["router"]).map((p) => p.modified)).toEqual([
      "get_model(q, temperature=0).invoke(q)",
      "get_model(q, max_tokens=256, timeout=30).invoke(q)",
      "get_model(q).invoke(q)",
    ]);
  });
});
