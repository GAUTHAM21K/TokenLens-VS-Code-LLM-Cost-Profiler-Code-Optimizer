/**
 * Tests: Catalog API Contract Tests (T038, contracts/catalog-api.yaml, Principle III, VIII).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import * as path from "node:path";
import { buildServer } from "../../src/server.js";
import { CatalogSnapshotSchema } from "@token-optimizer/core";
import { runMigrations } from "@token-optimizer/catalog-tools";
import { seedCatalog, loadSeedDir } from "@token-optimizer/catalog-tools";

describe("Catalog API Contract Tests (T038, contracts/catalog-api.yaml, Principle III, VIII)", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;
  let server: ReturnType<typeof buildServer>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    client = new MongoClient(uri);
    await client.connect();
    db = client.db("test_catalog");

    // Run all 8 migrations
    const migrationsDir = path.resolve(__dirname, "../../migrations");
    await runMigrations(db, { migrationsDir });

    // Seed test catalog data from maintainer JSON
    await seedCatalog(db, loadSeedDir());

    server = buildServer({ db });
  }, 180000);

  afterAll(async () => {
    if (client) await client.close();
    if (mongod) await mongod.stop();
  });

  it("GET /v1/health returns status ok and catalog version", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/health",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe("ok");
    expect(body.catalogVersion).toBeGreaterThanOrEqual(1);
    expect(body.dbConnected).toBe(true);
  });

  it("GET /v1/catalog returns 200 with schema-valid snapshot and ETag", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/catalog",
    });

    expect(res.statusCode).toBe(200);
    const etag = res.headers["etag"];
    expect(etag).toBeDefined();
    expect(typeof etag).toBe("string");
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");

    const body = JSON.parse(res.body);
    // Validate against CatalogSnapshotSchema
    const validated = CatalogSnapshotSchema.parse(body);
    expect(validated.version).toBeGreaterThanOrEqual(1);
    expect(validated.providers.length).toBeGreaterThan(0);
    expect(validated.models.length).toBeGreaterThan(0);
    expect(validated.pricing.length).toBeGreaterThan(0);
    expect(validated.phases.length).toBeGreaterThan(0);
    expect(validated.platforms.length).toBeGreaterThan(0);
    expect(validated.promptTemplates.length).toBeGreaterThan(0);

    // v2 contract: Groq provider/models, router presets, compress template
    expect(validated.providers.find((p) => p.id === "groq")?.adapterType).toBe("openai-compatible");
    expect(validated.models.filter((m) => m.providerId === "groq").length).toBeGreaterThanOrEqual(2);
    expect(validated.routerPresets?.some((r) => r.isDefault)).toBe(true);
    expect(validated.promptTemplates.some((t) => t.id === "compress-default")).toBe(true);

    // Principle VIII: Strategies served by API must only have reviewStatus: 'approved'
    for (const strategy of validated.strategies) {
      expect(strategy.reviewStatus).toBe("approved");
    }

    // Principle VII: Pricing records must have sourceUrl and verifiedAt
    for (const pricing of validated.pricing) {
      expect(pricing.sourceUrl).toBeDefined();
      expect(pricing.verifiedAt).toBeDefined();
    }
  });

  it("GET /v1/catalog returns 304 Not Modified when matching If-None-Match is sent", async () => {
    const firstRes = await server.inject({
      method: "GET",
      url: "/v1/catalog",
    });
    expect(firstRes.statusCode).toBe(200);
    const etag = firstRes.headers["etag"] as string;

    const secondRes = await server.inject({
      method: "GET",
      url: "/v1/catalog",
      headers: {
        "if-none-match": etag,
      },
    });

    expect(secondRes.statusCode).toBe(304);
    expect(secondRes.body).toBe("");
  });

  it("GET /v1/catalog/:collection returns collection payload with version and items", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/catalog/models",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.collection).toBe("models");
    expect(body.version).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("GET /v1/catalog/unknown_collection returns 404", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/v1/catalog/unknown_collection",
    });

    expect(res.statusCode).toBe(404);
  });

  it("Principle VIII Gate: draft strategies are invisible; only approved strategies with named reviewer are served", async () => {
    // 1. Initial seeded state: strategies are in draft, so /v1/catalog serves 0 strategies
    const initialRes = await server.inject({
      method: "GET",
      url: "/v1/catalog",
    });
    const initialBody = JSON.parse(initialRes.body);
    expect(initialBody.strategies.length).toBe(0);

    // 2. Approve one strategy via human review workflow
    const { approveStrategy } = await import("@token-optimizer/catalog-tools");
    await approveStrategy(db, "cache-prefix-ordering", "Alice (Reviewer)");

    // 3. Now /v1/catalog serves exactly the approved strategy
    const afterRes = await server.inject({
      method: "GET",
      url: "/v1/catalog",
    });
    const afterBody = JSON.parse(afterRes.body);
    expect(afterBody.strategies.length).toBe(1);
    expect(afterBody.strategies[0].id).toBe("cache-prefix-ordering");
    expect(afterBody.strategies[0].reviewStatus).toBe("approved");
    expect(afterBody.strategies[0].reviewedBy).toBe("Alice (Reviewer)");
    expect(afterBody.strategies[0].reviewedAt).toBeDefined();
    expect(afterBody.strategies[0].optimizer).toMatchObject({ mode: "rule", affects: "input" });
    expect(afterBody.strategies[0].implementation).toMatchObject({ language: "python" });
  });

  it("Rate Limiting: opt-in rate limit configuration is supported without crashing", () => {
    const rateLimitedServer = buildServer({ db, enableRateLimit: true });
    expect(rateLimitedServer).toBeDefined();
  });

  it("C3 Contract Test: returns 200 on migrated database retaining legacy fields (provider_id, display_name)", async () => {
    const migratedDb = client.db("migrated_legacy_catalog");

    // Seed legacy documents before running migrations
    await migratedDb.collection("providers").insertOne({
      provider_id: "anthropic",
      display_name: "Anthropic PBC",
      active: true,
    });
    await migratedDb.collection("models").insertOne({
      model_id: "claude-3-5-sonnet",
      provider: "anthropic",
      display_name: "Claude 3.5 Sonnet",
      context_window: 200000,
      pricing: {
        input_per_1m: 3.0,
        output_per_1m: 15.0,
      },
    });
    await migratedDb.collection("phases").insertOne({
      phase_id: "scaffold",
      name: "Project Scaffolding",
      sort_order: 1,
      default_cacheable_fraction: 0.5,
    });

    // Run migrations on the legacy database
    const migrationsDir = path.resolve(__dirname, "../../migrations");
    await runMigrations(migratedDb, { migrationsDir });

    const migratedServer = buildServer({ db: migratedDb });

    // Verify GET /v1/catalog succeeds without 503 from Zod strict rejection
    const catRes = await migratedServer.inject({
      method: "GET",
      url: "/v1/catalog",
    });
    expect(catRes.statusCode).toBe(200);
    const catBody = JSON.parse(catRes.body);
    expect(catBody.providers.length).toBeGreaterThan(0);
    expect(catBody.providers[0].id).toBe("anthropic");
    expect(catBody.providers[0].provider_id).toBeUndefined();

    // Verify GET /v1/catalog/providers succeeds
    const provRes = await migratedServer.inject({
      method: "GET",
      url: "/v1/catalog/providers",
    });
    expect(provRes.statusCode).toBe(200);
    const provBody = JSON.parse(provRes.body);
    expect(provBody.items.length).toBeGreaterThan(0);
    expect(provBody.items[0].id).toBe("anthropic");
    expect(provBody.items[0].provider_id).toBeUndefined();
  });
});
