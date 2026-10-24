/**
 * Scenario `estimate-flow` (Gate A): seeded finalized profile (ts-rag-chatbot) with the bundled
 * catalog (API down). webview/ready hydrates the latest profile (enhance/versionLoaded) ->
 * estimate/request -> estimate/result -> strategy/evaluate -> strategy/selection (applicable
 * techniques pre-selected with reasons) + strategy/savingsUpdate -> strategy/set -> selection and
 * savings recomputed. Also checks enhance/prefill answers a WorkspaceScanner draft (repo root).
 *
 * Exports: description, run
 * Feature: token cost estimator (Enhance hydration, techniques savings)
 */
const description = "seeded profile -> estimate -> evaluate techniques -> set selection -> savings update";

async function run(ctx) {
  const { createHost, assert, step, closedPort } = ctx;
  const port = await closedPort();
  const host = createHost({ seedProfile: true, config: { catalogApiUrl: `http://127.0.0.1:${port}/v1` } });
  host.activate();
  await host.openView();

  // Request/response helper: arm the waiters before sending.
  async function exchange(msg, ...types) {
    const waits = types.map((t) => host.waitFor(t, () => true, 20000));
    const err = host.waitFor("strategy/error", () => true, 20000).catch(() => null);
    await host.send(msg);
    const got = await Promise.race([Promise.all(waits), err.then((e) => e && Promise.reject(new Error(`strategy/error: ${e.payload.message}`)))]);
    return got;
  }

  const [catalog, hydrated] = await exchange(
    { version: 1, type: "webview/ready", payload: {} },
    "catalog/updated",
    "enhance/versionLoaded"
  );
  assert.equal(catalog.payload.isOffline, true);
  assert.equal(hydrated.payload.entry.version, 1);
  assert.ok(hydrated.payload.entry.profile.finalizedAt, "hydrated profile should be the finalized one");
  step(`webview/ready: catalog (${catalog.payload.strategies.length} techniques, offline) + latest profile v1 hydrated`);

  const [estimate] = await exchange(
    { version: 1, type: "estimate/request", payload: { profileVersion: 1 } },
    "estimate/result"
  );
  const r = estimate.payload.result;
  assert.ok(r.runtime.phases.length > 0, "estimate must have runtime phases");
  const models = Object.keys(r.runtime.totalByModel);
  assert.ok(models.length > 0, "estimate must price at least one model");
  step(`estimate/result: ${r.build.phases.length} build + ${r.runtime.phases.length} runtime phases, ${models.length} models`);

  const [sel, sav] = await exchange(
    { version: 1, type: "strategy/evaluate", payload: { profileVersion: 1 } },
    "strategy/selection",
    "strategy/savingsUpdate"
  );
  const ids = sel.payload.selected.map((s) => s.strategyId);
  for (const id of ["cache-prefix-ordering", "filler-removal", "caveman-output"]) {
    assert.ok(ids.includes(id), `${id} should be pre-selected, got ${ids.join(",")}`);
  }
  const cache = sel.payload.selected.find((s) => s.strategyId === "cache-prefix-ordering");
  assert.equal(cache.reason, "Shared prefix of 1500 tokens qualifies for prompt caching.");
  assert.ok(sel.payload.selected.every((s) => s.reason.length > 0), "every pre-selection needs a reason");
  const all = sav.payload.runtime;
  // Input and output techniques no longer compound together (all 7 used to show 96.5%).
  assert.ok(all.maxPercent > 0 && all.maxPercent < 90, `runtime savings ${all.minPercent}-${all.maxPercent}`);
  step(`strategy/evaluate: ${ids.length} pre-selected with reasons; runtime savings ${all.minPercent}–${all.maxPercent}%`);

  const [sel2, sav2] = await exchange(
    { version: 1, type: "strategy/set", payload: { selectedIds: ["caveman-output", "max-output-cap"] } },
    "strategy/selection",
    "strategy/savingsUpdate"
  );
  assert.deepEqual(sel2.payload.selected.map((s) => s.strategyId), ["caveman-output", "max-output-cap"]);
  assert.ok(sel2.payload.notPreselected.some((s) => s.strategyId === "cache-prefix-ordering"));
  const two = sav2.payload.runtime;
  // Both techniques affect output only: they compound on output spend (20–76%) and leave input alone.
  const out2 = sav2.payload.channels.runtime.output;
  assert.deepEqual([out2.minPercent, out2.maxPercent], [20, 76]);
  assert.equal(sav2.payload.channels.runtime.input.maxPercent, 0);
  assert.ok(two.maxPercent > 0 && two.maxPercent < 76, `total ${two.maxPercent}`);
  assert.equal(sav2.payload.build.maxPercent, 0);
  step(
    `strategy/set [caveman-output, max-output-cap]: output savings 20–76%, input 0%, ` +
      `total runtime ${two.minPercent}–${two.maxPercent}%`
  );

  const [again] = await exchange(
    { version: 1, type: "strategy/evaluate", payload: { profileVersion: 1 } },
    "strategy/selection"
  );
  assert.equal(again.payload.selected.length, 2, "re-evaluate keeps the user's selection");
  step("strategy/evaluate again keeps the user's selection");

  const [prefill] = await exchange(
    { version: 1, type: "enhance/prefill", payload: { operationId: "p1" } },
    "enhance/prefillResult"
  );
  assert.equal(prefill.payload.operationId, "p1");
  assert.ok(prefill.payload.description.length > 0 && prefill.payload.signals.length > 0);
  step(`enhance/prefill: draft of ${prefill.payload.description.length} chars, signals: ${prefill.payload.signals.length}`);

  host.deactivate();
}

module.exports = { description, run };
