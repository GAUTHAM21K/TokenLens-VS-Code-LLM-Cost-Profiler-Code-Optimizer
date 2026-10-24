/**
 * Migration 004: normalizes phase taxonomy documents and their default parameters.
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 004: Phases Schema Normalization
 * - Adds `id`, `track` ("build" | "runtime"), `sortOrder`, `description`, `archetypes`,
 *   `defaultParams`, `paramHints`, `cacheablePrefix`
 * - Creates index on `{ track: 1 }`
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("phases");

  const cursor = collection.find({});
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) continue;

    const id = doc.id || doc.phase_id;
    const name = doc.name || id;
    const sortOrder = typeof doc.sortOrder === "number" ? doc.sortOrder : Number(doc.sort_order ?? 1);

    const isBuildPhase =
      /architecture|scaffold|devops|build|prototype|design|spec/i.test(id) ||
      sortOrder < 5;

    const track: "build" | "runtime" = doc.track || (isBuildPhase ? "build" : "runtime");

    const defaultParams = doc.defaultParams || {
      callsLow: track === "build" ? 1 : 1,
      callsExpected: track === "build" ? 5 : 1,
      callsHigh: track === "build" ? 20 : 3,
      tokensPerCallLow: 500,
      tokensPerCallExpected: 2000,
      tokensPerCallHigh: 6000,
      retriesLow: 0,
      retriesExpected: 1,
      retriesHigh: 3,
      volumeMultiplierLow: track === "runtime" ? 1 : undefined,
      volumeMultiplierExpected: track === "runtime" ? 1 : undefined,
      volumeMultiplierHigh: track === "runtime" ? 1.5 : undefined,
    };

    const paramHints = doc.paramHints || {
      calls: "Estimated invocations per period",
      tokensPerCall: "Average prompt + completion tokens",
      retries: "Expected retry and fallback attempts",
    };

    const cacheablePrefix =
      typeof doc.cacheablePrefix === "number"
        ? doc.cacheablePrefix
        : typeof doc.cacheablePrefix === "boolean"
        ? (doc.cacheablePrefix ? 0.5 : 0)
        : typeof doc.default_cacheable_fraction === "number"
        ? doc.default_cacheable_fraction
        : 0;

    const archetypes = doc.archetypes || [
      "rag-chatbot",
      "coding-agent",
      "summarizer",
      "general",
    ];

    const description =
      doc.description ||
      `Pipeline phase ${name} executing in the ${track} track with verified token profiles.`;

    await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          id,
          name,
          track,
          sortOrder,
          description,
          archetypes,
          defaultParams,
          paramHints,
          cacheablePrefix,
          phase_id: doc.phase_id || id,
          sort_order: doc.sort_order || sortOrder,
        },
      }
    );
  }

  await collection.createIndex({ track: 1 }, { background: true });
}
