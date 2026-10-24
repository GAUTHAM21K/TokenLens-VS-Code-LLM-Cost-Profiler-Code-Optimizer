/**
 * Scenario `router-preview` (Gate D): offline catalog, no network. router/getConfig returns the
 * catalog default preset; router/preview routes sample prompts (economy / advanced keyword /
 * needsTools / unsaved UI edits); router/saveConfig persists and getConfig then reports "saved";
 * implement/export writes that saved config as router_config.json, restricted to the user's
 * enabled models.
 *
 * Exports: description, run
 * Feature: model router
 */
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("../lib/host.cjs");

const description = "router config from catalog preset, live route preview, save, export router_config.json";

async function run(ctx) {
  const { createHost, assert, step } = ctx;
  const host = createHost({
    config: { catalogApiUrl: "" },
    tempWorkspaceFrom: path.join(REPO_ROOT, "examples/demo-langchain-app"),
  });
  try {
    // the user enabled only the two GPT-OSS Groq models in Settings
    await host.context.globalState.update("tokenOptimizer.userSetup", {
      enabledModelsByProvider: { groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b"] },
      copilotOnly: false,
    });
    host.activate();
    await host.openView();
    const ready = host.waitFor("catalog/updated", () => true, 20000);
    await host.send({ version: 1, type: "webview/ready", payload: {} });
    await ready;

    const cfgMsg = host.waitFor("router/config");
    await host.send({ version: 1, type: "router/getConfig", payload: {} });
    const { config, source } = (await cfgMsg).payload;
    assert.equal(source, "catalog-default");
    assert.equal(config.presetId, "default");
    step(`getConfig -> catalog-default preset (economy ${config.tiers.economy[0].modelId}, maxChars ${config.rules.maxCharsForEconomy})`);

    const preview = async (id, payload) => {
      const res = host.waitFor("router/previewResult", (m) => m.payload.operationId === id);
      await host.send({ version: 1, type: "router/preview", payload: { operationId: id, ...payload } });
      return (await res).payload.decision;
    };
    const short = await preview("p1", { text: "What is 2+2?" });
    assert.deepEqual([short.tier, short.provider, short.model], ["economy", "groq", "openai/gpt-oss-20b"]);
    const adv = await preview("p2", { text: "Please analyze the architecture trade-offs." });
    assert.equal(adv.tier, "advanced");
    const tools = await preview("p3", { text: "Get the weather.", needsTools: true });
    assert.equal(tools.tier, "standard");
    step(`preview: short -> ${short.model} (${short.reason}); keyword -> ${adv.tier}; tools -> ${tools.tier}`);

    const edited = { ...config, rules: { ...config.rules, maxCharsForEconomy: 5 } };
    const unsaved = await preview("p4", { text: "What is 2+2?", config: edited });
    assert.equal(unsaved.tier, "standard", "unsaved UI config is used for the preview");
    step(`preview with unsaved edit (maxCharsForEconomy=5) -> ${unsaved.tier}: ${unsaved.reason}`);

    const saved = host.waitFor("router/configSaved");
    await host.send({ version: 1, type: "router/saveConfig", payload: { config: edited } });
    assert.deepEqual((await saved).payload.config, edited);
    const again = host.waitFor("router/config");
    await host.send({ version: 1, type: "router/getConfig", payload: {} });
    assert.equal((await again).payload.source, "saved");
    const afterSave = await preview("p5", { text: "What is 2+2?" });
    assert.equal(afterSave.tier, "standard", "saved config is the default for previews");
    step("saveConfig -> configSaved; getConfig -> saved; preview uses the saved rules");

    const exported = host.waitFor("implement/exported", (m) => m.payload.operationId === "exp");
    await host.send({ version: 1, type: "implement/export", payload: { operationId: "exp", techniqueIds: [] } });
    await exported;
    const written = JSON.parse(fs.readFileSync(path.join(host.workspaceDir, "ai_optimizer/router_config.json"), "utf8"));
    assert.equal(written.rules.maxCharsForEconomy, 5, "export uses the saved Router-tab config");
    assert.deepEqual(written.tiers, {
      economy: [{ providerId: "groq", modelId: "openai/gpt-oss-20b" }],
      standard: [{ providerId: "groq", modelId: "openai/gpt-oss-120b" }],
      advanced: [],
    });
    step("export -> ai_optimizer/router_config.json = saved rules, tiers limited to enabled models");

    const err = host.waitFor("router/error", (m) => m.payload.operationId === "bad");
    const empty = { ...config, tiers: { economy: [], standard: [], advanced: [] } };
    await host.send({ version: 1, type: "router/preview", payload: { operationId: "bad", text: "x", config: empty } });
    assert.equal((await err).payload.error, "invalid-request");
    step("preview with no candidates -> router/error invalid-request");
  } finally {
    host.deactivate();
  }
}

module.exports = { description, run };
