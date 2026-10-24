/**
 * Migration 008: creates the single catalog_meta document used for versioning and ETags.
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 008: Catalog Meta Versioning
 * - Creates catalog_meta collection
 * - Inserts initial { version: 1, publishedAt: now, schemaVersion: "1.0" } if absent
 * - Ensures exactly one document in catalog_meta
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("catalog_meta");

  const count = await collection.countDocuments({});
  if (count === 0) {
    await collection.insertOne({
      version: 1,
      publishedAt: new Date().toISOString(),
      schemaVersion: "1.0",
    });
  }

  await collection.createIndex({ version: 1 }, { unique: true, background: true });
}
