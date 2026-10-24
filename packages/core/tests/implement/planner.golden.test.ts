/**
 * Golden tests for the Implement planner on examples/demo-langchain-app: the expected proposal
 * count per pattern for each feature selection, the exact modified text of every block, and the
 * exact file text after applying a block (block + import, no duplicates, idempotent re-scan).
 *
 * Exports: none (test suite)
 * Feature: implement optimization (planner)
 */
import { describe, it, expect } from "vitest";
import {
  applyOffsetEdits,
  planProposalEdits,
  planPythonFile,
  type ImplementEditProposal,
  type ImplementFeature,
} from "../../src/index.js";

const demo: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../../../examples/demo-langchain-app/*.py", {
      eager: true,
      query: "?raw",
      import: "default",
    })
  ).map(([p, text]) => [p.split("/").pop() as string, text.replace(/\r\n/g, "\n")])
);

const IDS = ["whitespace-normalize", "filler-removal"];
const HASH = "a".repeat(64);
const L = `["whitespace-normalize", "filler-removal"]`;

function scan(features: ImplementFeature[]): ImplementEditProposal[] {
  return Object.keys(demo)
    .sort()
    .flatMap((f) => planPythonFile(f, demo[f], HASH, { features, techniqueIds: IDS }));
}

const plan = (file: string, text: string, features: ImplementFeature[]) =>
  planPythonFile(file, text, HASH, { features, techniqueIds: IDS });

const countBy = (ps: ImplementEditProposal[]) =>
  ps.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.pattern]: (acc[p.pattern] ?? 0) + 1 }), {});

const AGENT_ORIGINAL = `create_agent(
    model,
    tools=[get_order_status],
    system_prompt="You are a helpful support agent. Use tools to look up orders.",
)`;
const DRAFT_ARG = `[
            ("system", "You write short, friendly support replies (max 3 sentences)."),
            ("user", f"Ticket:\\n{ticket}"),  # the customer's own words
        ]`;
const DRAFT_ORIGINAL = `drafter.stream(
        ${DRAFT_ARG},
        config={"tags": ["demo"]},
    )`;
const agentWith = (mw: string) => AGENT_ORIGINAL.replace(/\)$/, `    middleware=[${mw}],\n)`);

describe("pyEditPlanner goldens on demo-langchain-app", () => {
  it("demo app has the expected files", () => {
    expect(Object.keys(demo).sort()).toEqual(["main.py", "reply_drafter.py", "summarizer.py", "support_agent.py"]);
  });

  it("optimizer only: 3 invoke (P2) + 1 agent (P1), exact text", () => {
    const ps = scan(["optimizer"]);
    expect(countBy(ps)).toEqual({ invoke: 3, agent: 1 });
    expect(ps.map((p) => [p.id, p.feature, p.original, p.modified, p.importsToAdd])).toEqual([
      [
        "invoke@reply_drafter.py:19:13",
        "optimizer",
        DRAFT_ORIGINAL,
        `drafter.stream(
        optimize_messages(${DRAFT_ARG}, ${L}),
        config={"tags": ["demo"]},
    )`,
        ["from ai_optimizer import optimize_messages"],
      ],
      [
        "invoke@summarizer.py:22:11",
        "optimizer",
        "llm.invoke(prompt)",
        `llm.invoke(optimize_messages(prompt, ${L}))`,
        ["from ai_optimizer import optimize_messages"],
      ],
      [
        "invoke@summarizer.py:31:11",
        "optimizer",
        "llm.invoke(messages)",
        `llm.invoke(optimize_messages(messages, ${L}))`,
        ["from ai_optimizer import optimize_messages"],
      ],
      [
        "agent@support_agent.py:22:8",
        "optimizer",
        AGENT_ORIGINAL,
        agentWith(`PromptOptimizationMiddleware(${L})`),
        ["from ai_optimizer.middleware import PromptOptimizationMiddleware"],
      ],
    ]);
    expect(ps[0].range).toEqual({ startLine: 18, startCol: 13, endLine: 24, endCol: 5 });
    expect(ps[1].range).toEqual({ startLine: 21, startCol: 11, endLine: 21, endCol: 29 });
    expect(ps.every((p) => p.fileHash === HASH)).toBe(true);
  });

  it("router only: 3 construction (P3) + 1 agent (P1), exact text", () => {
    const ps = scan(["router"]);
    expect(countBy(ps)).toEqual({ construction: 3, agent: 1 });
    expect(ps.map((p) => [p.feature, p.modified, p.importsToAdd])).toEqual([
      [
        "router",
        `get_model(routed_input := ${DRAFT_ARG}, temperature=0.2).stream(
        routed_input,
        config={"tags": ["demo"]},
    )`,
        ["from ai_optimizer import get_model"],
      ],
      ["router", "get_model(prompt, temperature=0).invoke(prompt)", ["from ai_optimizer import get_model"]],
      ["router", "get_model(messages, temperature=0).invoke(messages)", ["from ai_optimizer import get_model"]],
      ["router", agentWith("ModelRouterMiddleware()"), ["from ai_optimizer.middleware import ModelRouterMiddleware"]],
    ]);
  });

  it("both features: one block per site (no overlaps), exact text", () => {
    const ps = scan(["optimizer", "router"]);
    expect(countBy(ps)).toEqual({ construction: 3, agent: 1 });
    expect(ps.map((p) => p.modified)).toEqual([
      `get_model(routed_input := ${DRAFT_ARG}, temperature=0.2).stream(
        optimize_messages(routed_input, ${L}),
        config={"tags": ["demo"]},
    )`,
      `get_model(prompt, temperature=0).invoke(optimize_messages(prompt, ${L}))`,
      `get_model(messages, temperature=0).invoke(optimize_messages(messages, ${L}))`,
      agentWith(`PromptOptimizationMiddleware(${L}), ModelRouterMiddleware()`),
    ]);
    expect(ps[3].feature).toBe("optimizer");
    expect(ps[3].importsToAdd).toEqual([
      "from ai_optimizer.middleware import PromptOptimizationMiddleware",
      "from ai_optimizer.middleware import ModelRouterMiddleware",
    ]);
    expect(ps[1].importsToAdd).toEqual([
      "from ai_optimizer import optimize_messages",
      "from ai_optimizer import get_model",
    ]);
  });

  it("main.py has no call sites (agent.invoke is not a chat model)", () => {
    expect(plan("main.py", demo["main.py"], ["optimizer", "router"])).toEqual([]);
  });

  it("applying a block yields the exact file text (block + import once); re-scan is idempotent", () => {
    const text = demo["summarizer.py"];
    const [first, second] = plan("summarizer.py", text, ["optimizer"]);
    const r1 = planProposalEdits(text, first);
    if (r1.stale) throw new Error("unexpected stale");
    const after1 = applyOffsetEdits(text, r1.edits);
    expect(after1).toBe(
      text
        .replace(
          "from langchain_groq import ChatGroq\n",
          "from langchain_groq import ChatGroq\nfrom ai_optimizer import optimize_messages\n"
        )
        .replace("return llm.invoke(prompt).content", `return llm.invoke(optimize_messages(prompt, ${L})).content`)
    );
    // the second block moved one line down: stale at its old range
    expect(planProposalEdits(after1, second).stale).toBe(true);
    const [again] = plan("summarizer.py", after1, ["optimizer"]);
    expect(again.original).toBe("llm.invoke(messages)");
    expect(again.range.startLine).toBe(second.range.startLine + 1);
    const r2 = planProposalEdits(after1, again);
    if (r2.stale) throw new Error("unexpected stale");
    expect(r2.importsAdded).toEqual([]);
    const after2 = applyOffsetEdits(after1, r2.edits);
    expect(after2.match(/from ai_optimizer import optimize_messages/g)).toHaveLength(1);
    expect(plan("summarizer.py", after2, ["optimizer"])).toEqual([]);
    // the router can still be layered on an optimized site; it routes on the raw input
    expect(plan("summarizer.py", after2, ["router"]).map((p) => p.modified)).toEqual([
      `get_model(prompt, temperature=0).invoke(optimize_messages(prompt, ${L}))`,
      `get_model(messages, temperature=0).invoke(optimize_messages(messages, ${L}))`,
    ]);
  });

  it("applying the agent block adds the middleware imports after the existing imports", () => {
    const text = demo["support_agent.py"];
    const [p] = plan("support_agent.py", text, ["optimizer", "router"]);
    const r = planProposalEdits(text, p);
    if (r.stale) throw new Error("unexpected stale");
    const out = applyOffsetEdits(text, r.edits);
    expect(out).toContain(
      "from langchain.chat_models import init_chat_model\n" +
        "from ai_optimizer.middleware import PromptOptimizationMiddleware\n" +
        "from ai_optimizer.middleware import ModelRouterMiddleware\n\nmodel = "
    );
    expect(plan("support_agent.py", out, ["optimizer", "router"])).toEqual([]);
  });
});
