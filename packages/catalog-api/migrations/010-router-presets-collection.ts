/**
 * Migration 010: router_presets collection for the rule-based model router.
 * - Creates `router_presets` with a $jsonSchema validator (tiers economy|standard|advanced + rules)
 * - Unique index on id; index on isDefault
 * - Idempotent (data comes from seed/routerPresets.json)
 *
 * Exports: up
 * Feature: model router
 */
import type { Db } from "mongodb";

export async function up(db: Db): Promise<void> {
  const exists = (await db.listCollections({ name: "router_presets" }).toArray()).length > 0;
  if (!exists) {
    await db
      .createCollection("router_presets", {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["id", "label", "isDefault", "version", "tiers", "rules"],
            properties: {
              id: { bsonType: "string" },
              isDefault: { bsonType: "bool" },
              tiers: {
                bsonType: "object",
                required: ["economy", "standard", "advanced"],
              },
              rules: {
                bsonType: "object",
                required: [
                  "maxCharsForEconomy",
                  "advancedKeywords",
                  "needsToolsMinTier",
                  "defaultTier",
                ],
              },
            },
          },
        },
      })
      .catch(() => db.createCollection("router_presets").catch(() => {}));
  }

  const col = db.collection("router_presets");
  await col.createIndex({ id: 1 }, { unique: true, background: true });
  await col.createIndex({ isDefault: 1 }, { background: true });
}
