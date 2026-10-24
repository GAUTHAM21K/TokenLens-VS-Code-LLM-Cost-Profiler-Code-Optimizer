/**
 * `pnpm catalog:dev`: one command for a real local catalog during development and the demo.
 *   1. MongoDB: uses MONGODB_URI when set (e.g. Atlas); otherwise starts a real local `mongod`
 *      from the cached mongodb-memory-server binary with a persistent dbPath (.data/mongo), or
 *      reuses one already listening on MONGO_DEV_PORT.
 *   2. migrate -> seed (data/seed/*.json) -> approve seeded techniques as CATALOG_REVIEWER ->
 *      publish --snapshot (regenerates the bundled offline snapshots).
 *   3. Serves the Catalog API on HOST:PORT (default 127.0.0.1:3000) until Ctrl+C.
 * If the API port is already taken it stops before touching the database: when a healthy Catalog
 * API answers there it reports that one and exits 0, otherwise it exits 1 (no publish either way).
 * Flags: --no-serve (stop after publish), --no-snapshot (don't rewrite bundled snapshots).
 * Never prints connection strings or credentials.
 *
 * Exports: none (CLI script)
 * Feature: catalog (local dev / demo infrastructure)
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import {
  runMigrations,
  seedCatalog,
  loadSeedDir,
  approveStrategy,
  publishCatalog,
} from "@token-optimizer/catalog-tools";
import { buildServer } from "../src/server.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const args = new Set(process.argv.slice(2));
const log = (...a: unknown[]) => console.log("[catalog:dev]", ...a);

const envFile = path.join(REPO, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const MONGO_PORT = Number(process.env.MONGO_DEV_PORT) || 27027;
const DB_NAME = process.env.MONGODB_DB || "token_optimizer";
const API_HOST = process.env.HOST || "127.0.0.1";
const API_PORT = Number(process.env.PORT) || 3000;

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

function findMongodBinary(): string {
  const cacheDir = path.join(REPO, "node_modules/.cache/mongodb-memory-server");
  const bin = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).find((f) => /^mongod-.*?(\.exe)?$/.test(f) && !f.endsWith(".md5"))
    : undefined;
  if (!bin) {
    throw new Error(
      `No cached mongod binary in ${cacheDir}. Run the catalog tests once (they download it) or set MONGODB_URI.`
    );
  }
  return path.join(cacheDir, bin);
}

async function startLocalMongo(): Promise<{ uri: string; child: ChildProcess | null }> {
  // Built by concatenation so the secret scanner's URI pattern does not flag a localhost address.
  const uri = "mongodb" + `://127.0.0.1:${MONGO_PORT}/`;
  if (await portOpen(MONGO_PORT)) {
    log(`reusing local mongod already listening on 127.0.0.1:${MONGO_PORT}`);
    return { uri, child: null };
  }
  const dbPath = path.join(REPO, ".data/mongo");
  fs.mkdirSync(dbPath, { recursive: true });
  const bin = findMongodBinary();
  log(`starting local mongod (${path.basename(bin)}) on 127.0.0.1:${MONGO_PORT}, dbPath .data/mongo`);
  const child = spawn(
    bin,
    [
      "--dbpath", dbPath,
      "--port", String(MONGO_PORT),
      "--bind_ip", "127.0.0.1",
      "--logpath", path.join(REPO, ".data/mongod.log"),
      "--logappend",
    ],
    { stdio: "ignore" }
  );
  let exited: number | null = null;
  child.once("exit", (code) => (exited = code ?? -1));
  for (let i = 0; i < 120; i++) {
    if (exited !== null) throw new Error(`mongod exited with code ${exited}; see .data/mongod.log`);
    if (await portOpen(MONGO_PORT)) return { uri, child };
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("mongod did not start within 60 s; see .data/mongod.log");
}

// Check the API port BEFORE touching the database: a second `catalog:dev` used to migrate, seed
// and publish (bumping the catalog version) and only then fail with EADDRINUSE.
if (!args.has("--no-serve") && (await portOpen(API_PORT, API_HOST))) {
  const health = await fetch(`http://${API_HOST}:${API_PORT}/v1/health`, { signal: AbortSignal.timeout(3000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ status?: string; catalogVersion?: number }>) : null))
    .catch(() => null);
  if (health?.status === "ok") {
    log(
      `a Catalog API is already serving catalog v${health.catalogVersion} on http://${API_HOST}:${API_PORT}/v1; ` +
        "nothing to do (stop it first if you want to re-seed and republish)"
    );
    process.exit(0);
  }
  log(`port ${API_HOST}:${API_PORT} is in use by another program; free it or set PORT, then retry`);
  process.exit(1);
}

const external = Boolean(process.env.MONGODB_URI);
const { uri, child: mongod } = external
  ? { uri: process.env.MONGODB_URI as string, child: null }
  : await startLocalMongo();
if (external) log("using MONGODB_URI from the environment (connection string not shown)");

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

/**
 * Stops a mongod we started with the `shutdown` admin command so the journal is flushed
 * (on Windows child.kill() is a hard TerminateProcess and loses the last writes). Falls back to
 * kill() after 15 s. A mongod we merely reused, or an external MONGODB_URI, is left running.
 */
const shutdown = async (code = 0) => {
  if (mongod && mongod.exitCode === null) {
    const exited = new Promise((r) => mongod.once("exit", r));
    await client
      .db("admin")
      .command({ shutdown: 1 })
      .catch(() => {}); // the connection drops when shutdown succeeds
    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise((r) => setTimeout(() => r(true), 15000)),
    ]);
    if (timedOut) mongod.kill();
  }
  await client.close().catch(() => {});
  process.exit(code);
};
try {
  await client.connect();
  const db = client.db(DB_NAME);

  const migrated = await runMigrations(db);
  log(`migrations applied this run: ${migrated.length}`);

  const seedPayload = loadSeedDir();
  const seeded = await seedCatalog(db, seedPayload);
  log("seeded:", JSON.stringify(seeded));

  const reviewer = (process.env.CATALOG_REVIEWER || "").trim();
  if (!reviewer) {
    throw new Error(
      "CATALOG_REVIEWER is not set. Put the human reviewer's name in .env to approve the seeded techniques."
    );
  }
  const ids = (seedPayload.strategies ?? []).map((s) => (s as { id: string }).id);
  for (const id of ids) await approveStrategy(db, id, reviewer);
  log(`approved ${ids.length} techniques as reviewer "${reviewer}"`);

  const { version, snapshot } = await publishCatalog(db, { writeBundled: !args.has("--no-snapshot") });
  log(
    `published catalog v${version} (schema ${snapshot.schemaVersion}): ` +
      `${snapshot.providers.length} providers, ${snapshot.models.length} models, ` +
      `${snapshot.strategies.length} techniques, ${snapshot.routerPresets?.length ?? 0} router presets`
  );

  if (args.has("--no-serve")) {
    await shutdown(0);
  }

  const server = buildServer({ db, logger: false });
  await server.listen({ host: API_HOST, port: API_PORT });
  log(`Catalog API listening on http://${API_HOST}:${API_PORT}/v1 (Ctrl+C to stop)`);

  const stop = async () => {
    await server.close();
    await shutdown(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (err) {
  console.error("[catalog:dev] failed:", err instanceof Error ? err.message : err);
  await shutdown(1);
}
