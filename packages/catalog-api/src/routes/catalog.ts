/**
 * Catalog API routes: GET /v1/catalog (full validated snapshot with ETag) and
 * GET /v1/catalog/:collection. Only approved strategies are served (Principle VIII).
 *
 * Exports: catalogRoutes, CatalogRouteOptions
 * Feature: catalog
 */
import type { FastifyPluginAsync } from "fastify";
import type { Db } from "mongodb";
import {
  CatalogSnapshotSchema,
  ProviderSchema,
  ModelSchema,
  PricingSchema,
  PhaseSchema,
  StrategySchema,
  PlatformSchema,
  PromptTemplateSchema,
  RouterPresetSchema,
  type CatalogSnapshot,
} from "@token-optimizer/core";
import { generateETag, matchesETag, CACHE_CONTROL_HEADER } from "../db/etag.js";

export interface CatalogRouteOptions {
  db: Db | null;
}

const ALLOWED_COLLECTIONS = [
  "providers",
  "models",
  "pricing",
  "phases",
  "strategies",
  "platforms",
  "prompt_templates",
  "promptTemplates",
  "router_presets",
  "routerPresets",
];

/** API collection name -> Mongo collection name. */
const MONGO_COLLECTION: Record<string, string> = {
  promptTemplates: "prompt_templates",
  routerPresets: "router_presets",
};

const sanitizeDocument = (
  doc: Record<string, unknown>,
  collection?: string
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(doc)) {
    if (key.startsWith("_")) continue;
    if (val === null || val === undefined) continue;

    if (collection === "providers") {
      if (key === "provider_id" || key === "display_name" || key === "active") continue;
    } else if (collection === "models") {
      if (
        key === "model_id" ||
        key === "provider" ||
        key === "display_name" ||
        key === "context_window" ||
        key === "complexity_tier" ||
        key === "pricing" ||
        key === "created_at"
      ) {
        continue;
      }
    } else if (collection === "phases") {
      if (
        key === "phase_id" ||
        key === "sort_order" ||
        key === "default_cacheable_fraction"
      ) {
        continue;
      }
    }

    if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
      result[key] = sanitizeDocument(val as Record<string, unknown>);
    } else {
      result[key] = val;
    }
  }
  return result;
};

export const catalogRoutes: FastifyPluginAsync<CatalogRouteOptions> = async (
  fastify,
  opts
) => {
  const { db } = opts;

  // GET /v1/catalog - full catalog snapshot with ETag
  fastify.get("/catalog", async (request, reply) => {
    if (!db) {
      return reply.status(503).send({ error: "Database not connected" });
    }

    try {
      const metaDoc = await db.collection("catalog_meta").findOne({});
      const version = metaDoc?.version ?? 1;
      const schemaVersion = metaDoc?.schemaVersion ?? "1.0";
      // S1-1: Use deterministic fallback date when catalog_meta is absent so ETag remains stable
      const publishedAt = metaDoc?.publishedAt ?? "2025-01-01T00:00:00.000Z";

      const etag = generateETag(version, publishedAt);
      const ifNoneMatch = request.headers["if-none-match"];

      reply.header("ETag", etag);
      reply.header("Cache-Control", CACHE_CONTROL_HEADER);

      if (matchesETag(ifNoneMatch, etag)) {
        return reply.status(304).send();
      }

      // C3: Strip deprecated legacy fields before validating against strict schemas
      const providers = (await db.collection("providers").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "providers")
      );
      const models = (await db.collection("models").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "models")
      );
      const pricing = (await db.collection("pricing").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "pricing")
      );
      const phases = (await db.collection("phases").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "phases")
      );

      // Principle VIII: Only return approved strategies
      const strategies = (
        await db.collection("strategies").find({ reviewStatus: "approved" }).toArray()
      ).map((d) => sanitizeDocument(d, "strategies"));

      const platforms = (await db.collection("platforms").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "platforms")
      );
      const promptTemplates = (
        await db.collection("prompt_templates").find({}).toArray()
      ).map((d) => sanitizeDocument(d, "prompt_templates"));
      const routerPresets = (await db.collection("router_presets").find({}).toArray()).map((d) =>
        sanitizeDocument(d, "router_presets")
      );

      const rawSnapshot: CatalogSnapshot = {
        version,
        schemaVersion,
        publishedAt,
        providers: providers as unknown as CatalogSnapshot["providers"],
        models: models as unknown as CatalogSnapshot["models"],
        pricing: pricing as unknown as CatalogSnapshot["pricing"],
        phases: phases as unknown as CatalogSnapshot["phases"],
        strategies: strategies as unknown as CatalogSnapshot["strategies"],
        platforms: platforms as unknown as CatalogSnapshot["platforms"],
        promptTemplates: promptTemplates as unknown as CatalogSnapshot["promptTemplates"],
        routerPresets: routerPresets as unknown as CatalogSnapshot["routerPresets"],
      };

      // Zod-validate response against CatalogSnapshotSchema
      const snapshot = CatalogSnapshotSchema.parse(rawSnapshot);
      return reply.status(200).send(snapshot);
    } catch (err) {
      request.log.error(err, "Failed to load catalog snapshot");
      return reply.status(503).send({ error: "Failed to assemble catalog snapshot" });
    }
  });

  // GET /v1/catalog/:collection - single collection
  fastify.get<{ Params: { collection: string } }>(
    "/catalog/:collection",
    async (request, reply) => {
      const { collection } = request.params;

      if (!ALLOWED_COLLECTIONS.includes(collection)) {
        return reply.status(404).send({
          error: "Not Found",
          message: `Unknown collection '${collection}'`,
        });
      }

      if (!db) {
        return reply.status(503).send({ error: "Database not connected" });
      }

      try {
        const metaDoc = await db.collection("catalog_meta").findOne({});
        const version = metaDoc?.version ?? 1;
        const publishedAt = metaDoc?.publishedAt ?? "2025-01-01T00:00:00.000Z";

        const etag = generateETag(version, `${collection}:${publishedAt}`);
        const ifNoneMatch = request.headers["if-none-match"];

        reply.header("ETag", etag);
        reply.header("Cache-Control", CACHE_CONTROL_HEADER);

        if (matchesETag(ifNoneMatch, etag)) {
          return reply.status(304).send();
        }

        const mongoColName = MONGO_COLLECTION[collection] ?? collection;
        const filter = collection === "strategies" ? { reviewStatus: "approved" } : {};

        const rawDocs = await db.collection(mongoColName).find(filter).toArray();
        const items = rawDocs.map((d) => sanitizeDocument(d, collection));

        // Validate items with corresponding Zod schemas
        if (collection === "providers") {
          items.forEach((item) => ProviderSchema.parse(item));
        } else if (collection === "models") {
          items.forEach((item) => ModelSchema.parse(item));
        } else if (collection === "pricing") {
          items.forEach((item) => PricingSchema.parse(item));
        } else if (collection === "phases") {
          items.forEach((item) => PhaseSchema.parse(item));
        } else if (collection === "strategies") {
          items.forEach((item) => StrategySchema.parse(item));
        } else if (collection === "platforms") {
          items.forEach((item) => PlatformSchema.parse(item));
        } else if (collection === "prompt_templates" || collection === "promptTemplates") {
          items.forEach((item) => PromptTemplateSchema.parse(item));
        } else if (collection === "router_presets" || collection === "routerPresets") {
          items.forEach((item) => RouterPresetSchema.parse(item));
        }

        return reply.status(200).send({
          collection,
          version,
          items,
        });
      } catch (err) {
        request.log.error(err, `Failed to load collection '${collection}'`);
        return reply.status(500).send({ error: `Failed to load collection '${collection}'` });
      }
    }
  );
};
