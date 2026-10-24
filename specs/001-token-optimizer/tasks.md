# Tasks: Token Optimizer

**Feature**: Token Optimizer | **Branch**: `001-token-optimizer` | **Date**: 2026-10-07
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Data model**: [data-model.md](data-model.md)

> Tasks organized into independently shippable **slices** (S0-S8). Each slice ends with a `/speckit-analyze` gate. `[P]` = parallelizable within the slice. FR/US references trace to spec.md.

---

## Slice 0 - Foundations

**Goal**: Monorepo scaffold, CI pipeline, strict lint rules (no key to webview/logger), Zod schemas, typed message protocol, CSP webview shell, prototype UI ported with simulated logic replaced by host message stubs.

**Independent Test**: `pnpm -r build && pnpm -r lint` exit 0; webview panel opens in VS Code with placeholder content via real postMessage stubs; secret-scan reports zero matches; `no-key-in-webview` rule catches a deliberate violation in CI.

- [x] T001 Initialize pnpm monorepo at repo root: `pnpm-workspace.yaml`, root `package.json` with `workspaces ["packages/*"]`, `.npmrc`, `turbo.json` or `pnpm -r` scripts for build/lint/test -- **Verify**: `pnpm install` succeeds; `pnpm -r build` exits 0 (US1-US8, Principle XI)
- [x] T002 [P] Scaffold `packages/core/` with `tsconfig.json` (strict, no vscode path), `package.json` (@token-optimizer/core), `src/index.ts`, `vitest.config.ts` -- **Verify**: `pnpm --filter @token-optimizer/core build` exits 0; no vscode import (Principle X)
- [x] T003 [P] Scaffold `packages/extension/` with `tsconfig.json`, extension `package.json` (publisher, engines.vscode, activationEvents: onStartupFinished + onView:tokenOptimizer), `src/extension.ts` stub -- **Verify**: `vsce package --dry-run` exits 0 (US1, Principle XI)
- [x] T004 [P] Scaffold `packages/webview/` with Vite + React 18 + Tailwind CSS, `tsconfig.json`, `src/main.tsx`, `index.html` with nonce slot `{{NONCE}}` -- **Verify**: `pnpm --filter webview build` produces `dist/` with no inline scripts (Principle II, FR-004)
- [x] T005 [P] Scaffold `packages/catalog-api/` with Fastify 4 + TypeScript, `package.json`, `src/server.ts` stub, `tsconfig.json` -- **Verify**: `pnpm --filter catalog-api start` serves `/v1/health` 200 (FR-043)
- [x] T006 [P] Scaffold `packages/catalog-tools/` with `package.json`, `tsconfig.json`, `src/index.ts` -- **Verify**: `pnpm --filter catalog-tools build` exits 0 (Principle VII)
- [x] T007 [P] Scaffold `packages/fixtures/` with `package.json`, `tsconfig.json`, `projects/`, `profiles/`, `estimates/`, `artifacts/` directories and `README.md` -- **Verify**: directories exist; `pnpm --filter fixtures build` exits 0 (Principle IV)
- [x] T008 Write shared ESLint config `eslint.config.mjs`: TypeScript strict, `no-explicit-any` error, `no-restricted-imports` blocking `vscode` in `packages/core/**`, custom `no-key-in-webview` rule stub -- **Verify**: `pnpm -r lint` exits 0 on clean source; deliberate `import 'vscode'` in core fails lint (FR-004, Principle I)
- [x] T009 [P] Write custom ESLint rule `tools/eslint-rules/no-key-in-webview.js`: flag postMessage or logger calls whose argument chain contains variable named `key`, `secret`, `apiKey`, or `password`; unit test in `tools/eslint-rules/tests/` -- **Verify**: T017 test suite passes (FR-004, Principle I)
- [x] T010 [P] Write Semgrep patterns `tools/semgrep/secret-scan.yaml`: match `mongodb://`, `mongodb+srv://`, `password=`, `api_key=`, `sk-` literals in source and bundled files -- **Verify**: `semgrep --config tools/semgrep/secret-scan.yaml packages/` exits 0 on clean source; detects injected secret string (Principle III)
- [x] T011 Define Zod schemas for full webview message protocol in `packages/core/src/protocol/schemas.ts`: all message types from `contracts/webview-messages.ts`, HostToWebviewMsg and WebviewToHostMsg unions -- **Verify**: `z.parse` succeeds on all valid sample messages; throws on unknown message type (Principle II, FR-002)
- [x] T012 [P] Generate TypeScript types from protocol schemas in `packages/core/src/protocol/types.ts`; export from `packages/core/src/index.ts` with no vscode import -- **Verify**: `tsc --noEmit` exits 0; grep for `vscode` in core finds nothing (Principle X, Principle II)
- [x] T013 Implement `WebviewProvider` in `packages/extension/src/webview/WebviewProvider.ts`: CSP `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`; nonce injected into `index.html`; Zod-validates inbound messages; drops unknowns -- **Verify**: panel opens; DevTools shows correct CSP header; unknown message type is dropped silently (Principle II, FR-004)
- [x] T014 [P] Implement `MessageRouter` in `packages/extension/src/webview/MessageRouter.ts`: receives WebviewToHostMsg (Zod-validated), dispatches to handlers; `send(msg: HostToWebviewMsg)` validates outbound before posting -- **Verify**: unit test: valid message dispatches; invalid message does not dispatch and does not throw (Principle II)
- [x] T015 Implement webview shell in `packages/webview/src/`: data-driven views with typed postMessage bridge rendering loading states; responsive layout with VS Code theme CSS variables -- **Verify**: webview renders all tabs in loading/initial state; test suite asserts zero hard-coded API keys, MongoDB URLs, or untrusted URLs in bundle (US1-US8)
- [x] T016 [P] Write CI workflow `.github/workflows/ci.yml`: quality job (ESLint zero warnings, secret-scan, test:tools), test matrix (Ubuntu, Windows on Node 20), and package verification job -- **Verify**: CI passes on clean branch; deliberate lint violation causes CI failure (Principle III, Principle XI)
- [x] T017 Write `tools/eslint-rules/tests/no-key-in-webview.test.js`: assert catches `postMessage({ key })`, `router.send`, template literals, binaries, member expressions, and logger calls; passes `postMessage({ maskedKey })` -- **Verify**: `node --test tools/eslint-rules/tests/no-key-in-webview.test.js` or `pnpm run test:tools` exits 0 (T009 verification, FR-004, Principle I)
- [x] T018 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 0 artifacts; resolve all FAIL/WARN findings before proceeding to Slice 1 -- **Verify**: analyze report shows all checks PASS

---

## Slice 1 - Catalog

**Goal**: DB snapshot diff, idempotent migrations, catalog_meta versioning, read-only Catalog API with ETag, CatalogClient in core with ETag cache and bundled fallback, contract tests. Seed new models and pricing from maintainer-provided reviewed JSON.

**Independent Test**: `GET /v1/catalog` returns HTTP 200 with valid snapshot; second request with matching ETag returns 304; stopping the API uses bundled snapshot with "working offline" notice (FR-043-FR-046, quickstart Scenarios 1 and 2).

- [x] T019 Document field-by-field diff between `docs/db-snapshot/schema-summary.md` and `data-model.md`; write `packages/catalog-api/migrations/plan.md` listing all migration scripts needed -- **Verify**: plan.md lists at least 8 migration scripts with rationale (research Decision 4)
- [x] T020 [P] Write idempotent migration `packages/catalog-api/migrations/001-providers-schema.ts`: rename provider_id->id, display_name->label; add adapterType, baseUrl, listModelsEndpoint, keyFormatHint, enabled; retain originals as deprecated aliases; index on id -- **Verify**: migration runs twice with identical result; Provider Zod schema validates all rows (FR-002, data-model 2a)
- [x] T021 [P] Write idempotent migration `packages/catalog-api/migrations/002-models-schema.ts`: add id alias, providerId, maxOutput, tier, supportsCaching, supportsBatch, supportsStructuredOutput, tokenizer, status, addedAt; index on id+providerId -- **Verify**: migration idempotent; Model Zod schema validates all rows (FR-002, data-model 2b)
- [x] T022 [P] Write idempotent migration `packages/catalog-api/migrations/003-pricing-collection.ts`: create pricing collection; seed from embedded models.pricing; add effectiveFrom, sourceUrl, verifiedAt; index on modelId+effectiveFrom -- **Verify**: migration idempotent; every pricing row has sourceUrl and verifiedAt (FR-002, data-model 2c, Principle VII)
- [x] T023 [P] Write idempotent migration `packages/catalog-api/migrations/004-phases-schema.ts`: add track, defaultParams (callsLow/Expected/High, tokensPerCallLow/Expected/High, retriesLow/Expected/High, volumeMultiplierLow/Expected/High), paramHints, cacheablePrefix, archetypes; index on track -- **Verify**: migration idempotent; Phase Zod schema validates all rows (FR-017, FR-018, clarification Q1/Q2)
- [x] T024 [P] Write idempotent migration `packages/catalog-api/migrations/005-strategies-collection.ts`: create strategies collection with full Strategy document schema; indexes on id, reviewStatus, group, targets; add MongoDB JSON Schema validator -- **Verify**: migration idempotent; Strategy Zod schema validates all rows (FR-025, Principle VIII)
- [x] T025 [P] Write idempotent migration `packages/catalog-api/migrations/006-platforms-collection.ts`: create platforms collection; index on id; seed VS Code, Cursor, Windsurf, Antigravity stubs -- **Verify**: migration idempotent; 4 platform documents present (FR-034, data-model 2f)
- [x] T026 [P] Write idempotent migration `packages/catalog-api/migrations/007-prompt-templates-collection.ts`: create prompt_templates; index on purpose+active; seed stubs for enhance, profile-extract, apply-edit, preview -- **Verify**: migration idempotent; 4 template documents present (data-model 2g)
- [x] T027 [P] Write idempotent migration `packages/catalog-api/migrations/008-catalog-meta.ts`: create catalog_meta; insert `{version:1, publishedAt:now, schemaVersion:"1.0"}` if absent -- **Verify**: migration idempotent; exactly one document in catalog_meta (data-model 2h)
- [x] T028 Write migration runner `packages/catalog-tools/src/migrate.ts`: `--from N` runs scripts N+ in order; idempotent; `--dry-run` logs without writing -- **Verify**: `tsx migrate.ts --dry-run` logs all scripts; `tsx migrate.ts` runs and re-running is a no-op (research Decision 4)
- [x] T029 Implement Zod schemas for all catalog types in `packages/core/src/catalog/schemas.ts`: Provider, Model, Pricing, Phase, Strategy, Platform, PromptTemplate, CatalogMeta, CatalogSnapshot; export from core index -- **Verify**: `z.parse` succeeds on all seeded documents; throws on missing required field (FR-043)
- [x] T030 [P] Implement Catalog API routes in `packages/catalog-api/src/routes/`: GET /v1/catalog (full snapshot, ETag + Cache-Control), GET /v1/catalog/:collection (strategies filtered to reviewStatus=approved), GET /v1/health; Zod-validate every response -- **Verify**: contract tests T038 pass; /v1/catalog returns schema-valid snapshot (contracts/catalog-api.yaml, Principle VIII)
- [x] T031 [P] Implement ETag in `packages/catalog-api/src/db/etag.ts`: SHA-256 of version+publishedAt; return 304 on If-None-Match match; Cache-Control: public, max-age=3600 -- **Verify**: second identical request returns 304; changed version returns 200 with new ETag (FR-043)
- [x] T032 Implement `CatalogClient` in `packages/core/src/catalog/CatalogClient.ts`: fetch or 304 short-circuit; Zod-validates before caching; no globalState import (injected store) -- **Verify**: T039 unit tests pass (FR-043, FR-045, Principle X)
- [x] T033 [P] Implement `BundledSnapshotLoader` in `packages/core/src/catalog/BundledSnapshotLoader.ts`: injected `readFile: (path)=>Promise<string>`; parses and Zod-validates snapshot -- **Verify**: loads bundled catalog-snapshot.json; throws on invalid JSON (Principle X)
- [x] T034 [P] Implement `CatalogService` in `packages/extension/src/catalog/CatalogService.ts`: fetch on activate; 24h refresh; network failure uses globalState cache; no cache uses bundled snapshot; post catalog/updated with isOffline flag -- **Verify**: mock network failure -> bundled snapshot loaded -> `catalog/updated {isOffline:true}` posted (FR-043-FR-046)
- [x] T035 Write `packages/catalog-tools/src/seed.ts`: reads maintainer JSON {models, pricing}; Zod-validates; upserts; refuses rows lacking sourceUrl or verifiedAt -- **Verify**: valid JSON upserts succeed; row missing verifiedAt is rejected with clear error (Principle VII)
- [x] T036 [P] Write `packages/catalog-tools/src/validate.ts`: fetch all documents; run Zod schemas; print PASS/FAIL per document with field errors -- **Verify**: all seeded documents PASS; manually corrupted document shows field-level FAIL (Principle VII)
- [x] T037 [P] Write `packages/catalog-tools/src/publish.ts`: bump catalog_meta.version; `--snapshot` writes `packages/extension/resources/catalog-snapshot.json` -- **Verify**: version increments; snapshot file written; snapshot Zod-validates (research Decision 7)
- [x] T038 [P] Write contract tests `packages/catalog-api/tests/contract/`: Vitest against test Fastify + test MongoDB; assert response matches OpenAPI schema from `contracts/catalog-api.yaml` -- **Verify**: all contract tests pass in CI (Principle III)
- [x] T039 [P] Write CatalogClient unit tests `packages/core/tests/catalog/`: mock 200, 304, network error; assert caching, Zod rejection, 304 short-circuit -- **Verify**: all 3 scenarios pass (FR-043)
- [x] T040 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 1 artifacts; resolve all findings before proceeding to Slice 2 -- **Verify**: analyze report shows all checks PASS

---

## Slice 2 - Login and Keys

**Goal**: Platform detection, provider list from catalog, SecretStorage KeyService, key validation per adapter, model selection (list-models intersect catalog), Copilot pseudo-provider, settings view add/remove.

**Independent Test**: Enter valid key -> saved masked; enter invalid key -> clear error not stored; remove key -> deleted from SecretStorage; Copilot row appears when vscode.lm available; offline start uses fallback (US1, quickstart Scenario 3).

- [x] T041 Implement `PlatformDetector` in `packages/extension/src/platform/PlatformDetector.ts`: appName substrings, uriScheme, marker files; match against CatalogSnapshot.platforms[].detect; fall back to the catalog platform flagged `isDefault` (no hard-coded id) -- **Verify**: unit test: VS Code appName maps to "vscode" platform; unknown appName maps to the catalog default; a catalog with no default fails validation (FR-001, Principle VII, Principle X, research Decision 8)
- [x] T042 [P] Implement `KeyService` in `packages/extension/src/secrets/KeyService.ts`: store/get/delete/listConfigured; keyed `provider:{id}:{slot}`; get() returns getter closure, never raw string; sole caller of context.secrets -- **Verify**: T054 unit tests pass; get() return type is `() => Promise<string>` never `string` (FR-004, FR-005, FR-006, Principle I)
- [x] T043 [P] Define provider adapter interface in `packages/core/src/providers/ProviderAdapter.ts`: validateKey, listModels, countTokens?, complete(messages, {schema?,maxTokens,signal}) with retry/backoff and AbortSignal -- **Verify**: `tsc --noEmit` on all adapters exits 0; interface in core with no vscode import (FR-003, Principle X)
- [x] T044 [P] Implement `AnthropicAdapter` in `packages/core/src/providers/AnthropicAdapter.ts`: validate via GET /v1/models; countTokens via POST /v1/messages/count_tokens; streaming complete; 3-retry exponential backoff -- **Verify**: unit test with mock HTTP: valid key returns model list; invalid key returns {valid:false}; retry fires on 429 (FR-003, FR-023)
- [x] T045 [P] Implement `OpenAIAdapter` in `packages/core/src/providers/OpenAIAdapter.ts`: validate via models list; tiktoken lazy WASM for token count; streaming complete; 3-retry backoff -- **Verify**: unit test: valid key; tiktoken `encode("hello").length > 0`; retry on 429 (FR-003, FR-023)
- [x] T046 [P] Implement `GoogleAdapter` in `packages/core/src/providers/GoogleAdapter.ts`: validate via models list; countTokens via API endpoint; streaming complete; 3-retry backoff -- **Verify**: unit test: valid key returns model list; countTokens returns numeric count (FR-003, FR-023)
- [x] T047 [P] Implement `MistralAdapter` in `packages/core/src/providers/MistralAdapter.ts`: validate via models list; char-approx token count labelled "approximate 15pct"; streaming complete; 3-retry backoff -- **Verify**: unit test: countTokens label is "approximate"; margin field set (FR-003, FR-023)
- [x] T048 [P] Implement `OpenAICompatibleAdapter` in `packages/core/src/providers/OpenAICompatibleAdapter.ts`: configurable baseUrl; same interface as OpenAI; char-approx token count -- **Verify**: unit test: baseUrl injected at construction; validate uses injected baseUrl (FR-003)
- [x] T049 Implement `HostLmAdapter` in `packages/extension/src/lm/HostLmAdapter.ts` (replaces CopilotAdapter): for a catalog provider with `adapterType: "host-lm"`, call `vscode.lm.selectChatModels(provider.hostLm)` (vendor and family from the catalog) for the model list; complete via `sendRequest` with a CancellationToken; no key; disabled when the API is missing, returns zero models, or consent is declined -- **Verify**: `vscode.lm` undefined -> adapter disabled; the selector passed to `selectChatModels` deep-equals the catalog `hostLm`; no vendor or family literal in extension source (FR-007, FR-055, Principle VII)
- [x] T050 Implement `KeyValidationService` in `packages/extension/src/secrets/KeyValidationService.ts`: calls adapter.validateKey(getter); success stores + posts auth/keySaved; unreachable posts auth/keyError "unreachable"; invalid posts "invalid"; key never stored on failure -- **Verify**: T055 unit tests pass; on invalid key context.secrets.store not called (FR-003, FR-005)
- [x] T051 [P] Implement `ModelSelectionService` in `packages/extension/src/secrets/ModelSelectionService.ts`: getSelectableModels(providerId) returns adapter.listModels() intersect CatalogSnapshot.models; handles list-models unavailable -- **Verify**: intersection excludes catalog-unknown models; empty intersection returns empty array without error (FR-002, US1)
- [x] T052 Implement auth handlers `packages/extension/src/webview/handlers/AuthHandlers.ts`: auth/saveKey clears raw key immediately after validation dispatch; auth/removeKey; auth/setEnabledModels; on panel open post auth/state with masked keys and copilotAvailable -- **Verify**: auth/state contains no raw keys; auth/removeKey calls KeyService.delete() (FR-004, FR-005, FR-006, Principle I)
- [x] T053 [P] Implement Login and Settings views `packages/webview/src/views/Login.tsx` and `Settings.tsx`: provider list from catalog; key input clears on submit; masked display; error display; model multi-select; remove key button; host-lm provider row shown only when its adapter is available -- **Verify**: manual check: enter key -> masked after save; host-lm row absent when its adapter is unavailable (US1, FR-001-FR-007)
- [x] T054 [P] Write KeyService unit tests `packages/extension/tests/secrets/KeyService.test.ts`: mock context.secrets; getter returns key; list() omits raw values; delete() removes from storage -- **Verify**: all 4 scenarios pass (Principle I)
- [x] T055 [P] Write KeyValidationService unit tests `packages/extension/tests/secrets/KeyValidationService.test.ts`: mock adapter valid/invalid/unreachable; correct message posted; key not stored on failure -- **Verify**: all 3 adapter states covered (FR-003, FR-005)
- [x] T056 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 2 artifacts; resolve all findings before proceeding to Slice 3 -- **Verify**: analyze report shows all checks PASS

---

## Slice 3 - Enhance

**Goal**: Prompt templates from catalog, adapters.complete with structured output and repair, workspace scan pre-fill, version history/diff, cost display, fixed keyboard behavior.

**Independent Test**: Ctrl+Enter with description -> LLM streams -> narrative + valid ProjectProfile shown + cost displayed; Enter inserts newline; re-run refines without duplicating sections; version history diff works; malformed JSON triggers one repair then clear error (US2, quickstart Scenario 4).

- [x] T057 Implement ProjectProfile Zod schema `packages/core/src/profile/schema.ts` matching `contracts/project-profile.schema.json`; export ProjectProfile and ProfileHistoryEntry types -- **Verify**: `z.parse` succeeds on all example profiles in contracts/; `tsc --noEmit` exits 0 (FR-010, data-model 1)
- [x] T058 [P] Implement workspace pre-fill scanner `packages/extension/src/workspace/WorkspaceScanner.ts`: scan for package.json, requirements.txt, pyproject.toml, go.mod, README.md; return pre-fill draft; handle no-workspace gracefully -- **Verify**: mock workspace with package.json -> draft contains framework name; no workspace -> empty draft, no error (FR-009)
- [x] T059 Implement `EnhanceService` in `packages/extension/src/enhance/EnhanceService.ts`: select catalog prompt template by purpose="enhance"; call adapter complete; stream enhance/stream deltas; parse {narrative,profile} with Zod; one repair attempt on failure; record inputTokens, outputTokens, costUsd; post enhance/result -- **Verify**: T064 unit tests pass; on double malformed JSON second attempt is not made (FR-010-FR-013)
- [x] T060 [P] Implement `ProfileHistoryStore` in `packages/extension/src/enhance/ProfileHistoryStore.ts`: add/getAll/getVersion/markFinal; stored in workspaceState; max 20 versions -- **Verify**: T065 unit tests pass (FR-014, FR-015)
- [x] T061 [P] Implement enhance/finalize handler: set finalizedAt in ProfileHistoryStore; post enhance/profileFinalized; enable Estimate tab in webview -- **Verify**: webview Estimate tab becomes active after enhance/profileFinalized message (FR-015)
- [x] T062 [P] Implement `CostCalculator` in `packages/core/src/providers/CostCalculator.ts`: computeCost(inputTokens, outputTokens, pricing): CostRange using inputPerMTok/outputPerMTok -- **Verify**: unit test: 1M input tokens x inputPerMTok = correct USD; zero tokens = zero cost (FR-012)
- [x] T063 Implement Enhance view `packages/webview/src/views/Enhance.tsx`: textarea (Enter=newline, Ctrl/Cmd+Enter=submit); pre-fill as editable draft; streaming narrative; Profile JSON viewer; cost badge; version history sidebar with two-version diff; Mark as final button -- **Verify**: manual check: Enter does not submit; Ctrl+Enter submits; cost badge appears after stream; diff shows between two versions (US2, FR-009, FR-012, FR-015, FR-016)
- [x] T064 [P] Write EnhanceService unit tests `packages/extension/tests/enhance/EnhanceService.test.ts`: valid JSON response; malformed then repaired; one repair attempt only; previous version preserved on double failure; cost recorded -- **Verify**: all 4 scenarios pass (FR-010, FR-013)
- [x] T065 [P] Write ProfileHistoryStore unit tests `packages/extension/tests/enhance/ProfileHistoryStore.test.ts`: version increment; finalize sets timestamp; max-20 eviction -- **Verify**: all 3 scenarios pass (FR-014)
- [x] T066 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 3 artifacts; resolve all findings before proceeding to Slice 4 -- **Verify**: analyze report shows all checks PASS

---

## Slice 4 - Estimation

**Goal**: PhaseResolver (confirmed profile phases + catalog defaults), tokenizer layer, estimation engine with ranges and explain tree, editable assumptions, per-model comparison UI, property and golden tests.

**Independent Test**: Golden profile + catalog -> numbers match golden fixture exactly; edit assumption -> update under 50ms; Explain popover shows formula + inputs per number; RUNTIME shows per-request/per-user-day/per-month (US3, quickstart Scenarios 5 and 10).

- [x] T067 Implement `PhaseResolver` in `packages/core/src/phases/PhaseResolver.ts`: resolve(profile.phases, catalogPhases): ResolvedPhase[]; validates each confirmed phase's `phaseTypeId` and `track` against the catalog taxonomy, attaches catalog `defaultParams` and `description`, sorts by track then `sortOrder`; typed error on unknown type or unconfirmed phase; pure function, no LLM -- **Verify**: same inputs produce byte-identical output; unknown `phaseTypeId` -> typed error; unconfirmed phase rejected (FR-017, FR-052, Principle IV)
- [x] T068 [P] Implement `TokenizerLayer` in `packages/core/src/estimation/TokenizerLayer.ts`: getTokenizer(model) returns count(text): {count, label, margin?}; tiktoken lazy WASM via injected loader for GPT/O-series; Anthropic/Google endpoint via injected getter; char-approx ceil(chars/4) with margin "+-15%" fallback -- **Verify**: GPT-4 tokenizer returns label:"exact"; Mistral returns label:"approximate" with margin field (FR-023, clarification Q4)
- [x] T069 Implement `EstimationEngine` in `packages/core/src/estimation/EstimationEngine.ts`: pure estimate(profile, catalog, overrides?); phases come from `profile.phases` via `PhaseResolver` (T067); per phase per model: tokens = calls x (inputTokens + outputTokens) x (1 + retryRate) x iterations; RUNTIME x requestsPerDay x monthlyDays; cached-input reduction when supportsCaching; low/expected/high from defaultParams merged with overrides; cost via active pricing (latest effectiveFrom <= now); ExplainNode tree per number; returns EstimationResult -- **Verify**: T075 golden tests pass; T076 property tests pass (FR-017-FR-022, Principle IV)
- [x] T070 [P] Implement `SavingsAggregator` in `packages/core/src/strategies/SavingsAggregator.ts`: combine(strategies, track): multiplicative 1 - prod(1 - s/100) for min and max separately; return SavingsRange -- **Verify**: T089 unit tests pass; two 50% strategies yield ~75% not 100% (FR-029, Principle V)
- [x] T071 [P] Implement `ParamResolver` in `packages/core/src/estimation/ParamResolver.ts`: resolve(defaultParams, override?): merge user overrides; validate low <= expected <= high -- **Verify**: unit test: override respected; invalid range (low > high) throws descriptive error (FR-020, clarification Q2)
- [x] T072 Implement estimate/request handler `packages/extension/src/estimation/EstimationHandler.ts`: receive message, call EstimationEngine.estimate(), post estimate/result; log if >50ms -- **Verify**: estimation completes and result posted; timing log present when >50ms (FR-019, SC-003)
- [x] T073 [P] Implement Estimate view `packages/webview/src/views/Estimate.tsx`: BUILD/RUNTIME tabs; phase list; assumption editors (calls, tokensPerCall, retries, volumeMultiplier) with immediate recompute; per-model cost columns (low/expected/high); cached-input column when applicable; Explain button per number; model-comparison table; "pricing verified <date>" label -- **Verify**: manual check: edit assumption -> numbers update without page reload; Explain button opens popover (US3, FR-018-FR-024)
- [x] T074 [P] Implement `ExplainPopover` component `packages/webview/src/components/ExplainPopover.tsx`: recursive ExplainNode tree; formula, inputs, result per node -- **Verify**: every leaf node shows formula string; root node total matches EstimationResult.total (FR-022)
- [x] T075 Write golden-file tests `packages/core/tests/estimation/golden.test.ts`: for each fixture in `packages/fixtures/estimates/`, call estimate(), assert deep-equal; fail with diff on mismatch -- **Verify**: tests pass on seeded fixtures; changing a phase param causes test to fail with clear diff (FR-019, Principle IV)
- [x] T076 [P] Write property tests `packages/core/tests/estimation/properties.test.ts` with fast-check: (a) monotonicity - doubling calls never decreases cost; (b) determinism - same inputs same output; (c) sum of phases = track total -- **Verify**: 500 random inputs pass all 3 properties (FR-019, Principle IV)
- [x] T077 [P] Seed `packages/fixtures/profiles/ts-rag-chatbot.json` (with confirmed `phases`) and `packages/fixtures/estimates/ts-rag-chatbot.json` golden files -- **Verify**: golden test T075 passes against this fixture (quickstart Scenario 10)
- [x] T078 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 4 artifacts; resolve all findings before proceeding to Slice 5 -- **Verify**: analyze report shows all checks PASS

---

## Slice 5 - Strategies

**Goal**: Strategy schema, authoring tool (LLM drafts -> draft status -> review report -> approved), applicability engine, conflicts/requires, combined-savings math, selection UI, "i" panel with real-tokenizer previews and optional LLM preview.

**Independent Test**: Known profile -> correct strategies pre-selected with reasons; select conflicting pair -> UI blocks it; savings shows multiplicative range; info panel shows before/after token count without LLM for non-transform strategies (US4, US5, quickstart Scenario 6).

- [ ] T079 Write `packages/catalog-tools/src/draft-strategies.ts`: for each entry in optimizer_rules or a provided name list, call LLM with Strategy schema to generate implementation fields; write to strategies with reviewStatus="draft"; never set "approved" -- **Verify**: draft strategies written with reviewStatus="draft"; no strategy has reviewStatus="approved" after this script (FR-025, Principle VIII)
- [ ] T080 [P] Write `packages/catalog-tools/src/review-report.ts`: query all reviewStatus="draft" strategies; output human-verification checklist per strategy to `catalog-tools/reports/review-<date>.md` -- **Verify**: report contains one checklist entry per draft strategy; file written to reports/ (Principle VIII)
- [ ] T081 Implement `ApplicabilityEvaluator` in `packages/core/src/strategies/ApplicabilityEvaluator.ts`: evaluate(predicate, profile): boolean; recursive all/any/not/eq/neq/gte/lte/includes operators; dot-notation path traversal over profile -- **Verify**: T088 unit tests pass; unknown operator throws descriptive error (FR-026)
- [ ] T082 [P] Implement `ConflictResolver` in `packages/core/src/strategies/ConflictResolver.ts`: resolve(selected, strategies): ConflictResult; bidirectional conflict check and requires validation; return {valid, conflicts:[{a,b,explanation}], unsatisfied} -- **Verify**: unit test: conflicting pair -> valid=false; unsatisfied requires -> unsatisfied list populated (FR-028)
- [ ] T083 [P] Implement `StrategyEngine` in `packages/core/src/strategies/StrategyEngine.ts`: getApplicable, preSelect with reasonTemplate, resolveConflicts, computeSavings per track -- **Verify**: unit test: known profile + strategies -> expected pre-selected set; savings uses SavingsAggregator (FR-025-FR-029)
- [ ] T084 [P] Implement strategy handlers `packages/extension/src/strategies/StrategyHandlers.ts`: on estimation complete post strategy/selection with pre-selected ids + conflicts; handle strategy/set, re-run resolver + aggregator, post strategy/savingsUpdate -- **Verify**: mock estimation complete -> strategy/selection posted; toggling a strategy posts updated savings (FR-025-FR-029)
- [ ] T085 Implement Strategy tab in `packages/webview/src/views/Optimize.tsx` (Strategies): grouped cards by group field; checkbox; pre-selection reason chip; conflict highlight with explanation tooltip; live savings panel (BUILD + RUNTIME range + basis); deselect updates immediately -- **Verify**: manual check: conflicting pair shows conflict badge; savings panel updates without page reload (US4, FR-025-FR-029)
- [ ] T086 [P] Implement `StrategyDetailPanel` in `packages/webview/src/components/StrategyDetailPanel.tsx`: description, preconditions, savings basis + source, risks; try-it textarea; non-transform: before/after token count via host; transform: cost estimate shown before Run with LLM, awaits confirm -- **Verify**: manual check: pasting text shows before/after token count; "Run with LLM" button disabled until cost shown (US5, FR-030-FR-032, SC-010)
- [ ] T087 [P] Implement strategy/preview handler `packages/extension/src/strategies/StrategyPreviewHandler.ts`: count tokens on original and preview-transformed text via TokenizerLayer; LLM-transform strategies compute cost estimate before calling adapter -- **Verify**: non-transform strategy -> no LLM call; cost estimate message posted before any adapter.complete() for transform strategy (FR-031, FR-032)
- [ ] T088 [P] Write ApplicabilityEvaluator unit tests `packages/core/tests/strategies/applicability.test.ts`: 10+ predicate trees covering all operator types -- **Verify**: all 10+ trees evaluate to expected boolean (FR-026)
- [ ] T089 [P] Write SavingsAggregator unit tests `packages/core/tests/strategies/savings.test.ts`: multiplicative composition; min/max computed separately; empty = 0% -- **Verify**: two 50% strategies -> ~75%; empty list -> 0% (FR-029, Principle V)
- [ ] T090 Seed at least 5 approved strategies into catalog with full documents: prompt-efficiency (1), caching (1), model-strategy (1), batching (1), build-practices (1); each with applicability predicate, savings range with basis, TS/JS detection rules -- **Verify**: `GET /v1/catalog/strategies` returns exactly 5 approved strategies; each has basis field (Principle VII, Principle VIII)
- [ ] T091 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 5 artifacts; resolve all findings before proceeding to Slice 6 -- **Verify**: analyze report shows all checks PASS

---

## Slice 6 - Implement: Install route (skills, files, instructions)

**Goal**: Artifact templates, platform renderers from catalog, diff-before-overwrite, baseline capture, audit command.

**Independent Test**: Install creates `.ai-optimizer/` tree per quickstart Scenario 7; edit file and re-run -> diff view shown; checkpoint stash created; platform-native file at catalog-declared path not hard-coded; audit produces before/after report (US6, FR-033-FR-036, SC-008).

- [ ] T092 Write Handlebars artifact templates `packages/core/src/artifacts/templates/`: optimizer.yaml.hbs, architecture.md.hbs, requirements.md.hbs, constraints.md.hbs, profile.json.hbs, strategy.md.hbs, analyse.md.hbs, optimise.md.hbs, implement.md.hbs, audit.md.hbs -- **Verify**: each template renders without error on ts-rag-chatbot profile fixture; no hard-coded file paths in template output (FR-033)
- [ ] T093 Implement `ArtifactRenderer` in `packages/core/src/artifacts/ArtifactRenderer.ts`: render(profile, catalog, strategies, platform): ArtifactSet; maps templates to paths and content; platform-native files from platform.artifactTargets; returns {path, content, checksum}[]; pure function, no FS -- **Verify**: T098 golden tests pass; no fs import in file (FR-033, FR-034, Principle X)
- [ ] T094 Implement `FileGenerationService` in `packages/extension/src/workspace/FileGenerationService.ts`: call ArtifactRenderer.render(); build the review list of files to create or change; hash-check existing files; CheckpointService.create() before any write, even when every file is new; vscode.diff for conflicts; apply all confirmed files as ONE vscode.WorkspaceEdit (createFile, insert, replace), not individual fs writes; post optimize/generateComplete -- **Verify**: T099 integration test passes; existing file triggers diff before write; applyEdit called once; one undo removes every created file (FR-033-FR-036)
- [ ] T095 [P] Implement `CheckpointService` in `packages/extension/src/workspace/CheckpointService.ts`: detect .git/HEAD; git repo: stash with "token-optimizer: pre-apply checkpoint <ISO>"; no git: backup to .ai-optimizer/backups/<ISO>/; store Checkpoint in workspaceState; rollback(id) reverses stash or restores backup -- **Verify**: git repo -> stash created with correct message; no git -> backup dir written (FR-036, Principle VI)
- [ ] T096 [P] Implement baseline capture `packages/extension/src/workspace/BaselineService.ts`: write .ai-optimizer/baseline.json with catalog version, profile version, per-phase token estimates, detected LLM call-site paths -- **Verify**: baseline.json written; fields match current EstimationResult (FR-042)
- [ ] T097 [P] Implement `AuditCommand` in `packages/extension/src/commands/AuditCommand.ts`: re-scan workspace; count tokens via TokenizerLayer; compare with baseline.json; output before/after per call site and total delta to VS Code Output channel -- **Verify**: audit output appears in Output channel; delta matches expected difference (FR-042)
- [ ] T098 [P] Write ArtifactRenderer golden tests `packages/core/tests/artifacts/renderer.test.ts`: render against fixtures/profiles/ts-rag-chatbot.json + test catalog; assert matches fixtures/artifacts/ts-rag-chatbot/ byte-for-byte -- **Verify**: test passes; changing one template value causes test failure (FR-033, SC-008)
- [ ] T099 Write FileGenerationService integration test `packages/extension/tests/workspace/FileGenerationService.test.ts`: mock vscode.workspace.applyEdit, vscode.diff, confirm dialog; assert diff shown for existing files; write only after confirm; checkpoint before write -- **Verify**: all 3 assertions pass (FR-035, FR-036, Principle VI)
- [ ] T100 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 6 artifacts; resolve all findings before proceeding to Slice 7 -- **Verify**: analyze report shows all checks PASS

---

## Slice 7 - Implement: IDE agent route (host model API)

**Goal**: Scanner (TS/JS and Python), planner, validator, diff review with per-hunk accept, checkpointing, single WorkspaceEdit, host language-model backend (no user-keyed providers for this step), cancellation, post-apply audit.

**Independent Test**: On fixtures/projects/ts-rag-chatbot/ scanner finds known call sites; proposals are structured JSON; diff view shows per-hunk controls; accept all -> one WorkspaceEdit applied; Ctrl+Z reverts all; cancel at scan -> no files changed; stale anchor skipped with message (US7, quickstart Scenario 8).

- [ ] T101 Implement workspace scanner for the IDE agent route `packages/extension/src/scanner/WorkspaceScanner.ts`: walk files filtered to .ts, .js, .mjs, .cjs, .py; skip >500KB; skip node_modules/, .venv/, dist/, build/; apply each strategy detection rules; collect matches; report skipped files -- **Verify**: fixture scan finds expected matches; 501KB file skipped with log entry (FR-037, clarification Q3)
- [ ] T102 [P] Implement `AstScanner` in `packages/extension/src/scanner/AstScanner.ts`: lazy-load tree-sitter WASM from globalStorageUri; parse TS/JS with tree-sitter-typescript; parse Python with tree-sitter-python; execute S-expression queries from strategy.detection[].query -- **Verify**: fixture TS file with known LLM call -> query returns expected match node (FR-037, research Decision 5)
- [ ] T103 [P] Implement `RegexScanner` in `packages/extension/src/scanner/RegexScanner.ts`: apply detection[].query as regex per file; return match ranges and captures -- **Verify**: unit test: known pattern in fixture file -> match returned with line/col (FR-037)
- [ ] T104 Implement `ApplyPlanner` in `packages/extension/src/apply/ApplyPlanner.ts`: for each scan match send the strategy's `implementation.applyPrompt` plus the matched snippet to `HostLmAdapter` (T049) after `PromptPreviewService` confirmation; require JSON that passes the EditProposal Zod schema; reject free-form or code-fenced replies (no regex clean-up); skip on failure with a log entry -- **Verify**: mock host model returns valid EditProposal -> proposal list populated; fenced or malformed reply -> skipped, not thrown; no model name, vendor or strategy text in source (FR-038, FR-047, FR-055, Principle VII)
- [ ] T105 [P] Implement `ApplyValidator` in `packages/extension/src/apply/ApplyValidator.ts`: SHA-256 anchor hash match; stale: anchorMatched=false; syntax-check replacement via typescript.transpileModule; verify file within workspace bounds -- **Verify**: T113 unit tests pass; stale anchor -> proposal marked stale, not applied (FR-039)
- [ ] T106 Implement `DiffReviewService` in `packages/extension/src/workspace/DiffReviewService.ts`: group proposals by file; open vscode.diff for each; track per-hunk accept/reject state; collect acceptedProposalIds -- **Verify**: mock vscode.diff called once per affected file; reject all -> empty acceptedProposalIds (FR-039, Principle VI)
- [ ] T107 Implement `WorkspaceEditApplier` in `packages/extension/src/workspace/WorkspaceEditApplier.ts`: CheckpointService.create(affectedFiles); re-run `ApplyValidator` on the current file contents and send stale hunks back to review; build single vscode.WorkspaceEdit; apply accepted TextEdit.replace edits; vscode.workspace.applyEdit(edit); post optimize/apply/complete -- **Verify**: T114 integration test passes; applyEdit called exactly once with all accepted edits (FR-040, FR-036, Principle VI)
- [ ] T108 [P] Implement cancellation `packages/extension/src/apply/CancellationManager.ts`: shared CancellationTokenSource; each stage checks token; on cancel dispose and post no messages; workspace unchanged -- **Verify**: cancel during scan -> applyEdit never called; workspace state unchanged (FR-041, SC-009)
- [ ] T109 [P] Implement `ApplyProgressReporter` in `packages/extension/src/apply/ApplyProgressReporter.ts`: vscode.window.withProgress wrapper; reports stage + file count; posts optimize/apply/progress to webview -- **Verify**: progress bar appears during scan; webview receives progress messages (US7)
- [ ] T110 Implement `ApplyOrchestrator` in `packages/extension/src/apply/ApplyOrchestrator.ts`: receives `optimize/implement/start` with route `ide-agent`; runs Scanner -> Planner -> Validator -> DiffReview -> Applier; checks cancellation at each step; on error posts progress message and halts -- **Verify**: end-to-end with fixture: all stages complete in order; error in Planner halts before DiffReview (US7, FR-037-FR-041)
- [ ] T111 [P] Implement the Implement screen `packages/webview/src/views/Optimize.tsx` (Implement tab): two-route chooser (Install, IDE agent), shown mechanism from `optimize/implement/plan`, host model picker for lm-edit, progress display (stage + count), proposal summary, post-run audit button -- **Verify**: manual check: buttons enabled only when strategies are selected; progress updates during the IDE agent route; chosen mechanism is displayed (FR-054, FR-055, US6, US7)
- [ ] T112 [P] Write scanner unit tests `packages/extension/tests/scanner/`: fixture TS and Python files with known LLM call patterns; assert correct matches; assert size-threshold skip -- **Verify**: all match assertions pass; 501KB file skipped (FR-037)
- [ ] T113 [P] Write ApplyValidator unit tests `packages/extension/tests/apply/ApplyValidator.test.ts`: anchor match found; anchor stale; replacement outside workspace -- **Verify**: all 3 cases return expected result (FR-039)
- [ ] T114 Write WorkspaceEditApplier integration test `packages/extension/tests/apply/WorkspaceEditApplier.test.ts`: mock vscode.workspace.applyEdit; assert called once with all accepted edits; CheckpointService.create called before applyEdit -- **Verify**: all 2 assertions pass (FR-040, Principle VI)
- [ ] T115 Seed `packages/fixtures/projects/ts-rag-chatbot/` with TypeScript source files containing at least 3 detectable LLM call patterns matching 2 approved strategies -- **Verify**: scanner T112 test finds 3+ matches across seeded files (quickstart Scenario 8)
- [ ] T116 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 7 artifacts; resolve all findings before proceeding to Slice 8 -- **Verify**: analyze report shows all checks PASS

---

## Slice 8 - Hardening

**Goal**: Privacy mode and "what will be sent" preview, redaction, offline behavior, telemetry opt-in, accessibility, packaging for Marketplace and Open VSX, multi-fork smoke tests, docs.

**Independent Test**: Telemetry default off -> zero events; Copilot-only mode -> zero external provider calls; secrets in prompt redacted in preview; vsce package + ovsx publish --dry-run succeed; VSIX installs and panel opens on VS Code stable and one fork in CI (FR-047-FR-049, SC-005, quickstart Scenarios 2 and 9).

- [ ] T117 Implement `PromptPreviewService` in `packages/extension/src/privacy/PromptPreviewService.ts`: before any LLM call assemble full payload; run RedactionService.redact(); post redacted payload to webview as preview message; await user confirm or cancel before dispatching -- **Verify**: preview message arrives before any adapter.complete() call; cancel -> adapter.complete() never called (FR-047, Principle IX)
- [ ] T118 [P] Implement `RedactionService` in `packages/core/src/privacy/RedactionService.ts`: regex patterns for API key formats (Anthropic/OpenAI/Google/GitHub), password=value, connection strings, JWT tokens; replace with [REDACTED:<type>]; enabled by default; per-session toggle in workspaceState -- **Verify**: T125 unit tests pass; toggle-off -> raw value passes through (FR-048, clarification Q5)
- [ ] T119 [P] Implement `CopilotOnlyMode` in `packages/extension/src/lm/CopilotOnlyMode.ts`: when enabled, all adapter.complete() routes through HostLmAdapter; direct provider calls throw; stored in workspaceState; reflected in auth/state -- **Verify**: enable mode -> AnthropicAdapter.complete() never called; HostLmAdapter.complete() called instead (FR-049, clarification Q5)
- [ ] T120 [P] Implement prompt preview UI `packages/webview/src/components/PromptPreview.tsx`: modal with redacted payload; Send and Cancel buttons; "Disable redaction for this session" toggle -- **Verify**: manual check: modal appears before each LLM call; Cancel prevents call; toggle visible (FR-047, FR-048)
- [ ] T121 [P] Implement `TelemetryService` in `packages/extension/src/telemetry/TelemetryService.ts`: opt-in only (tokenOptimizer.telemetry.enabled setting, default false); events enhance.run, estimate.view, optimize.generate, optimize.apply.complete with no prompt/code/key content; gate on enabled===true -- **Verify**: T124 unit tests pass; disabled by default in fresh install (Principle IX)
- [ ] T122 [P] Accessibility audit across all webview views: ARIA labels on all interactive elements, focus rings, keyboard navigation, color contrast >=4.5:1 WCAG 2.1 AA in `packages/webview/src/` -- **Verify**: axe-core scan reports 0 critical violations; manual keyboard navigation reaches all controls (US1-US8)
- [ ] T123 Write e2e fixture runner `packages/fixtures/src/e2e.ts`: mock LLM -> Enhance -> assert golden -> Estimate -> assert golden -> Install -> assert tree -> IDE agent route -> assert proposals -> accept all -> verify patches; run via `pnpm --filter fixtures e2e` -- **Verify**: `pnpm --filter fixtures e2e` exits 0 on CI; cancel-at-scan scenario leaves workspace unchanged (quickstart Scenario 10, SC-003, SC-004, SC-009)
- [ ] T124 [P] Write TelemetryService unit test `packages/extension/tests/telemetry/TelemetryService.test.ts`: zero events when disabled; events fired when enabled; no prompt/key content in any event payload -- **Verify**: all 3 assertions pass (Principle IX)
- [ ] T125 [P] Write RedactionService unit tests `packages/core/tests/privacy/RedactionService.test.ts`: corpus with API keys, passwords, JWTs; assert each replaced with [REDACTED]; clean strings unchanged -- **Verify**: all pattern types produce [REDACTED]; clean string unchanged (FR-048)
- [ ] T126 Add vsce package and ovsx publish --dry-run to CI; VSIX artifact upload; smoke test job: install VSIX via --extensionDevelopmentPath, assert Token Optimizer panel opens -- **Verify**: CI artifact contains .vsix; smoke test job exits 0 (Principle III)
- [ ] T127 [P] Add fork smoke test job to CI: install VSIX into Cursor or Windsurf; assert panel opens and catalog loaded; continue-on-error: true -- **Verify**: job runs; panel open assertion logged (US1, Principle III)
- [ ] T128 [P] Write user-facing docs: `docs/getting-started.md`, `docs/catalog-authoring.md` (draft -> review -> approve workflow), `docs/privacy.md` (key storage, redaction, Copilot-only mode) -- **Verify**: all 3 files present; each contains correct section headings per outline (FR-047-FR-049)
- [ ] T129 [P] Write `CONTRIBUTING.md`: pnpm setup, build commands, adding models via seed.ts, authoring strategies, running tests, CI requirements -- **Verify**: file present; `pnpm install && pnpm -r build` instructions are accurate and runnable (Principle XI)
- [ ] T130 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 8 and full codebase; confirm all 12 constitution principles verified by stated mechanisms; resolve all findings -- **Verify**: analyze report shows all 12 constitution principles PASS; zero unresolved findings

---

## Additions from v1 scope validation (2026-10-08)

> Added after checking the spec set against the v1 brief. Existing task IDs are unchanged so the analyze report's references stay valid. Each task names the slice it belongs to and must be done before that slice's analyze gate.

### Decision (resolved 2026-10-08)

API keys stay on the device (SecretStorage); on a new device the user re-enters them. Non-secret setup is persisted on-device in `globalState`. Providers, models, platforms, pricing, phase taxonomy, strategies and prompt templates are listed from the catalog (MongoDB behind the read-only API); nothing that can change is hard-coded. No accounts and no server-side user data in v1. The previous option list (OPEN-001) is closed.

### Slice 2 additions (Login and Keys)

- [ ] T131 Implement `UserSetupStore` in `packages/core/src/setup/UserSetupStore.ts` (interface with injected backend) and the extension implementation in `packages/extension/src/setup/`: persist and restore (in `globalState`) platformId, enabled models per provider, Enhance model, copilotOnly; never key values -- **Verify**: unit test: save, reload, identical `UserSetup`; JSON of stored object contains no key-shaped string; relaunch skips onboarding when setup is complete (FR-050, US1 scenario 8, Principle I)
- [ ] T132 Add platform selector and Enhance-model picker: handlers for `auth/setPlatform` and `auth/setEnhanceModel` in `AuthHandlers.ts`; `Login.tsx` and `Settings.tsx` list `CatalogSnapshot.platforms`, pre-select the `PlatformDetector` result, allow override; `auth/state` reports `platformOverridden` and `enhanceModel` -- **Verify**: manual check: detected platform pre-selected, override persists across restart; unit test: unknown platformId rejected (FR-001, FR-050, US1)

### Slice 3 additions (Enhance)

- [x] T133 Implement phases in Enhance: add `phases` (ConfirmedPhase) to the Zod profile schema (T057); update the seeded `enhance` prompt template (T026) to propose BUILD and RUNTIME phases using only phase type ids that are passed into the prompt from the catalog taxonomy; `EnhanceService` (T059) validates them and falls back to `PhaseSuggester` (T147) when none are usable; `Enhance.tsx` shows an editable phase table (add, remove, rename, retype, confirm) -- **Verify**: fixture response with an unknown type id is rejected and replaced by suggestions; editing phases makes zero adapter calls; finalising with no phases or an unconfirmed phase is refused (FR-052, US2 scenarios 8 to 11, Principle IV)

### Slice 4 additions (Estimation)

- [x] T134 Add `description` to phases: migration 004 (T023) adds the field and seeds text for every existing phase; Zod schema requires it; `Estimate.tsx` shows it on each phase row -- **Verify**: `catalog-tools validate` fails on a phase with no description; manual check: description visible per phase (FR-018, US3)
- [x] T135 Extend the model-comparison table in `Estimate.tsx`: per enabled model show active input and output price per million tokens, pricing-verified date, and per-track totals; models with no cached price show "no cached pricing data" -- **Verify**: component test: table values equal the pricing fixture; every figure has an Explain control (FR-024, FR-022, edge case "pricing without cached rate")

### Slice 5 additions (Strategies)

- [ ] T136 Add `notPreselected` to `StrategyEngine` output and `strategy/selection`: for each approved strategy not pre-selected return the failed predicate in plain language; `Optimize.tsx` lets the user tick it unless it conflicts -- **Verify**: unit test: known profile yields expected reasons; manual check: ticking a non-preselected strategy updates the savings panel (FR-051, US4)
- [ ] T137 Constrain the `model-strategy` group to guidance only for v1: T090's model-strategy seed must contain written guidance and detection rules, and no code path may switch models at runtime -- **Verify**: grep finds no router or model-switching code in `packages/`; review checklist item recorded (Out of Scope for v1)

### Slice 6 additions (Generate Files)

- [ ] T138 Implement skill output: add `skill` kind and `layout` to the platform schema (T029) and migration 006 (T025); add `skill.md.hbs` and supporting-file templates (T092); `ArtifactRenderer` (T093) writes the neutral copy under `.ai-optimizer/` and renders to the platform's catalog targets: `skill` targets when present, otherwise `instruction`, `rule`, `prompt` or `command` targets, honouring `defaultEnabled`; golden test against `fixtures/artifacts/` -- **Verify**: golden test passes; a platform with a `skill` target gets skill folders; one without gets its instruction, rule, prompt or command files; one with no targets gets only the neutral copy and a notice; no target path string exists in extension source (FR-053, FR-034, US6 scenario 3, SC-008)
- [ ] T139 Manual gate: before any `platforms` document is approved, check each host's skill and instruction conventions and agent invocation mechanisms (model-API vendor and family, chat command) against that host's current documentation and record `verifiedAt` and `docsUrl` -- **Verify**: catalog review report lists a checked entry per platform; an unverified platform is not served by the API; a host whose model API returns no models gets no `lm-edit` mechanism (FR-034, FR-056, Principle VII)

### Slice 7b - IDE agent route fallbacks: chat hand-off and clipboard (parallel to Slice 7; needs T095, T096, T093)

**Goal**: The mechanisms the IDE agent route uses when the host has no usable model API: build one prompt, review it, checkpoint, open the host's AI chat with it, or copy it to the clipboard. Selection between mechanisms is T151.

**Independent Test**: Quickstart Scenario 11.

- [ ] T140 Catalog and schema changes: migration `009-platforms-invocation.ts` adds `isDefault` and `agentInvocation` (ordered `mechanisms`) to platform documents, leaving it absent where unverified; seed a `handoff` prompt template; add `handoff` to the PromptTemplate purpose enum in Zod (T029) and contracts; add `host-lm` and `hostLm` to providers (T020) -- **Verify**: migration idempotent; `catalog-tools validate` passes; exactly one platform has `isDefault`; template with purpose `handoff` is served by `/v1/catalog` (FR-055, FR-056, Principle VII)
- [ ] T141 Implement `HandoffService` in `packages/extension/src/handoff/HandoffService.ts`: render the prompt from the `handoff` template, redact and preview through `PromptPreviewService`, on confirm call `CheckpointService.create()` then `BaselineService`, then run the catalog `chat-handoff` mechanism's `commandId` with args from `argsTemplate` (never submit); on a missing or failing command copy to the clipboard -- **Verify**: T144 tests pass; command id and args are read from the catalog only (FR-055 to FR-057, Principle VI, Principle VII)
- [ ] T142 Implement the handler for `optimize/handoff/confirm`, and post `optimize/handoff/preview` and `optimize/handoff/result` -- **Verify**: unit test: unknown message dropped; preview always precedes any dispatch (FR-055, Principle II)
- [ ] T143 Add the hand-off preview panel to the Implement screen (`Optimize.tsx`), shown when the plan message reports `chat-handoff` or `clipboard`: prompt preview, mandatory FR-058 notice, result state with rollback and audit buttons -- **Verify**: manual check: dispatch button disabled until the notice is acknowledged; rollback restores the checkpoint (FR-054, FR-058)
- [ ] T144 Write `HandoffService` tests: cancel at preview creates no checkpoint and opens no chat; confirm creates checkpoint before the command runs; missing or failing `chat-handoff` copies to the clipboard and writes no file; the extension itself performs no workspace write in any case -- **Verify**: all 4 pass (US7 scenarios 6 and 7, FR-056, FR-057)
- [ ] T145 **[ANALYZE GATE]** Run `/speckit-analyze` on Slice 7b; resolve all findings before Slice 8 -- **Verify**: analyze report shows all checks PASS

### Additions from the 2026-10-08 design changes (four-stage pipeline, phases in Enhance, merged Implement route)

- [x] T147 [S3] Implement `PhaseSuggester` in `packages/core/src/phases/PhaseSuggester.ts`: deterministic mapping from `profile.projectType` and LLM flags to catalog phase type ids (the previous PhaseBuilder logic); returns `ConfirmedPhase[]` with `source: "taxonomy-suggestion"` and `confirmed: false`; used only when Enhance returns no usable phases -- **Verify**: repeat calls are byte-identical; every returned `phaseTypeId` exists in the catalog fixture (FR-052, US2 scenario 11, Principle IV)
- [x] T148 [S3] Implement the `enhance/editPhases` handler and finalisation guard: validate edited phases against the catalog, create the next draft version in `ProfileHistoryStore` without calling any adapter, post `enhance/phasesUpdated`; extend T061 so `enhance/finalize` is refused for no phases, unknown types or unconfirmed phases -- **Verify**: unit tests: edit creates version+1 as draft with zero adapter calls; the three refusal cases; Estimate unlocks only after a valid finalisation (FR-052, US2 scenarios 9 and 10)
- [x] T149 [S0] Define stage contracts in `packages/core/src/pipeline/` (EnhanceStage, EstimateStage, OptimizeStage, ImplementStage from data-model section 7) and a test harness that injects a spy provider adapter and spy host-model adapter -- **Verify**: running EstimateStage and OptimizeStage on fixtures records zero adapter calls; the stage types compile with no `vscode` import (Principle XII, Principle IV, Principle X)
- [ ] T150 [S5] Implement the `ApplicabilityContext` builder in `packages/core/src/strategies/ApplicabilityContext.ts` (profile, `phaseTypes`, `tokenShareByPhaseType` from the expected-case estimate) and make `StrategyEngine` (T083) evaluate predicates against it; reasons name the triggering phase type -- **Verify**: two golden profiles that differ only in their confirmed phases give different pre-selected sets, and the reason text names the phase; a predicate on `tokenShareByPhaseType.<id>` evaluates correctly (FR-026, US4 scenario 6)
- [ ] T151 [S7] Implement `ImplementRouter` in `packages/extension/src/apply/ImplementRouter.ts`: read the platform's ordered `agentInvocation.mechanisms`; choose the first available (`lm-edit` needs `HostLmAdapter` to list at least one model for the catalog selector; `chat-handoff` needs its command registered on the host; `clipboard` always); post `optimize/implement/plan`; run the orchestrator (T110) or `HandoffService` (T141) accordingly -- **Verify**: table-driven test over availability combinations picks the expected mechanism; catalog order is respected; with none available the clipboard path runs and writes nothing (FR-055, FR-057, US7)

### Cross-cutting

- [ ] T146 Fix prompt-preview ordering: FR-047 needs preview before every LLM call, but `PromptPreviewService` and `RedactionService` (T117, T118) are in Slice 8 and Enhance (T059) ships in Slice 3. Move T117, T118 and T120 to run before T059, or ship a minimal confirm-before-send in Slice 3 and replace it in Slice 8 -- **Verify**: no `adapter.complete()` call site exists before the preview service in the slice order; Enhance cancel at preview sends nothing (FR-047, Principle IX)

---

## Dependencies & Execution Order

### Slice dependencies

```
S0 (Foundations)
 +-> S1 (Catalog)
      +-> S2 (Login/Keys)
           +-> S3 (Enhance)
           +-> S4 (Estimation)    [S3 and S4 parallel after S2]
                +-> S5 (Strategies)
                     +-> S6 (Install route)
                          +-> S7 (IDE agent route)
                               +-> S8 (Hardening)
```

> Slice 7b (Hand off) depends on S6 and can run in parallel with S7; S8 depends on both.

### Parallel opportunities within slices

All `[P]`-marked tasks within a slice share no intra-task file dependencies and can run concurrently.

Key parallel sets:
- **S1**: T020-T027 (all 8 migrations) fully parallel after T019
- **S2**: T042-T048 (5 adapters + KeyService + adapter interface) all parallel
- **S4**: T067 PhaseResolver, T068 TokenizerLayer, T071 ParamResolver can all start before T069 EstimationEngine assembles them
- **S7**: T102 AstScanner, T103 RegexScanner, T115 fixture seeding are all parallel with T110 orchestrator
- **S8**: T118 RedactionService, T119 CopilotOnlyMode, T121 TelemetryService, T128-T129 docs all parallel

---

## Implementation Strategy

### MVP (S0-S2 only)
1. S0 -- monorepo builds; CI green; webview shell opens.
2. S1 -- catalog API serves data; offline fallback works.
3. S2 -- key setup; masked display; Copilot pseudo-provider.
4. **STOP AND VALIDATE**: Onboarding flow complete; keys never exposed. Demo-able.

### Incremental delivery
- S3 adds Enhance -- first AI feature usable
- S4 adds Estimation -- primary value proposition unlocked
- S5 adds Strategies -- decision layer complete
- S6 adds the Install route -- skills, files and instructions for the chosen platform
- S7 adds the IDE agent route (merged Apply now and hand-off) -- full automation loop closed
- S8 ships -- privacy-complete, packaged, documented

---

## Notes

- `[P]` = different files, no intra-slice dependencies -- safe to parallelize
- Each ANALYZE GATE (T018, T040, T056, T066, T078, T091, T100, T116, T130) must pass before next slice begins
- No `any` types across package boundaries -- ESLint enforced; CI fails on violation
- No invented pricing -- all pricing rows require sourceUrl and verifiedAt
- Commit after each task or logical group; PR per slice