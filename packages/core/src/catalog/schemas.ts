/**
 * Catalog snapshot and meta schemas: the shape served by GET /v1/catalog, written by
 * `publish --snapshot`, and bundled for offline mode. FROZEN CONTRACT for Phase 1.
 *
 * Exports: CatalogMetaSchema, CatalogSnapshotSchema, CatalogMeta, CatalogSnapshot, and re-exports
 *   of the entity schemas from protocol/schemas.
 * Feature: catalog
 */
import { z } from "zod";
import {
  ISO8601Schema,
  ProviderSchema,
  ModelSchema,
  PricingSchema,
  PhaseSchema,
  StrategySchema,
  PlatformSchema,
  PromptTemplateSchema,
  RouterPresetSchema,
} from "../protocol/schemas.js";

export {
  ProviderSchema,
  ModelSchema,
  PricingSchema,
  PhaseSchema,
  StrategySchema,
  PlatformSchema,
  PromptTemplateSchema,
  RouterPresetSchema,
};

export const CatalogMetaSchema = z
  .object({
    version: z.number().int().positive(),
    publishedAt: ISO8601Schema,
    schemaVersion: z.string().min(1).max(20),
  })
  .strict();

export const CatalogSnapshotSchema = z
  .object({
    version: z.number().int().positive(),
    schemaVersion: z.string().min(1).max(20),
    publishedAt: ISO8601Schema,
    providers: z.array(ProviderSchema),
    models: z.array(ModelSchema),
    pricing: z.array(PricingSchema),
    phases: z.array(PhaseSchema),
    strategies: z.array(StrategySchema),
    platforms: z.array(PlatformSchema),
    promptTemplates: z.array(PromptTemplateSchema),
    /** Added in catalog schemaVersion 2.0 (migration 010); optional so 1.x snapshots still parse. */
    routerPresets: z.array(RouterPresetSchema).optional(),
  })
  .strict();

export type CatalogMeta = z.infer<typeof CatalogMetaSchema>;
export type CatalogSnapshot = z.infer<typeof CatalogSnapshotSchema>;
