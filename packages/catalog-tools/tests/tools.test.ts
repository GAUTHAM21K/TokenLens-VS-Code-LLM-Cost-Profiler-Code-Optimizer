/**
 * Tests: Catalog Tools Integration Tests (T028, T035, T036, T037, Principle VII, VIII).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  runMigrations,
  seedCatalog,
  validateCatalog,
  publishCatalog,
  loadSeedDir,
  findFutureDatedPricing,
} from "../src/index.js";
import { CatalogSnapshotSchema } from "@token-optimizer/core";

describe("Catalog Tools Integration Tests (T028, T035, T036, T037, Principle VII, VIII)", () => {
  let mongod: MongoMemoryServer;
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    client = new MongoClient(mongod.getUri());
    await client.connect();
    db = client.db("test_tools");
  }, 180000);

  afterAll(async () => {
    if (client) await client.close();
    if (mongod) await mongod.stop();
  });

  it("T028: runMigrations runs all 11 migrations, records a ledger, and is idempotent", async () => {
    const migrationsDir = path.resolve(__dirname, "../../catalog-api/migrations");
    const executed = await runMigrations(db, { migrationsDir });
    expect(executed.length).toBe(11);

    // Ledger: a second run skips everything already applied
    const reRun = await runMigrations(db, { migrationsDir });
    expect(reRun.length).toBe(0);

    // Forced re-run is still an idempotent success
    const forced = await runMigrations(db, { migrationsDir, force: true });
    expect(forced.length).toBe(11);
  });

  it("T035: seedCatalog succeeds on valid data and enforces Principle VII auditability", async () => {
    const rawSeed = loadSeedDir();

    const result = await seedCatalog(db, rawSeed);
    expect(result.modelsCount).toBeGreaterThan(0);
    expect(result.pricingCount).toBeGreaterThan(0);
    expect(result.providersCount).toBeGreaterThan(0);

    // Principle VII violation: missing verifiedAt
    const invalidPricingNoVerified = {
      pricing: [
        {
          modelId: "gpt-4o",
          currency: "USD",
          inputPerMTok: 2.5,
          outputPerMTok: 10.0,
          effectiveFrom: "2026-10-01T00:00:00Z",
          sourceUrl: "https://openai.com/pricing",
          // missing verifiedAt
        },
      ],
    };

    await expect(seedCatalog(db, invalidPricingNoVerified)).rejects.toThrow(
      /Principle VII violation.*verifiedAt/
    );

    // Principle VII violation: missing sourceUrl
    const invalidPricingNoSource = {
      pricing: [
        {
          modelId: "gpt-4o",
          currency: "USD",
          inputPerMTok: 2.5,
          outputPerMTok: 10.0,
          effectiveFrom: "2026-10-01T00:00:00Z",
          verifiedAt: "2026-10-09T00:00:00Z",
          // missing sourceUrl
        },
      ],
    };

    await expect(seedCatalog(db, invalidPricingNoSource)).rejects.toThrow(
      /Principle VII violation.*sourceUrl/
    );
  });

  it("T036: validateCatalog validates all seeded documents and catches corrupted docs", async () => {
    const summary = await validateCatalog(db);
    expect(summary.valid).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBeGreaterThan(0);

    // Insert a corrupted provider document
    await db.collection("providers").insertOne({
      id: "corrupted-provider",
      // missing required label, adapterType, etc.
    });

    const corruptedSummary = await validateCatalog(db);
    expect(corruptedSummary.valid).toBe(false);
    expect(corruptedSummary.failed).toBeGreaterThan(0);

    // Clean up
    await db.collection("providers").deleteOne({ id: "corrupted-provider" });
  });

  it("pricing must be effective at seed/publish time; seed rows replace a model's stale rows", async () => {
    const row = (effectiveFrom: string) => ({
      modelId: "gpt-4o",
      currency: "USD",
      inputPerMTok: 2.5,
      outputPerMTok: 10.0,
      effectiveFrom,
      sourceUrl: "https://openai.com/pricing",
      verifiedAt: "2026-10-01T00:00:00Z",
    });
    expect(findFutureDatedPricing([row("2026-10-01T00:00:00Z")], "2026-10-02T00:00:00Z")).toEqual([]);
    expect(findFutureDatedPricing([row("2026-10-03T00:00:00Z")], "2026-10-02T00:00:00Z")).toEqual([
      "gpt-4o (effectiveFrom 2026-10-03T00:00:00Z)",
    ]);

    // Seed rejects a future-dated row.
    await expect(seedCatalog(db, { pricing: [row("2999-01-01T00:00:00Z")] })).rejects.toThrow(
      /later than the seed time/
    );

    // A stale stored row (not in the seed) blocks publish, and re-seeding removes it.
    const pricing = db.collection("pricing");
    await pricing.insertOne(row("2999-01-01T00:00:00Z"));
    await expect(publishCatalog(db)).rejects.toThrow(/Refusing to publish/);
    await seedCatalog(db, { pricing: loadSeedDir().pricing });
    expect(await pricing.countDocuments({ modelId: "gpt-4o", effectiveFrom: "2999-01-01T00:00:00Z" })).toBe(0);
  });

  it("T037: publishCatalog increments version and writes validated snapshot", async () => {
    const tempSnapshotPath = path.resolve(__dirname, "../dist/test-snapshot.json");
    const { version, snapshot } = await publishCatalog(db, {
      snapshotPath: tempSnapshotPath,
    });

    expect(version).toBeGreaterThanOrEqual(2);
    expect(snapshot.version).toBe(version);
    expect(CatalogSnapshotSchema.safeParse(snapshot).success).toBe(true);

    const writtenContent = await fs.readFile(tempSnapshotPath, "utf-8");
    const parsedFile = JSON.parse(writtenContent);
    expect(parsedFile.version).toBe(version);

    await fs.unlink(tempSnapshotPath);
  });

  it("Strategy Review Workflow: generates review report and enforces human approval (Principle VIII)", async () => {
    const { generateReviewReport, approveStrategy } = await import("../src/index.js");

    // 1. Generate review report
    const tempReportDir = path.resolve(__dirname, "../dist/reports");
    const reportRes = await generateReviewReport(db, {
      outputDir: tempReportDir,
      date: "2026-10-09",
    });

    expect(reportRes.draftCount).toBeGreaterThan(0);
    const reportContent = await fs.readFile(reportRes.reportPath, "utf-8");
    expect(reportContent).toContain("Maintainer Review Checklist (Principle VIII)");
    expect(reportContent).toContain("cache-prefix-ordering");

    // 2. Reject approval by automated bot identity
    await expect(
      approveStrategy(db, "cache-prefix-ordering", "github-actions[bot]")
    ).rejects.toThrow(/Principle VIII violation.*recognized bot/);

    await expect(
      approveStrategy(db, "cache-prefix-ordering", "   ")
    ).rejects.toThrow(/Principle VIII violation.*Reviewer name is required/);

    // 3. Reject direct seeding of approved strategies
    await expect(
      seedCatalog(db, {
        strategies: [
          {
            id: "unreviewed-strat",
            name: "Unreviewed Strategy",
            group: "caching",
            targets: ["build"],
            summary: "summary",
            savings: { minPercent: 10, maxPercent: 20, basis: "test" },
            reviewStatus: "approved", // prohibited in seed
          },
        ],
      })
    ).rejects.toThrow(/Principle VIII violation.*Seed scripts must only write reviewStatus='draft'/);

    // 4. Successful approval by a named human maintainer
    const approved = await approveStrategy(
      db,
      "cache-prefix-ordering",
      "Alice (Lead Maintainer)"
    );

    expect(approved.reviewStatus).toBe("approved");
    expect(approved.reviewedBy).toBe("Alice (Lead Maintainer)");
    expect(approved.reviewedAt).toBeDefined();

    // 5. Clean up report
    await fs.unlink(reportRes.reportPath);
  });
});
