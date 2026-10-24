/**
 * Validates catalog collections against the Zod schemas and reports problems.
 *
 * Exports: ValidationItemResult, ValidationSummary, validateCatalog
 * Feature: catalog
 */
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { MongoClient, type Db } from "mongodb";
import { loadEnv } from "./env.js";
import {
  ProviderSchema,
  ModelSchema,
  PricingSchema,
  PhaseSchema,
  StrategySchema,
  PlatformSchema,
  PromptTemplateSchema,
  CatalogMetaSchema,
} from "@token-optimizer/core";
import type { ZodSchema } from "zod";

export interface ValidationItemResult {
  collection: string;
  id: string;
  status: "PASS" | "FAIL";
  errors?: string[];
}

export interface ValidationSummary {
  valid: boolean;
  passed: number;
  failed: number;
  items: ValidationItemResult[];
}

const COLLECTION_SCHEMAS: Array<{ name: string; schema: ZodSchema; idField: string }> = [
  { name: "providers", schema: ProviderSchema, idField: "id" },
  { name: "models", schema: ModelSchema, idField: "id" },
  { name: "pricing", schema: PricingSchema, idField: "modelId" },
  { name: "phases", schema: PhaseSchema, idField: "id" },
  { name: "strategies", schema: StrategySchema, idField: "id" },
  { name: "platforms", schema: PlatformSchema, idField: "id" },
  { name: "prompt_templates", schema: PromptTemplateSchema, idField: "id" },
  { name: "catalog_meta", schema: CatalogMetaSchema, idField: "version" },
];

export async function validateCatalog(db: Db): Promise<ValidationSummary> {
  const items: ValidationItemResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const { name, schema, idField } of COLLECTION_SCHEMAS) {
    const col = db.collection(name);
    const docs = await col.find({}).toArray();

    for (const doc of docs) {
      // Remove mongodb internal _id before zod parsing
      const { _id, ...cleanDoc } = doc;
      const itemId = String(cleanDoc[idField] ?? _id);

      const parseResult = schema.safeParse(cleanDoc);
      if (parseResult.success) {
        passed++;
        items.push({
          collection: name,
          id: itemId,
          status: "PASS",
        });
      } else {
        failed++;
        const errors = parseResult.error.errors.map(
          (e: { path: (string | number)[]; message: string }) => `${e.path.join(".") || "(root)"}: ${e.message}`
        );
        items.push({
          collection: name,
          id: itemId,
          status: "FAIL",
          errors,
        });
      }
    }
  }

  return {
    valid: failed === 0,
    passed,
    failed,
    items,
  };
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  loadEnv();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("Error: MONGODB_URI environment variable is required.");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  client
    .connect()
    .then(async () => {
      const db = client.db(process.env.MONGODB_DB || "token_optimizer");
      console.log("Validating catalog against Zod schemas...");
      const summary = await validateCatalog(db);

      for (const item of summary.items) {
        if (item.status === "PASS") {
          console.log(`[PASS] ${item.collection}/${item.id}`);
        } else {
          console.error(`[FAIL] ${item.collection}/${item.id}`);
          for (const err of item.errors ?? []) {
            console.error(`       - ${err}`);
          }
        }
      }

      console.log(`\nValidation complete: ${summary.passed} PASSED, ${summary.failed} FAILED.`);
      if (!summary.valid) {
        process.exit(1);
      }
    })
    .then(() => client.close())
    .catch((err) => {
      console.error("Validation failed with error:", err);
      client.close().finally(() => process.exit(1));
    });
}
