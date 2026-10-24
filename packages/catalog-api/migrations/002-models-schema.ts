/**
 * Migration 002: normalizes model documents (canonical ids, context window, tier, tokenizer).
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 002: Models Schema Normalization
 * - Adds canonical `id`, `providerId`, `label`, `contextWindow`, `maxOutput`, `tier`,
 *   `supportsCaching`, `supportsBatch`, `supportsStructuredOutput`, `tokenizer`, `status`, `addedAt`
 * - Retains `model_id`, `provider`, `display_name` as aliases
 * - Creates compound index on `{ id: 1, providerId: 1 }`
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("models");

  const cursor = collection.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    const id = doc.id || doc.model_id;
    const providerId = doc.providerId || doc.provider;
    const label = doc.label || doc.display_name || id;
    const contextWindow = doc.contextWindow || doc.context_window || 128000;
    const maxOutput = doc.maxOutput || 4096;

    let tier: "economy" | "standard" | "advanced" | "frontier" = doc.tier || "standard";
    if (doc.complexity_tier === "simple" || id.includes("mini") || id.includes("flash")) {
      tier = "economy";
    } else if (doc.complexity_tier === "complex" || id.includes("opus") || id.includes("o1")) {
      tier = "frontier";
    } else if (id.includes("sonnet") || id.includes("pro")) {
      tier = "advanced";
    }

    const pricing = doc.pricing || {};
    const supportsCaching =
      typeof doc.supportsCaching === "boolean"
        ? doc.supportsCaching
        : Boolean(pricing.cached_input_per_1m || pricing.cachedInputPerMTok);

    const supportsBatch =
      typeof doc.supportsBatch === "boolean"
        ? doc.supportsBatch
        : Boolean(pricing.batch_input_per_1m || pricing.batchDiscount);

    const supportsStructuredOutput =
      typeof doc.supportsStructuredOutput === "boolean" ? doc.supportsStructuredOutput : true;

    let tokenizerKind: "tiktoken" | "anthropic-endpoint" | "google-endpoint" | "char-approx" =
      doc.tokenizer?.kind || "char-approx";
    if (providerId === "openai") tokenizerKind = "tiktoken";
    else if (providerId === "anthropic") tokenizerKind = "anthropic-endpoint";
    else if (providerId === "google") tokenizerKind = "google-endpoint";

    const tokenizer = doc.tokenizer || {
      kind: tokenizerKind,
      name: tokenizerKind === "tiktoken" ? "o200k_base" : undefined,
    };

    const status: "active" | "deprecated" =
      doc.status || (doc.active === false ? "deprecated" : "active");

    const addedAt =
      doc.addedAt ||
      (doc.created_at ? new Date(doc.created_at).toISOString() : new Date().toISOString());

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          id,
          providerId,
          label,
          contextWindow,
          maxOutput,
          tier,
          supportsCaching,
          supportsBatch,
          supportsStructuredOutput,
          tokenizer,
          status,
          addedAt,
          model_id: doc.model_id || id,
          provider: doc.provider || providerId,
          display_name: doc.display_name || label,
        },
      }
    );
  }

  await collection.createIndex(
    { id: 1, providerId: 1 },
    { unique: true, background: true }
  );
}
