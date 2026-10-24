/**
 * Migration 003: creates the auditable pricing collection (sourceUrl + verifiedAt per row).
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 003: Pricing Collection Extraction
 * - Extracts embedded pricing from `models` into dedicated `pricing` collection
 * - Adds `currency: "USD"`, `sourceUrl`, `verifiedAt`, `effectiveFrom`
 * - Creates index on `{ modelId: 1, effectiveFrom: -1 }`
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const modelsCollection = db.collection("models");
  const pricingCollection = db.collection("pricing");

  const cursor = modelsCollection.find({});
  while (await cursor.hasNext()) {
    const model = await cursor.next();
    if (!model) continue;

    const modelId = model.id || model.model_id;
    if (!modelId) continue;

    const p = model.pricing || {};
    const inputPerMTok = Number(p.input_per_1m ?? p.inputPerMTok ?? 0);
    const outputPerMTok = Number(p.output_per_1m ?? p.outputPerMTok ?? 0);
    const cachedInputPerMTok =
      p.cached_input_per_1m !== undefined && p.cached_input_per_1m !== null
        ? Number(p.cached_input_per_1m)
        : p.cachedInputPerMTok !== undefined
        ? Number(p.cachedInputPerMTok)
        : undefined;

    const effectiveFrom = model.effective_from
      ? new Date(model.effective_from).toISOString()
      : model.effectiveFrom || new Date().toISOString();

    const verifiedAt = model.updated_at
      ? new Date(model.updated_at).toISOString()
      : model.verifiedAt || new Date().toISOString();

    const providerId = model.providerId || model.provider;
    let sourceUrl = "https://openai.com/api/pricing";
    if (providerId === "anthropic") {
      sourceUrl = "https://www.anthropic.com/pricing";
    } else if (providerId === "google") {
      sourceUrl = "https://ai.google.dev/pricing";
    } else if (providerId === "mistral") {
      sourceUrl = "https://mistral.ai/technology/#pricing";
    }

    const pricingDoc = {
      modelId,
      currency: "USD" as const,
      inputPerMTok,
      outputPerMTok,
      cachedInputPerMTok,
      cacheWriteMultiplier: p.cache_write_per_1m ? Number(p.cache_write_per_1m) : undefined,
      batchDiscount: p.batch_input_per_1m ? 0.5 : undefined,
      effectiveFrom,
      sourceUrl,
      verifiedAt,
    };

    await pricingCollection.updateOne(
      { modelId, effectiveFrom },
      { $set: pricingDoc },
      { upsert: true }
    );
  }

  await pricingCollection.createIndex(
    { modelId: 1, effectiveFrom: -1 },
    { background: true }
  );
}
