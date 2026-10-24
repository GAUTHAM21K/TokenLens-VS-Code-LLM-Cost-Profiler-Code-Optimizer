# Migration Plan: Database Snapshot to Token Optimizer Schema

**Date**: 2026-10-09  
**Specification**: [data-model.md](../../specs/001-token-optimizer/data-model.md)  
**Database Snapshot**: [schema-summary.md](../../docs/db-snapshot/schema-summary.md)  
**Context**: Research Decision 4, FR-002, FR-017, FR-025, FR-034, Principle VII, Principle VIII

---

## 1. Overview & Strategy

The current MongoDB database contains 5 collections (`models`, `optimizer_rules`, `phases`, `pricing_history`, `providers`) created under an earlier prototype. The Token Optimizer v1 data model requires schema alignment, field normalization, explicit indexing, separation of pricing into its own collection, and addition of platforms, prompt templates, and catalog metadata.

### Non-Negotiable Migration Principles
1. **Idempotence**: Every migration must be safely re-runnable with identical results without duplicating or corrupting data.
2. **Backward Compatibility**: Existing fields (e.g., `provider_id`, `model_id`, `display_name`) are retained as deprecated aliases alongside canonical v1 field names (`id`, `label`, `providerId`).
3. **Auditability (Principle VII)**: All pricing rows in the new `pricing` collection must have verified sources (`sourceUrl`) and verification timestamps (`verifiedAt`).
4. **Approval Gate (Principle VIII)**: Strategies migrated from `optimizer_rules` default to `reviewStatus: "draft"` until explicitly reviewed and approved.

---

## 2. Field-by-Field Diff Analysis

### 2.1 Collection: `providers` (11 documents in snapshot)
| Snapshot Field | Target Canonical Field | Change Type | Action & Rationale |
| :--- | :--- | :--- | :--- |
| `provider_id` (string) | `id` (string) | Rename + Alias | `id` is primary identifier; keep `provider_id` as deprecated alias |
| `display_name` (string) | `label` (string) | Rename + Alias | `label` matches UI/Zod convention; keep `display_name` as deprecated alias |
| `implementation_type` (string) | `adapterType` (enum) | Transform | Map "native" -> "anthropic" / "openai" / "google"; fallback to "openai-compatible" |
| *(absent)* | `baseUrl` (string) | New Field | Add API base URL (empty for host-lm); required by `ProviderSchema` |
| *(absent)* | `listModelsEndpoint` | New Field | Optional endpoint path for live model discovery |
| *(absent)* | `keyFormatHint` (string) | New Field | Prefix guidance (e.g. `sk-ant-...`, `sk-proj-...`) for key entry UX |
| `active` (boolean) | `enabled` (boolean) | Rename + Alias | Canonical boolean `enabled` |
| *(absent)* | Index on `id` | New Index | Create unique index on `id` |

### 2.2 Collection: `models` (40 documents in snapshot)
| Snapshot Field | Target Canonical Field | Change Type | Action & Rationale |
| :--- | :--- | :--- | :--- |
| `model_id` (string) | `id` (string) | Rename + Alias | Set `id = model_id`; keep `model_id` as alias |
| `provider` (string) | `providerId` (string) | Rename + Alias | Set `providerId = provider`; keep `provider` as alias |
| `display_name` (string) | `label` (string) | Rename + Alias | Set `label = display_name`; keep `display_name` as alias |
| `context_window` (number) | `contextWindow` (number) | Rename + Alias | Snake_case to camelCase |
| *(absent)* | `maxOutput` (number) | New Field | Set default max output tokens (e.g. 4096 or 8192) per tier |
| `complexity_tier` (string) | `tier` (enum) | Transform | Map to `"economy" \| "standard" \| "advanced" \| "frontier"` |
| `pricing` (embedded object) | *(extracted)* | Extract to collection | Extracted to dedicated `pricing` collection (migration 003) |
| *(absent)* | `supportsCaching` (bool) | New Field | Set `true` if `pricing.cached_input_per_1m` is present and > 0 |
| *(absent)* | `supportsBatch` (bool) | New Field | Set `true` if `pricing.batch_input_per_1m` is present and > 0 |
| *(absent)* | `supportsStructuredOutput`| New Field | Default `true` for modern JSON-mode models |
| *(absent)* | `tokenizer` (object) | New Field | `{ kind: "tiktoken" \| "anthropic-endpoint" \| "char-approx" }` |
| `active` (boolean) | `status` (enum) | Transform | `active: true` -> `"active"`, `false` -> `"deprecated"` |
| `created_at` (ISODate) | `addedAt` (string) | Transform | Convert to ISO8601 string |
| *(absent)* | Index on `id`, `providerId`| New Index | Compound index on `{ id: 1, providerId: 1 }` |

### 2.3 Collection: `pricing` (New Collection)
| Snapshot Source Field | Target Canonical Field | Change Type | Action & Rationale |
| :--- | :--- | :--- | :--- |
| `models.model_id` | `modelId` (string) | Foreign Key | References `models.id` |
| *(hardcoded)* | `currency` ("USD") | Literal | Standardized currency USD |
| `models.pricing.input_per_1m` | `inputPerMTok` (number) | Transform | Rate per 1M tokens |
| `models.pricing.output_per_1m` | `outputPerMTok` (number) | Transform | Rate per 1M tokens |
| `models.pricing.cached_input_per_1m` | `cachedInputPerMTok` | Transform | Optional cached token rate |
| `models.pricing.cache_write_per_1m` | `cacheWriteMultiplier` | Transform | Multiplier relative to base input |
| `models.pricing.batch_input_per_1m` | `batchDiscount` | Transform | Discount fraction (e.g. 0.5) |
| `models.effective_from` | `effectiveFrom` (ISO8601) | Rename | Effective date timestamp |
| *(absent in snapshot)* | `sourceUrl` (string) | New Field | Official provider documentation/rate-card URL (Principle VII) |
| *(absent in snapshot)* | `verifiedAt` (string) | New Field | Verification timestamp (Principle VII) |
| *(absent)* | Index on `modelId, effectiveFrom` | New Index | Index on `{ modelId: 1, effectiveFrom: -1 }` |

### 2.4 Collection: `phases` (10 documents in snapshot)
| Snapshot Field | Target Canonical Field | Change Type | Action & Rationale |
| :--- | :--- | :--- | :--- |
| `phase_id` (string) | `id` (string) | Rename + Alias | Canonical phase identifier |
| `name` (string) | `name` (string) | Retain | Phase display name |
| *(absent)* | `track` ("build" \| "runtime")| New Field | Classify into `"build"` vs `"runtime"` track |
| `sort_order` (number) | `sortOrder` (number) | Rename + Alias | Ordering in phase sequence |
| *(absent)* | `description` (string) | New Field | Explanatory description for UI (FR-018) |
| *(absent)* | `archetypes` (string[]) | New Field | Project types this phase applies to |
| *(absent)* | `defaultParams` (object) | New Field | Calls, tokens, retries, volume multipliers (low, expected, high) |
| *(absent)* | `paramHints` (object) | New Field | UI parameter hints |
| `default_cacheable_fraction` | `cacheablePrefix` (boolean) | Transform | Boolean indicating prefix caching applicability |
| *(absent)* | Index on `track` | New Index | Index on `{ track: 1 }` |

### 2.5 Collection: `strategies` (Migrated from `optimizer_rules` + Schema Validation)
| Snapshot `optimizer_rules` Field | Target `strategies` Field | Change Type | Action & Rationale |
| :--- | :--- | :--- | :--- |
| `rule_id` (string) | `id` (string) | Rename + Alias | Strategy ID |
| `name` (string) | `name` (string) | Retain | Display name |
| `category` (string) | `group` (enum) | Transform | Mapped to strategy groups (e.g. `caching`, `prompt-efficiency`) |
| `affected_phases` | `targets` (array) | Transform | Map `["*"]` to `["build", "runtime"]` |
| `description` (string) | `summary` (string) | Rename + Alias | High-level summary |
| `condition` (object) | `applicability` (object) | Transform | Convert single threshold to recursive predicate |
| `savings_percentage` | `savings` (object) | Transform | Min, max, basis, unit, appliesTo |
| *(absent)* | `reviewStatus` (enum) | New Field | Set to `"draft"` until verified (Principle VIII) |
| *(absent)* | `preview` / `implementation` | New Fields | Detection rules, code examples, prompt templates |
| *(absent)* | Indexes & Validation | New | Indexes on `id`, `reviewStatus`, `group`, `targets`; JSON Schema |

### 2.6 Collection: `platforms` (New Collection)
- Creates `platforms` collection.
- Seeds 4 platforms: `vscode`, `cursor`, `windsurf`, `antigravity`.
- Flags `vscode` with `isDefault: true`.
- Defines `artifactTargets` and `agentInvocation` mechanisms.

### 2.7 Collection: `prompt_templates` (New Collection)
- Creates `prompt_templates` collection.
- Seeds template stubs for: `enhance`, `profile-extract`, `apply-edit`, `preview`.
- Index on `{ purpose: 1, active: 1 }`.

### 2.8 Collection: `catalog_meta` (New Collection)
- Creates single-document version tracker: `{ version: 1, publishedAt: "<ISO>", schemaVersion: "1.0" }`.

---

## 3. Ordered Migration Scripts (8 Steps)

| Order | Script File | Description & Target Collection |
| :--- | :--- | :--- |
| **001** | `001-providers-schema.ts` | Rename fields, add adapterType, baseUrl, keyFormatHint, enabled, index on `id` |
| **002** | `002-models-schema.ts` | Rename fields, add tier, tokenizer, status, addedAt, compound index |
| **003** | `003-pricing-collection.ts` | Extract pricing from models, populate pricing collection with sourceUrl and verifiedAt |
| **004** | `004-phases-schema.ts` | Add track (`build`/`runtime`), defaultParams, paramHints, archetypes, index on track |
| **005** | `005-strategies-collection.ts` | Migrate `optimizer_rules` to `strategies`, configure JSON Schema validator, draft status |
| **006** | `006-platforms-collection.ts` | Create platforms collection and seed VS Code, Cursor, Windsurf, Antigravity |
| **007** | `007-prompt-templates-collection.ts` | Create prompt_templates collection and seed core templates |
| **008** | `008-catalog-meta.ts` | Create catalog_meta collection with version 1 and schemaVersion 1.0 |
