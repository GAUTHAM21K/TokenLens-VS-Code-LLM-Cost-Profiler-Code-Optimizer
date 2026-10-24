/**
 * Catalog API process entry: loads .env, connects to MongoDB (MONGODB_URI) and starts Fastify.
 *
 * Exports: none
 * Feature: catalog
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { MongoClient, type Db } from "mongodb";
import { buildServer } from "./server.js";

// Load .env if present
const envCandidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
];
for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(envPath);
      } else {
        const content = fs.readFileSync(envPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      }
      break;
    } catch {
      // ignore
    }
  }
}

const mongoUri = process.env.MONGODB_URI;
let db: Db | null = null;
let client: MongoClient | null = null;

if (mongoUri) {
  try {
    client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db(process.env.MONGODB_DB || "token_optimizer");
    console.log("[Catalog API] Connected to MongoDB database:", db.databaseName);
  } catch (err) {
    console.error("[Catalog API] Failed to connect to MongoDB:", err);
    process.exit(1);
  }
} else {
  console.warn(
    "[Catalog API] MONGODB_URI not set. Running with no database."
  );
}

const server = buildServer({ db, logger: true });
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

server.listen({ port, host }, (err, address) => {
  if (err) {
    console.error("Failed to start Catalog API:", err);
    process.exit(1);
  }
  console.log(`Catalog API listening at ${address}`);
});

process.on("SIGINT", async () => {
  await server.close();
  if (client) await client.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  if (client) await client.close();
  process.exit(0);
});
