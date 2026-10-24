/**
 * Scenario `promptopt-rules` (Gate B, no network): the real built host answers `promptopt/run`
 * with rule techniques only. The catalog comes from the bundled snapshot (API on a closed local
 * port). Asserts the `promptopt/result` shape: catalog-ordered steps chained by token counts,
 * optimized text, max_tokens cap, token savings, and $ per 1k calls for the selected Groq model.
 * Also asserts an unknown model answers `promptopt/error` "no-model".
 *
 * Exports: description, run
 * Feature: prompt optimizer
 */
const description = "promptopt/run with rule techniques -> promptopt/result with steps, savings and $ per 1k calls";

const PROMPT = [
  "Could you please   summarize the attached report?",
  "",
  "",
  "Please note that the data is very old.",
  "---",
  "Summarize the attached report.   ",
  "Thanks in advance",
].join("\n");

async function run(ctx) {
  const { createHost, assert, step } = ctx;
  const port = await ctx.closedPort();
  const host = createHost({ config: { catalogApiUrl: `http://127.0.0.1:${port}/v1` } });
  host.activate();
  await host.openView();
  const delivered = host.waitFor("catalog/updated", () => true, 30000);
  await host.send({ version: 1, type: "webview/ready", payload: {} });
  const catalog = (await delivered).payload;
  assert.equal(catalog.isOffline, true, "scenario must not need the catalog API");
  step(`catalog from bundled snapshot (${catalog.strategies.length} techniques)`);

  const techniqueIds = ["max-output-cap", "caveman-output", "dedupe-sentences", "filler-removal", "whitespace-normalize"];
  const resultP = host.waitFor("promptopt/result", (m) => m.payload.operationId === "rules-1", 15000);
  await host.send({
    version: 1,
    type: "promptopt/run",
    payload: {
      operationId: "rules-1",
      messages: [{ role: "user", content: PROMPT }],
      techniqueIds,
      providerId: "groq",
      modelId: "openai/gpt-oss-20b",
      expectedOutputTokens: 800,
    },
  });
  const r = (await resultP).payload;
  step(`promptopt/result: ${r.original.inputTokens} -> ${r.optimized.inputTokens} input tokens (${r.tokenLabel})`);

  assert.deepEqual(
    r.steps.map((s) => s.techniqueId),
    ["whitespace-normalize", "filler-removal", "dedupe-sentences", "caveman-output", "max-output-cap"],
    "steps run in catalog order"
  );
  assert.ok(r.steps.every((s) => s.mode === "rule"));
  assert.equal(r.steps[0].inputTokensBefore, r.original.inputTokens);
  for (let i = 1; i < r.steps.length; i++) {
    assert.equal(r.steps[i].inputTokensBefore, r.steps[i - 1].inputTokensAfter, "step tokens chain");
  }
  assert.equal(r.steps.at(-1).inputTokensAfter, r.optimized.inputTokens);
  assert.ok(r.steps.slice(0, 3).every((s) => s.applied && s.inputTokensAfter < s.inputTokensBefore), "input rules shrink the prompt");
  step(`steps: ${r.steps.map((s) => `${s.techniqueId} ${s.inputTokensBefore}->${s.inputTokensAfter}`).join(", ")}`);

  const [sys, user] = r.optimized.messages;
  assert.equal(sys.role, "system", "caveman-output inserts a system instruction");
  // "Thanks in advance" is fully removed by filler-removal and stays as an empty last line.
  assert.equal(user.content, "Summarize the attached report?\n\nThe data is old.\n");
  assert.equal(r.optimized.params.max_tokens, 512);
  assert.deepEqual(r.original.messages, [{ role: "user", content: PROMPT }]);

  const userBefore = r.steps[0].inputTokensBefore;
  const userAfter = r.steps[2].inputTokensAfter;
  const pct = ((userBefore - userAfter) / userBefore) * 100;
  assert.ok(pct >= 30, `rule techniques should save >=30% of prompt tokens, got ${pct.toFixed(1)}%`);
  step(`input rules saved ${userBefore - userAfter} tokens (${pct.toFixed(1)}%) before the caveman instruction`);

  const c = r.cost;
  assert.ok(c, "cost for the selected model");
  assert.equal(c.modelId, "openai/gpt-oss-20b");
  assert.equal(c.inputPerMTok, 0.075);
  assert.equal(c.outputPerMTok, 0.3);
  assert.equal(c.outputTokensBefore, 800);
  assert.equal(c.outputTokensAfter, Math.round(512 * 0.6), "cap 512, then caveman 40% midpoint");
  const per1k = (i, o) => Number((((i * c.inputPerMTok + o * c.outputPerMTok) / 1e6) * 1000).toFixed(6));
  assert.equal(c.usdPer1kCallsBefore, per1k(r.original.inputTokens, 800));
  assert.equal(c.usdPer1kCallsAfter, per1k(r.optimized.inputTokens, c.outputTokensAfter));
  assert.ok(c.usdPer1kCallsAfter < c.usdPer1kCallsBefore);
  step(`$ per 1k calls: ${c.usdPer1kCallsBefore} -> ${c.usdPer1kCallsAfter}`);
  assert.equal(r.llmUsage, undefined, "no LLM call for rule techniques");

  const errP = host.waitFor("promptopt/error", (m) => m.payload.operationId === "rules-2", 10000);
  await host.send({
    version: 1,
    type: "promptopt/run",
    payload: {
      operationId: "rules-2",
      messages: [{ role: "user", content: "hi" }],
      techniqueIds: ["filler-removal"],
      providerId: "groq",
      modelId: "no-such-model",
    },
  });
  assert.equal((await errP).payload.error, "no-model");
  step("unknown model -> promptopt/error no-model");
  host.deactivate();
}

module.exports = { description, run };
