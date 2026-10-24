/**
 * Runs the numbered catalog migrations in packages/catalog-api/migrations. Applied migrations are
 * recorded in the `schema_migrations` collection and skipped on later runs, so a persistent
 * database (catalog:dev, Atlas) can be migrated repeatedly without re-applying old steps.
 *
 * Exports: runMigrations, findMigrationsDir, MIGRATIONS_LEDGER, MigrationOptions
 * Feature: catalog
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";
import { MongoClient, type Db } from "mongodb";
import { loadEnv } from "./env.js";

export interface MigrationOptions {
  from?: number;
  dryRun?: boolean;
  migrationsDir?: string;
  mongoUri?: string;
  dbName?: string;
  /** Re-run migrations even if the ledger says they were applied. */
  force?: boolean;
}

export const MIGRATIONS_LEDGER = "schema_migrations";

export function findMigrationsDir(startDir?: string): string {
  if (startDir && fs.existsSync(startDir)) return startDir;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../../catalog-api/migrations"),
    path.resolve(currentDir, "../../../packages/catalog-api/migrations"),
    path.resolve(process.cwd(), "packages/catalog-api/migrations"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new Error("Could not find catalog-api/migrations directory");
}

export async function runMigrations(
  db: Db | null,
  options: MigrationOptions = {}
): Promise<string[]> {
  const fromStep = options.from ?? 1;
  const isDryRun = Boolean(options.dryRun);
  const migrationsDir = findMigrationsDir(options.migrationsDir);

  const entries = fs.readdirSync(migrationsDir);
  const migrationFiles = entries
    .filter((f) => /^\d{3}-.*\.ts$/.test(f) || /^\d{3}-.*\.js$/.test(f))
    .sort();

  const executed: string[] = [];

  for (const file of migrationFiles) {
    const match = file.match(/^(\d{3})/);
    const stepNumber = match ? parseInt(match[1], 10) : 0;

    if (stepNumber < fromStep) {
      continue;
    }

    if (isDryRun) {
      console.log(`[DRY-RUN] Would execute migration ${file} (Step ${stepNumber})`);
      executed.push(file);
      continue;
    }

    if (!db) {
      throw new Error("Database instance required for non-dry-run migrations");
    }

    const ledger = db.collection(MIGRATIONS_LEDGER);
    if (!options.force && (await ledger.findOne({ file }))) {
      continue;
    }

    console.log(`Executing migration ${file} (Step ${stepNumber})...`);
    const filePath = path.join(migrationsDir, file);
    const mod = await import(pathToFileURL(filePath).href);

    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${file} does not export an up() function`);
    }

    await mod.up(db);
    await ledger.updateOne(
      { file },
      { $set: { file, appliedAt: new Date().toISOString() } },
      { upsert: true }
    );
    console.log(`Completed migration ${file}`);
    executed.push(file);
  }

  return executed;
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let from = 1;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      from = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  loadEnv();
  const mongoUri = process.env.MONGODB_URI;

  if (dryRun) {
    console.log(`[DRY-RUN] Starting migrations from step ${from}...`);
    runMigrations(null, { from, dryRun: true })
      .then((files) => {
        console.log(`[DRY-RUN] Done. ${files.length} migration(s) planned.`);
        process.exit(0);
      })
      .catch((err) => {
        console.error("Migration dry run error:", err);
        process.exit(1);
      });
  } else {
    if (!mongoUri) {
      console.error("Error: MONGODB_URI environment variable is required for running migrations.");
      process.exit(1);
    }

    const client = new MongoClient(mongoUri);
    client
      .connect()
      .then(async () => {
        const db = client.db(process.env.MONGODB_DB || "token_optimizer");
        console.log(`Connected to MongoDB. Running migrations from step ${from}...`);
        const executed = await runMigrations(db, { from, dryRun: false });
        console.log(`Successfully completed ${executed.length} migration(s).`);
      })
      .then(() => client.close())
      .catch((err) => {
        console.error("Migration execution failed:", err);
        client.close().finally(() => process.exit(1));
      });
  }
}
