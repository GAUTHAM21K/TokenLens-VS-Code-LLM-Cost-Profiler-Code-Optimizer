/**
 * Migration 011: model tiers + catalog schemaVersion 2.0.
 * - Every model must carry a `tier` (router input); missing tiers default to "standard"
 * - Providers without `adapterType` default to "openai-compatible" (the extension now builds its
 *   adapter map from the catalog, e.g. Groq)
 * - Indexes models.tier; bumps catalog_meta.schemaVersion to "2.0"
 * - Idempotent
 *
 * Exports: up
 * Feature: catalog (providers/models, model router)
 */
import type { Db } from "mongodb";

export async function up(db: Db): Promise<void> {
  await db
    .collection("models")
    .updateMany({ tier: { $exists: false } }, { $set: { tier: "standard" } });
  await db.collection("models").createIndex({ tier: 1 }, { background: true });

  await db
    .collection("providers")
    .updateMany({ adapterType: { $exists: false } }, { $set: { adapterType: "openai-compatible" } });

  await db.collection("catalog_meta").updateMany({}, { $set: { schemaVersion: "2.0" } });
}
