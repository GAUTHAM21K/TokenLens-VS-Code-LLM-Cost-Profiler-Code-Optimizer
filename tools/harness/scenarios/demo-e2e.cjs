/**
 * Scenario `demo-e2e` (Gate 2): the whole demo in one run against the real host, no keys, on a temp
 * copy of examples/demo-langchain-app. Catalog: the bundled offline snapshot by default, or a real
 * Catalog API with `--api-url <url>` (e.g. `pnpm catalog:dev`), then asserted online:
 *   1. seeded profile -> estimate (Groq models priced)
 *   2. strategy/evaluate + strategy/set to the rule techniques -> savings (per channel) asserted
 *   3. promptopt/run with those rule techniques -> steps, tokens and $ asserted
 *   4. implement/export + scan (optimizer) on the temp workspace
 *   5. apply every optimizer block, then re-scan (router) and apply one router block; file text asserted
 *   6. router/preview for a short, an advanced and a tool-using prompt
 *
 * Exports: description, run
 * Feature: all four demo features (estimator, prompt optimizer, implement, router)
 */
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("../lib/host.cjs");

const description =
  "seeded profile -> estimate -> techniques + savings -> prompt optimizer -> export/scan/apply on the demo app -> router preview";
const DEMO = path.join(REPO_ROOT, "examples/demo-langchain-app");
const RULES = ["whitespace-normalize", "filler-removal", "dedupe-sentences", "caveman-output", "max-output-cap"];
const INPUT_RULES = ["whitespace-normalize", "filler-removal", "dedupe-sentences"];
const PROMPT = [
  "Please could you kindly read the following customer support ticket very carefully and then write a short summary of it.   Please keep it short.",
  "",
  "",
  "Ticket: my order A100 was charged twice. Please keep it short.",
].join("\n");

async function run(ctx) {
  const { createHost, assert, step } = ctx;
  const apiUrl = ctx.args["api-url"] || `http://127.0.0.1:${await ctx.closedPort()}/v1`;
  const online = Boolean(ctx.args["api-url"]);
  const host = createHost({
    seedProfile: true,
    config: { catalogApiUrl: apiUrl },
    tempWorkspaceFrom: DEMO,
  });
  const ws = host.workspaceDir;
  const read = (rel) => fs.readFileSync(path.join(ws, rel), "utf8").replace(/\r\n/g, "\n");
  const original = Object.fromEntries(
    ["summarizer.py", "support_agent.py", "reply_drafter.py"].map((f) => [f, read(f)])
  );
  const reply = async (msg, type, match = () => true, timeout = 20000) => {
    const got = host.waitFor(type, match, timeout);
    await host.send(msg);
    return (await got).payload;
  };

  try {
    host.activate();
    await host.openView();

    // 1. seeded profile -> estimate
    const hydrated = host.waitFor("enhance/versionLoaded", () => true, 20000);
    const catalog = await reply({ version: 1, type: "webview/ready", payload: {} }, "catalog/updated");
    assert.equal(catalog.isOffline, !online, online ? "catalog must come from the API" : "offline snapshot");
    const profileVersion = (await hydrated).payload.entry.version;
    const est = (await reply(
      { version: 1, type: "estimate/request", payload: { profileVersion } },
      "estimate/result"
    )).result;
    const models = Object.keys(est.runtime.totalByModel);
    for (const m of ["openai/gpt-oss-20b", "openai/gpt-oss-120b"]) {
      assert.ok(models.includes(m), `Groq model ${m} must be priced (got ${models.join(", ")})`);
    }
    const groqRuntime = est.runtime.totalByModel["openai/gpt-oss-20b"];
    assert.ok(groqRuntime.expected > 0, "Groq runtime cost > 0");
    assert.ok(
      Math.abs(groqRuntime.expectedInput + groqRuntime.expectedOutput - groqRuntime.expected) < 0.001,
      "input + output split adds up to the expected cost"
    );
    step(
      `${online ? `catalog API ${apiUrl}` : "offline snapshot"}; profile v${profileVersion} -> estimate: ` +
        `${models.length} models priced; gpt-oss-20b runtime $${groqRuntime.expected}/mo`
    );

    // 2. techniques: evaluate (pre-select) then set the rule techniques
    await reply({ version: 1, type: "strategy/evaluate", payload: { profileVersion } }, "strategy/savingsUpdate");
    const sel = host.waitFor("strategy/selection", () => true, 20000);
    const sav = await reply({ version: 1, type: "strategy/set", payload: { selectedIds: RULES } }, "strategy/savingsUpdate");
    assert.deepEqual((await sel).payload.selected.map((s) => s.strategyId).sort(), [...RULES].sort());
    const { input, output } = sav.channels.runtime;
    assert.ok(input.maxPercent > 0 && output.maxPercent > 0, "both channels save something");
    assert.ok(
      sav.runtime.maxPercent < Math.max(input.maxPercent, output.maxPercent) + 0.001 &&
        sav.runtime.maxPercent > Math.min(input.maxPercent, output.maxPercent) - 0.001,
      "the total is a cost-weighted mix of the two channels, not their compound"
    );
    step(
      `strategy/set ${RULES.length} rule techniques -> input ${input.minPercent}–${input.maxPercent}%, ` +
        `output ${output.minPercent}–${output.maxPercent}%, total ${sav.runtime.minPercent}–${sav.runtime.maxPercent}%`
    );

    // 3. prompt optimizer with the same rule techniques
    const opt = await reply(
      {
        version: 1,
        type: "promptopt/run",
        payload: {
          operationId: "demo-opt",
          messages: [{ role: "user", content: PROMPT }],
          techniqueIds: RULES,
          providerId: "groq",
          modelId: "openai/gpt-oss-20b",
          expectedOutputTokens: 400,
        },
      },
      "promptopt/result",
      (m) => m.payload.operationId === "demo-opt"
    );
    assert.deepEqual(opt.steps.map((s) => s.techniqueId), RULES, "catalog order");
    const afterInputRules = opt.steps.find((s) => s.techniqueId === INPUT_RULES.at(-1)).inputTokensAfter;
    assert.ok(afterInputRules < opt.original.inputTokens, "input rules shrink the prompt");
    assert.ok(opt.optimized.params && opt.optimized.params.max_tokens > 0, "max-output-cap sets max_tokens");
    assert.ok(opt.optimized.messages[0].role === "system", "caveman-output adds a system instruction");
    assert.ok(opt.cost.usdPer1kCallsAfter < opt.cost.usdPer1kCallsBefore, "$ per 1k calls goes down");
    step(
      `promptopt/run: input ${opt.original.inputTokens} -> ${afterInputRules} tokens after input rules; ` +
        `$/1k calls ${opt.cost.usdPer1kCallsBefore} -> ${opt.cost.usdPer1kCallsAfter} (output ${opt.cost.outputTokensBefore} -> ${opt.cost.outputTokensAfter} tokens)`
    );

    // 4. export + scan (optimizer)
    const ex = await reply(
      { version: 1, type: "implement/export", payload: { operationId: "exp", techniqueIds: RULES } },
      "implement/exported",
      (m) => m.payload.operationId === "exp"
    );
    const techJson = JSON.parse(read("ai_optimizer/catalog_techniques.json"));
    assert.deepEqual(techJson.selected, RULES);
    const scan1 = await reply(
      { version: 1, type: "implement/scan", payload: { operationId: "s1", features: ["optimizer"], techniqueIds: RULES } },
      "implement/proposals",
      (m) => m.payload.operationId === "s1"
    );
    assert.deepEqual(
      scan1.proposals.map((p) => `${p.pattern}@${p.file}`),
      ["invoke@reply_drafter.py", "invoke@summarizer.py", "invoke@summarizer.py", "agent@support_agent.py"]
    );
    step(`export -> ${ex.filesWritten.length} files in ${ex.targetDir}/; scan (optimizer) -> ${scan1.proposals.length} blocks`);

    // 5. apply every optimizer block (in order, as "Apply all remaining" does), then one router block
    for (const p of scan1.proposals) {
      const r = await reply(
        { version: 1, type: "implement/applyBlock", payload: { proposalId: p.id } },
        "implement/blockResult",
        (m) => m.payload.proposalId === p.id
      );
      assert.equal(r.status, "applied", `${p.id}: ${r.message}`);
    }
    const L = JSON.stringify(RULES).replace(/","/g, '", "');
    const summarizer = read("summarizer.py");
    assert.equal(
      summarizer,
      original["summarizer.py"]
        .replace("from langchain_groq import ChatGroq\n", "from langchain_groq import ChatGroq\nfrom ai_optimizer import optimize_messages\n")
        .replace("return llm.invoke(prompt).content", `return llm.invoke(optimize_messages(prompt, ${L})).content`)
        .replace("return llm.invoke(messages).content", `return llm.invoke(optimize_messages(messages, ${L})).content`),
      "summarizer.py: both invoke sites optimized, one import"
    );
    const agentText = read("support_agent.py");
    assert.ok(agentText.includes(`middleware=[PromptOptimizationMiddleware(${L})]`), "agent gets the prompt middleware");
    assert.ok(read("reply_drafter.py").includes("optimize_messages(["), "multi-line stream site optimized");

    const scan2 = await reply(
      { version: 1, type: "implement/scan", payload: { operationId: "s2", features: ["router"], techniqueIds: RULES } },
      "implement/proposals",
      (m) => m.payload.operationId === "s2"
    );
    const summarizeRoute = scan2.proposals.find(
      (p) => p.file === "summarizer.py" && p.original.startsWith("llm.invoke(optimize_messages(prompt")
    );
    assert.ok(summarizeRoute, "router proposal for the optimized summarize site");
    assert.equal(summarizeRoute.feature, "router");
    const rr = await reply(
      { version: 1, type: "implement/applyBlock", payload: { proposalId: summarizeRoute.id } },
      "implement/blockResult",
      (m) => m.payload.proposalId === summarizeRoute.id
    );
    assert.equal(rr.status, "applied", rr.message);
    assert.equal(
      read("summarizer.py"),
      summarizer
        .replace("from ai_optimizer import optimize_messages\n", "from ai_optimizer import optimize_messages\nfrom ai_optimizer import get_model\n")
        .replace(
          `return llm.invoke(optimize_messages(prompt, ${L})).content`,
          `return get_model(prompt, temperature=0).invoke(optimize_messages(prompt, ${L})).content`
        ),
      "summarizer.py: routed summarize site keeps temperature=0"
    );
    step(
      `applied ${scan1.proposals.length} optimizer blocks + 1 router block (${summarizeRoute.id}); ` +
        `file text asserted (${scan2.proposals.length} router blocks offered)`
    );

    // 6. router preview
    const preview = async (id, payload) =>
      (await reply(
        { version: 1, type: "router/preview", payload: { operationId: id, ...payload } },
        "router/previewResult",
        (m) => m.payload.operationId === id
      )).decision;
    const short = await preview("r1", { text: "Summarize: order A100 was charged twice." });
    const adv = await preview("r2", { text: "Analyze the architecture trade-offs of our refund pipeline." });
    const tools = await preview("r3", { text: "What is the status of order A100?", needsTools: true });
    assert.equal(short.tier, "economy");
    assert.equal(adv.tier, "advanced");
    assert.equal(tools.tier, "standard");
    step(`router/preview: short -> ${short.tier} ${short.model}; analyze -> ${adv.tier} ${adv.model}; tools -> ${tools.tier} ${tools.model}`);
  } finally {
    host.deactivate();
  }
}

module.exports = { description, run };
