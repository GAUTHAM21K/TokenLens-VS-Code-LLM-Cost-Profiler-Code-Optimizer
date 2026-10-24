/**
 * `pnpm harness:check <scenario> [--api-url <url>]`: runs a scripted harness scenario from
 * tools/harness/scenarios/<scenario>.cjs against the real built extension host and exits non-zero
 * on the first failed assertion. `pnpm harness:check --list` lists scenarios.
 * A scenario module exports { description, run(ctx) }; ctx = { createHost, assert, step, args,
 * startStubCatalogApi, closedPort, sleep }.
 *
 * Exports: none (CLI)
 * Feature: tooling (host harness; validation gates)
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const assert = require("node:assert/strict");
const { createHost, EXT_DIR } = require("./lib/host.cjs");

const SCENARIOS = path.join(__dirname, "scenarios");
const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith("--"));
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith("--") ? argv[++i] : true;
  }
}

const list = () =>
  fs.readdirSync(SCENARIOS).filter((f) => f.endsWith(".cjs")).map((f) => f.replace(/\.cjs$/, ""));

if (!name || args.list) {
  console.log("Scenarios:");
  for (const s of list()) console.log(`  ${s} - ${require(path.join(SCENARIOS, s + ".cjs")).description}`);
  process.exit(name ? 0 : 2);
}
if (!list().includes(name)) {
  console.error(`Unknown scenario '${name}'. Available: ${list().join(", ")}`);
  process.exit(2);
}

/** Serves the bundled snapshot as a minimal Catalog API (GET /v1/catalog). */
function startStubCatalogApi() {
  const body = fs.readFileSync(path.join(EXT_DIR, "resources/catalog-snapshot.json"), "utf8");
  const server = http.createServer((req, res) => {
    if (req.url.split("?")[0] === "/v1/catalog") {
      res.writeHead(200, { "content-type": "application/json", etag: '"stub-1"' });
      return res.end(body);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })
    )
  );
}

/** A localhost port with nothing listening (connection refused = "API down"). */
function closedPort() {
  return new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let steps = 0;
const step = (msg) => console.log(`  [${++steps}] ${msg}`);

// Keep the extension's own logging out of the report unless asked for.
if (!args.verbose) {
  for (const k of ["log", "info", "debug", "warn"]) console[k] = () => {};
}
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
const ctxStep = (msg) => out(`  [${++steps}] ${msg}`);

(async () => {
  const scenario = require(path.join(SCENARIOS, name + ".cjs"));
  out(`harness:check ${name} - ${scenario.description}`);
  const started = Date.now();
  try {
    await scenario.run({
      createHost,
      assert,
      step: args.verbose ? step : ctxStep,
      args,
      startStubCatalogApi,
      closedPort,
      sleep,
    });
    out(`PASS ${name} (${steps} steps, ${Date.now() - started} ms)`);
    process.exit(0);
  } catch (err) {
    out(`FAIL ${name}: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }
})();
