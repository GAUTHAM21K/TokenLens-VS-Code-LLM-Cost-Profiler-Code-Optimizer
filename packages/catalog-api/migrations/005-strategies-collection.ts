/**
 * Migration 005: creates the strategies collection and migrates legacy optimizer_rules as drafts.
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 005: Strategies Collection & Migration from optimizer_rules
 * - Creates strategies collection if absent
 * - Migrates prototype optimizer_rules to strategies schema
 * - Sets reviewStatus="draft" on all migrated rules (Principle VIII)
 * - Adds indexes on id (unique), reviewStatus, group, targets
 * - Configures JSON schema validation
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collections = await db.listCollections({ name: "strategies" }).toArray();
  if (collections.length === 0) {
    try {
      await db.createCollection("strategies", {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["id", "name", "group", "targets", "summary", "savings", "reviewStatus"],
            properties: {
              id: { bsonType: "string" },
              name: { bsonType: "string" },
              group: { bsonType: "string" },
              targets: { bsonType: "array", items: { enum: ["build", "runtime"] } },
              summary: { bsonType: "string" },
              reviewStatus: { enum: ["draft", "pending", "approved"] },
              reviewedBy: { bsonType: "string" },
              reviewedAt: { bsonType: "string" },
              version: { bsonType: "int" },
            },
            allOf: [
              {
                if: { properties: { reviewStatus: { enum: ["approved"] } } },
                then: { required: ["reviewedBy", "reviewedAt"] },
              },
            ],
          },
        },
      });
    } catch {
      // If collection creation with validator fails or already exists, ensure simple collection exists
      await db.createCollection("strategies").catch(() => {});
    }
  }

  const strategiesCol = db.collection("strategies");
  const rulesCol = db.collection("optimizer_rules");

  const rulesExist = (await db.listCollections({ name: "optimizer_rules" }).toArray()).length > 0;
  if (rulesExist) {
    const cursor = rulesCol.find({});
    while (await cursor.hasNext()) {
      const rule = await cursor.next();
      if (!rule) continue;

      const id = (rule.id || rule.rule_id || "rule-unknown").toString();
      const name = (rule.name || id).toString();

      let group = "prompt-efficiency";
      const cat = (rule.category || "").toLowerCase();
      if (cat.includes("cache")) group = "caching";
      else if (cat.includes("model")) group = "model-strategy";
      else if (cat.includes("batch")) group = "batching";
      else if (cat.includes("build")) group = "build-practices";
      else if (cat.includes("output")) group = "output-control";

      const targets: ("build" | "runtime")[] = ["build", "runtime"];

      const summary = (
        rule.summary ||
        rule.description ||
        `Optimization strategy ${name} targeting LLM token efficiency.`
      ).slice(0, 1000);

      const minPercent = typeof rule.savings_min === "number" ? rule.savings_min : 10;
      const maxPercent = typeof rule.savings_max === "number" ? rule.savings_max : 30;

      const strategyDoc = {
        id,
        name,
        group,
        targets,
        summary,
        applicability: {
          path: "llm.avgPromptTokens",
          gte: 500,
        },
        reasonTemplate: `Project can reduce token consumption using ${name}`,
        preconditions: ["Standard LLM prompt structure"],
        savings: {
          minPercent,
          maxPercent,
          basis: "Empirical reduction from structured prompt compression",
          unit: "percent" as const,
          appliesTo: "input" as const,
        },
        conflicts: [],
        requires: [],
        preview: {
          kind: "tokenizer",
          params: {},
        },
        implementation: {
          overview: summary,
          detection: [
            {
              language: "typescript",
              kind: "regex",
              query: "chat\\.completions\\.create|messages\\.create",
              description: "Detects direct LLM invocation",
            },
          ],
          steps: ["Analyze prompt payload", "Apply optimization strategy", "Validate response"],
          transforms: [],
          applyPrompt: "Optimize token usage according to strategy guidelines.",
          acceptanceCriteria: ["Output quality preserved", "Token usage reduced"],
          verification: { metric: "tokens", method: "tokenizer-count" },
          risks: ["Minimal semantic nuance shift"],
          rollback: "Revert prompt edits to previous version",
        },
        reviewStatus: "draft" as const, // Principle VIII: default to draft
        version: 1,
      };

      await strategiesCol.updateOne(
        { id },
        {
          $setOnInsert: strategyDoc,
        },
        { upsert: true }
      );
    }
  }

  await strategiesCol.createIndex({ id: 1 }, { unique: true, background: true });
  await strategiesCol.createIndex({ reviewStatus: 1 }, { background: true });
  await strategiesCol.createIndex({ group: 1 }, { background: true });
  await strategiesCol.createIndex({ targets: 1 }, { background: true });
}
