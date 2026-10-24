/**
 * Migration 001: normalizes provider documents (id, label, adapterType, baseUrl, keyFormatHint,
 * enabled).
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 001: Providers Schema Normalization
 * - Adds canonical `id`, `label`, `adapterType`, `baseUrl`, `keyFormatHint`, `enabled`
 * - Retains `provider_id` and `display_name` as aliases
 * - Creates unique index on `id`
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("providers");

  const cursor = collection.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    const id = doc.id || doc.provider_id;
    const label = doc.label || doc.display_name || id;
    const enabled = typeof doc.enabled === "boolean" ? doc.enabled : Boolean(doc.active ?? true);

    let adapterType: "anthropic" | "openai" | "google" | "mistral" | "openai-compatible" | "host-lm" =
      doc.adapterType || "openai-compatible";

    if (id === "anthropic") adapterType = "anthropic";
    else if (id === "openai") adapterType = "openai";
    else if (id === "google") adapterType = "google";
    else if (id === "mistral") adapterType = "mistral";

    let baseUrl = doc.baseUrl;
    if (!baseUrl) {
      if (id === "anthropic") baseUrl = "https://api.anthropic.com/v1";
      else if (id === "openai") baseUrl = "https://api.openai.com/v1";
      else if (id === "google") baseUrl = "https://generativelanguage.googleapis.com/v1beta";
      else if (id === "mistral") baseUrl = "https://api.mistral.ai/v1";
      else baseUrl = "https://api.openai.com/v1";
    }

    const keyFormatHint =
      doc.keyFormatHint ||
      (id === "anthropic"
        ? "sk-ant-..."
        : id === "openai"
        ? "sk-proj-..."
        : id === "google"
        ? "AIzaSy..."
        : id === "mistral"
        ? "mistral-..."
        : "key-...");

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          id,
          label,
          adapterType,
          baseUrl,
          keyFormatHint,
          enabled,
          provider_id: doc.provider_id || id,
          display_name: doc.display_name || label,
        },
      }
    );
  }

  await collection.createIndex({ id: 1 }, { unique: true, background: true });
}
