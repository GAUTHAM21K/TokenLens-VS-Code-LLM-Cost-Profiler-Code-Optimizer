/**
 * Scenario `catalog-delivery` (Gate 0): a panel opened after activation still receives the
 * catalog. For "API up" and "API down" it activates the host, waits, opens the view late, sends
 * webview/ready and asserts catalog/updated arrives with the provider list (incl. Groq), router
 * presets and the correct isOffline flag; then catalog/request must re-send it.
 * API up = --api-url <url> (e.g. the real `pnpm catalog:dev` API) or an in-process stub.
 *
 * Exports: description, run
 * Feature: catalog (delivery to webview)
 */
const description = "late-opened panel gets catalog (Groq + presets) with correct offline flag, API up and down";

async function checkCase(ctx, label, catalogApiUrl, expectOffline) {
  const { createHost, assert, step, sleep } = ctx;
  const host = createHost({ config: { catalogApiUrl } });
  host.activate();
  step(`${label}: activated with catalogApiUrl=${catalogApiUrl}; panel not open yet`);

  // Let catalog initialization finish while no webview exists (the original race).
  await sleep(1500);
  await host.openView();
  const delivered = host.waitFor("catalog/updated", () => true, 30000);
  await host.send({ version: 1, type: "webview/ready", payload: {} });
  const msg = await delivered;
  const p = msg.payload;
  step(`${label}: catalog/updated after webview/ready (${p.providers.length} providers, isOffline=${p.isOffline})`);

  const ids = p.providers.map((x) => x.id);
  assert.ok(ids.includes("groq"), `provider list must include groq, got ${ids.join(",")}`);
  assert.ok(p.models.some((m) => m.providerId === "groq"), "catalog must include Groq models");
  assert.equal(p.isOffline, expectOffline, `isOffline should be ${expectOffline}`);
  assert.ok((p.routerPresets || []).some((r) => r.isDefault), "default router preset must be delivered");
  assert.ok(p.strategies.length > 0 && p.strategies.every((s) => s.optimizer), "techniques must carry optimizer fields");
  step(`${label}: groq present, router preset present, ${p.strategies.length} techniques, offline flag correct`);

  const again = host.waitFor("catalog/updated", () => true, 10000);
  await host.send({ version: 1, type: "catalog/request", payload: {} });
  const second = await again;
  assert.equal(second.payload.isOffline, expectOffline);
  step(`${label}: catalog/request re-sent the catalog`);
  host.deactivate();
}

async function run(ctx) {
  let stub = null;
  let upUrl = ctx.args["api-url"];
  if (!upUrl) {
    stub = await ctx.startStubCatalogApi();
    upUrl = stub.url;
  }
  try {
    await checkCase(ctx, ctx.args["api-url"] ? "API up (real)" : "API up (stub)", upUrl, false);
  } finally {
    if (stub) stub.close();
  }
  const port = await ctx.closedPort();
  await checkCase(ctx, "API down", `http://127.0.0.1:${port}/v1`, true);
}

module.exports = { description, run };
