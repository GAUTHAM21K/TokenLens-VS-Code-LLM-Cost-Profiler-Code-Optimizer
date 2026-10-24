/**
 * Migration 009: strategies become prompt-optimizer techniques (catalog schemaVersion 2.0).
 * - Extends the strategies $jsonSchema validator with `optimizer` and the tightened `implementation`
 * - Unsets legacy free-form `implementation` docs (pre-v2 shape without `language`)
 * - Indexes optimizer.order for ordered technique loading
 * - Idempotent
 *
 * Exports: up
 * Feature: catalog (prompt optimizer techniques)
 */
import type { Db } from "mongodb";

export async function up(db: Db): Promise<void> {
  const exists = (await db.listCollections({ name: "strategies" }).toArray()).length > 0;
  if (!exists) await db.createCollection("strategies");

  await db
    .command({
      collMod: "strategies",
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["id", "name", "group", "targets", "summary", "savings", "reviewStatus"],
          properties: {
            id: { bsonType: "string" },
            reviewStatus: { enum: ["draft", "pending", "approved"] },
            optimizer: {
              bsonType: "object",
              required: ["mode", "order", "affects"],
              properties: {
                mode: { enum: ["rule", "llm"] },
                affects: { enum: ["input", "output", "both"] },
              },
            },
            implementation: {
              bsonType: "object",
              required: ["language", "symbol", "integrations"],
              properties: { language: { enum: ["python"] } },
            },
          },
          allOf: [
            {
              if: { properties: { reviewStatus: { enum: ["approved"] } } },
              then: { required: ["reviewedBy", "reviewedAt"] },
            },
          ],
        },
      },
      validationLevel: "moderate",
    })
    .catch(() => {
      // collMod unsupported (e.g. restricted Atlas tier): Zod validation in seed/publish still applies.
    });

  await db
    .collection("strategies")
    .updateMany(
      { implementation: { $exists: true }, "implementation.language": { $exists: false } },
      { $unset: { implementation: "" } }
    );

  await db.collection("strategies").createIndex({ "optimizer.order": 1 }, { background: true });
}
