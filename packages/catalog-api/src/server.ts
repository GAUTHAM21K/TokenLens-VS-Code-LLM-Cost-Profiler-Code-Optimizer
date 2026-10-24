/**
 * Builds the Fastify Catalog API server (CORS, optional rate limit, /v1/health, catalog routes).
 *
 * Exports: BuildServerOptions, buildServer
 * Feature: catalog
 */
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Db } from "mongodb";
import { catalogRoutes } from "./routes/catalog.js";

export interface BuildServerOptions {
  db?: Db | null;
  logger?: boolean;
  enableRateLimit?: boolean;
}

/**
 * Builds the Fastify server for the read-only Catalog API.
 * Rate Limiting: Production rate limiting operates at the ingress layer (per contracts/catalog-api.yaml).
 * For self-hosters, an opt-in in-process rate limiter is supported via @fastify/rate-limit
 * (off by default, optional dependency).
 * CORS Policy: Permissive for read-only GET endpoints (public catalog data),
 * allowing VS Code webviews and local developer tooling access.
 */
export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const { db = null, logger = false, enableRateLimit = false } = options;
  const app = Fastify({ logger });

  // Public read-only catalog allows cross-origin requests from webviews and browser extensions
  app.register(cors, {
    origin: true,
    methods: ["GET"],
  });

  // Opt-in rate limiting for self-hosters (off by default; optional dependency)
  if (enableRateLimit || process.env.RATE_LIMIT_ENABLED === "true") {
    app.register(async (instance) => {
      try {
        // Dynamic import so @fastify/rate-limit is purely optional for self-hosters
        const pluginName = "@fastify/rate-limit";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rateLimitModule = (await import(pluginName)) as any;
        const plugin = rateLimitModule.default || rateLimitModule;
        await instance.register(plugin, {
          max: Number(process.env.RATE_LIMIT_MAX) || 100,
          timeWindow: process.env.RATE_LIMIT_TIME_WINDOW || "1 minute",
        });
      } catch {
        instance.log.warn(
          "[Catalog API] Opt-in rate limiting requested, but '@fastify/rate-limit' is not installed. To enable in-process rate limiting, run: npm install @fastify/rate-limit"
        );
      }
    });
  }

  // Health check endpoint
  app.get("/v1/health", async () => {
    let catalogVersion = 0;
    let dbConnected = false;

    if (db) {
      try {
        const metaDoc = await db.collection("catalog_meta").findOne({});
        catalogVersion = metaDoc?.version ?? 1;
        dbConnected = true;
      } catch {
        dbConnected = false;
      }
    }

    return {
      status: "ok",
      catalogVersion,
      dbConnected,
    };
  });

  // Register catalog routes under /v1
  app.register(catalogRoutes, { prefix: "/v1", db });

  return app;
}
