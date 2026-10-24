/**
 * Validates and upserts catalog seed data into MongoDB. Seed data lives in one JSON file per
 * collection under catalog-tools/data/seed/<collection>.json. Strategies are always written as
 * `draft` (Principle VIII); approval happens through review.ts.
 *
 * Pricing rows must already be effective (`effectiveFrom` <= seed/publish time), and the seed's rows
 * replace any other stored rows for the same model.
 *
 * Exports: seedCatalog, loadSeedDir, findFutureDatedPricing, DEFAULT_SEED_DIR, SEED_COLLECTION_FILES,
 *   SeedPayload, SeedResult
 * Feature: catalog
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, type Db } from "mongodb";
import { loadEnv } from "./env.js";
import {
  ModelSchema,
  PricingSchema,
  ProviderSchema,
  PhaseSchema,
  StrategySchema,
  PlatformSchema,
  PromptTemplateSchema,
  RouterPresetSchema,
  CatalogMetaSchema,
} from "@token-optimizer/core";

export interface SeedPayload {
  meta?: unknown;
  providers?: unknown[];
  models?: unknown[];
  pricing?: unknown[];
  phases?: unknown[];
  strategies?: unknown[];
  platforms?: unknown[];
  promptTemplates?: unknown[];
  routerPresets?: unknown[];
}

/** Payload key -> seed file name (data/seed/<file>). */
export const SEED_COLLECTION_FILES: Record<keyof SeedPayload, string> = {
  meta: "meta.json",
  providers: "providers.json",
  models: "models.json",
  pricing: "pricing.json",
  phases: "phases.json",
  strategies: "strategies.json",
  platforms: "platforms.json",
  promptTemplates: "promptTemplates.json",
  routerPresets: "routerPresets.json",
};

export const DEFAULT_SEED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../data/seed"
);

/** Reads every per-collection seed file present in `dir` into one SeedPayload. */
export function loadSeedDir(dir: string = DEFAULT_SEED_DIR): SeedPayload {
  const payload: Record<string, unknown> = {};
  for (const [key, file] of Object.entries(SEED_COLLECTION_FILES)) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) payload[key] = JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  return payload as SeedPayload;
}

/**
 * Returns a description of every pricing row whose `effectiveFrom` is later than `atIso`. Such a
 * row is invisible to the estimator (it prices "as of" the catalog's publishedAt), so seed and
 * publish both reject it.
 */
export function findFutureDatedPricing(
  pricing: ReadonlyArray<Record<string, unknown>>,
  atIso: string
): string[] {
  const at = Date.parse(atIso);
  return pricing
    .filter((p) => typeof p.effectiveFrom === "string" && Date.parse(p.effectiveFrom) > at)
    .map((p) => `${String(p.modelId)} (effectiveFrom ${String(p.effectiveFrom)})`);
}

export interface SeedResult {
  modelsCount: number;
  pricingCount: number;
  providersCount: number;
  phasesCount: number;
  strategiesCount: number;
  platformsCount: number;
  promptTemplatesCount: number;
  routerPresetsCount: number;
}

export async function seedCatalog(db: Db, rawData: SeedPayload): Promise<SeedResult> {
  const result: SeedResult = {
    modelsCount: 0,
    pricingCount: 0,
    providersCount: 0,
    phasesCount: 0,
    strategiesCount: 0,
    platformsCount: 0,
    promptTemplatesCount: 0,
    routerPresetsCount: 0,
  };

  // 1. Validate & Seed Providers
  if (Array.isArray(rawData.providers)) {
    const col = db.collection("providers");
    for (const item of rawData.providers) {
      const parsed = ProviderSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.providersCount++;
    }
  }

  // 2. Validate & Seed Models
  if (Array.isArray(rawData.models)) {
    const col = db.collection("models");
    for (const item of rawData.models) {
      const parsed = ModelSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.modelsCount++;
    }
  }

  // 3. Validate & Seed Pricing (Principle VII Auditability Check)
  if (Array.isArray(rawData.pricing)) {
    const col = db.collection("pricing");
    const future = findFutureDatedPricing(
      rawData.pricing as Array<Record<string, unknown>>,
      new Date().toISOString()
    );
    if (future.length > 0) {
      throw new Error(`Pricing effectiveFrom is later than the seed time: ${future.join(", ")}`);
    }
    // The seed file is the source of truth for a model's pricing: drop stored rows it no longer has.
    const seededDates = new Map<string, string[]>();
    for (const item of rawData.pricing as Array<Record<string, unknown>>) {
      const id = String(item.modelId);
      seededDates.set(id, [...(seededDates.get(id) ?? []), String(item.effectiveFrom)]);
    }
    for (const [modelId, dates] of seededDates) {
      await col.deleteMany({ modelId, effectiveFrom: { $nin: dates } });
    }
    for (const item of rawData.pricing) {
      const raw = item as Record<string, unknown>;
      if (!raw.sourceUrl || typeof raw.sourceUrl !== "string") {
        throw new Error(
          `Principle VII violation: Pricing row for model '${raw?.modelId}' is missing required 'sourceUrl'`
        );
      }
      if (!raw.verifiedAt || typeof raw.verifiedAt !== "string") {
        throw new Error(
          `Principle VII violation: Pricing row for model '${raw?.modelId}' is missing required 'verifiedAt'`
        );
      }

      const parsed = PricingSchema.parse(item);
      await col.updateOne(
        { modelId: parsed.modelId, effectiveFrom: parsed.effectiveFrom },
        { $set: parsed },
        { upsert: true }
      );
      result.pricingCount++;
    }
  }

  // 4. Validate & Seed Phases
  if (Array.isArray(rawData.phases)) {
    const col = db.collection("phases");
    for (const item of rawData.phases) {
      const parsed = PhaseSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.phasesCount++;
    }
  }

  // 5. Validate & Seed Strategies (Principle VIII: Seeds only ever write reviewStatus: "draft")
  if (Array.isArray(rawData.strategies)) {
    const col = db.collection("strategies");
    for (const item of rawData.strategies) {
      const raw = item as Record<string, unknown>;
      if (raw.reviewStatus === "approved") {
        throw new Error(
          `Principle VIII violation: Seed scripts must only write reviewStatus='draft'. Strategy '${String(raw.id)}' cannot be seeded directly as approved; approval requires the human review workflow.`
        );
      }
      const docToParse = {
        ...raw,
        reviewStatus: "draft" as const,
      };
      const parsed = StrategySchema.parse(docToParse);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.strategiesCount++;
    }
  }

  // 6. Validate & Seed Platforms
  if (Array.isArray(rawData.platforms)) {
    const col = db.collection("platforms");
    for (const item of rawData.platforms) {
      const parsed = PlatformSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.platformsCount++;
    }
  }

  // 7. Validate & Seed Prompt Templates
  if (Array.isArray(rawData.promptTemplates)) {
    const col = db.collection("prompt_templates");
    for (const item of rawData.promptTemplates) {
      const parsed = PromptTemplateSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.promptTemplatesCount++;
    }
  }

  // 8. Router presets (v2, migration 010)
  if (Array.isArray(rawData.routerPresets)) {
    const col = db.collection("router_presets");
    for (const item of rawData.routerPresets) {
      const parsed = RouterPresetSchema.parse(item);
      await col.updateOne({ id: parsed.id }, { $set: parsed }, { upsert: true });
      result.routerPresetsCount++;
    }
  }

  // 9. Meta
  if (rawData.meta) {
    const col = db.collection("catalog_meta");
    const parsed = CatalogMetaSchema.parse(rawData.meta);
    // Exactly one meta doc: keep the published version counter, only adopt the seed schemaVersion.
    const existing = await col.findOne({});
    if (existing) {
      await col.updateOne({ _id: existing._id }, { $set: { schemaVersion: parsed.schemaVersion } });
    } else {
      await col.insertOne({ ...parsed });
    }
  }

  return result;
}

// CLI entry point: tsx seed.ts [--file <payload.json> | --dir <seed-dir>]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let filePath = "";
  let dirPath = DEFAULT_SEED_DIR;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      filePath = args[++i];
    } else if (args[i] === "--dir" && args[i + 1]) {
      dirPath = args[++i];
    }
  }

  loadEnv();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("Error: MONGODB_URI environment variable is required.");
    process.exit(1);
  }

  const raw: SeedPayload = filePath
    ? JSON.parse(fs.readFileSync(filePath, "utf-8"))
    : loadSeedDir(dirPath);
  const client = new MongoClient(mongoUri);

  client
    .connect()
    .then(async () => {
      const db = client.db(process.env.MONGODB_DB || "token_optimizer");
      console.log(`Seeding catalog from ${filePath || dirPath}...`);
      const res = await seedCatalog(db, raw);
      console.log("Seeding completed successfully:", res);
    })
    .then(() => client.close())
    .catch((err) => {
      console.error("Seeding failed:", err);
      client.close().finally(() => process.exit(1));
    });
}
