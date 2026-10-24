/**
 * Scenario `implement-flow` (Gate D): on a temp copy of examples/demo-langchain-app (offline
 * catalog, no network, no keys) it runs the Implement flow end to end against the real host:
 *   1. export -> ai_optimizer/ written by ONE WorkspaceEdit (runtime + generated JSON)
 *   2. scan (optimizer) -> 4 proposals (3 invoke + 1 agent); .venv and ai_optimizer/ skipped
 *   3. apply summarize block -> exact file text (block + one import), saved, one WorkspaceEdit
 *   4. skip the classify block
 *   5. user edits support_agent.py, then applies the agent block -> stale + automatic re-scan
 *   6. apply the multi-line stream block from the re-scan, open a diff, undo restores the file
 *
 * Exports: description, run
 * Feature: implement optimization
 */
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("../lib/host.cjs");

const description = "export ai_optimizer, scan demo app, apply/skip/stale/diff/undo per block (temp workspace)";
const DEMO = path.join(REPO_ROOT, "examples/demo-langchain-app");
const TECHS = ["whitespace-normalize", "filler-removal", "llm-compress"];
const L = `["whitespace-normalize", "filler-removal"]`;

async function run(ctx) {
  const { createHost, assert, step } = ctx;
  const host = createHost({ config: { catalogApiUrl: "" }, tempWorkspaceFrom: DEMO });
  const ws = host.workspaceDir;
  const read = (rel) => fs.readFileSync(path.join(ws, rel), "utf8").replace(/\r\n/g, "\n");
  const original = Object.fromEntries(
    ["summarizer.py", "support_agent.py", "reply_drafter.py"].map((f) => [f, read(f)])
  );
  // a virtualenv file with a call site must never be scanned
  fs.mkdirSync(path.join(ws, ".venv/lib"), { recursive: true });
  fs.writeFileSync(path.join(ws, ".venv/lib/vendored.py"), "llm = ChatGroq()\nllm.invoke(x)\n");

  try {
    host.activate();
    await host.openView();
    const ready = host.waitFor("catalog/updated", () => true, 20000);
    await host.send({ version: 1, type: "webview/ready", payload: {} });
    const catalog = (await ready).payload;
    assert.equal(catalog.isOffline, true);
    step(`temp workspace ${path.basename(ws)}; offline catalog with ${catalog.strategies.length} techniques`);

    // 1. export
    const exported = host.waitFor("implement/exported", (m) => m.payload.operationId === "exp");
    await host.send({ version: 1, type: "implement/export", payload: { operationId: "exp", techniqueIds: TECHS } });
    const ex = (await exported).payload;
    assert.equal(ex.targetDir, "ai_optimizer");
    for (const f of ["__init__.py", "techniques.py", "router.py", "middleware.py", "catalog_techniques.json", "router_config.json"]) {
      assert.ok(fs.existsSync(path.join(ws, "ai_optimizer", f)), `ai_optimizer/${f} must exist`);
      assert.ok(ex.filesWritten.includes(`ai_optimizer/${f}`), `filesWritten lists ${f}`);
    }
    const techJson = JSON.parse(read("ai_optimizer/catalog_techniques.json"));
    assert.deepEqual(techJson.selected, ["whitespace-normalize", "filler-removal"], "llm techniques are not exported");
    assert.ok(techJson.techniques.every((t) => t.mode === "rule"));
    const routerJson = JSON.parse(read("ai_optimizer/router_config.json"));
    assert.equal(routerJson.presetId, "default");
    assert.deepEqual(host.appliedEdits.at(-1), { creates: ex.filesWritten.length, textEdits: 0 });
    step(`export -> ${ex.filesWritten.length} files in ai_optimizer/ via one WorkspaceEdit; selected=${techJson.selected.join(",")}`);

    // 2. scan
    const scanned = host.waitFor("implement/proposals", (m) => m.payload.operationId === "scan1");
    await host.send({
      version: 1,
      type: "implement/scan",
      payload: { operationId: "scan1", features: ["optimizer"], techniqueIds: TECHS },
    });
    const { proposals, filesScanned } = (await scanned).payload;
    assert.equal(filesScanned, 4, "main, reply_drafter, summarizer, support_agent (no .venv, no ai_optimizer)");
    assert.deepEqual(
      proposals.map((p) => `${p.pattern}@${p.file}`),
      ["invoke@reply_drafter.py", "invoke@summarizer.py", "invoke@summarizer.py", "agent@support_agent.py"]
    );
    const [drafter, summarize, classify, agent] = proposals;
    step(`scan -> ${proposals.length} proposals in ${filesScanned} files (3 invoke + 1 agent)`);

    // 3. apply one
    const applied = host.waitFor("implement/blockResult", (m) => m.payload.proposalId === summarize.id);
    await host.send({ version: 1, type: "implement/applyBlock", payload: { proposalId: summarize.id } });
    const r1 = (await applied).payload;
    assert.equal(r1.status, "applied", r1.message);
    const expected = original["summarizer.py"]
      .replace("from langchain_groq import ChatGroq\n", "from langchain_groq import ChatGroq\nfrom ai_optimizer import optimize_messages\n")
      .replace("return llm.invoke(prompt).content", `return llm.invoke(optimize_messages(prompt, ${L})).content`);
    assert.equal(read("summarizer.py"), expected, "summarizer.py on disk = block + import");
    assert.deepEqual(host.appliedEdits.at(-1), { creates: 0, textEdits: 2 });
    // The other block of the file is rebased one line down (the import), and the UI is told so.
    assert.deepEqual(r1.rebased, [
      { proposalId: classify.id, range: { ...classify.range, startLine: classify.range.startLine + 1, endLine: classify.range.endLine + 1 } },
    ]);
    step(`apply ${summarize.id} -> "${r1.message}"; file text asserted (block + import, saved); ${classify.id} rebased +1 line`);

    // 4. skip one
    const skipped = host.waitFor("implement/blockResult", (m) => m.payload.proposalId === classify.id);
    await host.send({ version: 1, type: "implement/skipBlock", payload: { proposalId: classify.id } });
    assert.equal((await skipped).payload.status, "skipped");
    assert.equal(read("summarizer.py"), expected, "skip leaves the file unchanged");
    step(`skip ${classify.id} -> skipped; file unchanged`);

    // 5. user edit, then apply a third block -> stale + re-scan
    host.setDocumentText(
      "support_agent.py",
      original["support_agent.py"].replace("\nagent = create_agent(", "\n# tweaked by the user\nagent = create_agent(")
    );
    const stale = host.waitFor("implement/blockResult", (m) => m.payload.proposalId === agent.id);
    const rescanned = host.waitFor("implement/proposals", (m) => /^rescan-/.test(m.payload.operationId || ""));
    await host.send({ version: 1, type: "implement/applyBlock", payload: { proposalId: agent.id } });
    const r3 = (await stale).payload;
    assert.equal(r3.status, "stale", `expected stale, got ${r3.status}`);
    const fresh = (await rescanned).payload.proposals;
    assert.deepEqual(
      fresh.map((p) => `${p.pattern}@${p.file}:${p.range.startLine + 1}`),
      ["invoke@reply_drafter.py:19", "invoke@summarizer.py:32", "agent@support_agent.py:23"],
      "re-scan: applied site gone, classify one line lower, agent one line lower"
    );
    assert.equal(read("support_agent.py"), original["support_agent.py"], "stale apply wrote nothing");
    step(`edit support_agent.py + apply ${agent.id} -> stale ("${r3.message}"); re-scan sent ${fresh.length} proposals`);

    // 6. diff + apply the multi-line block + undo
    const freshDrafter = fresh[0];
    assert.equal(freshDrafter.id, drafter.id);
    const diffOpened = host.waitFor("implement/blockResult", (m) => m.payload.status === "diff-opened");
    await host.send({ version: 1, type: "implement/openDiff", payload: { proposalId: freshDrafter.id } });
    await diffOpened;
    const diff = host.diffs.at(-1);
    assert.ok(diff && diff.rightText.includes(`optimize_messages([`) && diff.rightText.includes("from ai_optimizer import optimize_messages"));
    assert.equal(diff.leftText.replace(/\r\n/g, "\n"), original["reply_drafter.py"]);
    const appliedDrafter = host.waitFor(
      "implement/blockResult",
      (m) => m.payload.proposalId === freshDrafter.id && m.payload.status !== "diff-opened"
    );
    await host.send({ version: 1, type: "implement/applyBlock", payload: { proposalId: freshDrafter.id } });
    assert.equal((await appliedDrafter).payload.status, "applied");
    assert.equal(read("reply_drafter.py"), diff.rightText.replace(/\r\n/g, "\n"), "applied text = diff preview");
    assert.ok(host.undo(), "undo stack has the apply");
    assert.equal(host.documentText("reply_drafter.py").replace(/\r\n/g, "\n"), original["reply_drafter.py"]);
    step("open diff (vscode.diff on virtual doc) -> apply multi-line stream block = preview -> undo restores the file");
  } finally {
    host.deactivate();
  }
}

module.exports = { description, run };
