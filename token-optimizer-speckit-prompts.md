# Token Optimizer IDE Extension — Spec-Kit Prompt Set

Run in order: `constitution → specify → clarify → plan → tasks → analyze → implement (per slice)`.
Run `/speckit.analyze` after every phase and after every implementation slice.

## Step 0 — Pre-flight (before any Spec-Kit command)

1. **Rotate the MongoDB password** you pasted in chat. Treat it as compromised.
2. Put the new URI in `.env` (git-ignored) as `MONGODB_URI`. Never commit it, never put it in the extension, never put it in a prompt.
3. Export the current schema and a sample of each collection (`mongoexport` or a small script) and keep it at `docs/db-snapshot/`. The `plan` step uses it so migrations match reality.
4. Add `.env`, `docs/db-snapshot/*.json` (if it has real pricing you consider private) to `.gitignore`.

---

## 1. `/speckit.constitution`

```
Create a constitution for "Token Optimizer", a cross-IDE extension for the VS Code family (VS Code, Antigravity, Cursor, Windsurf and other forks installable via VS Code Marketplace or Open VSX).

Principles (each must be testable and cite how it is verified):

1. Keys never leave the device. LLM provider API keys are stored only in VS Code SecretStorage (context.secrets). They are never written to settings, globalState, logs, telemetry, the webview, or any backend. LLM calls go directly from the extension host to the provider. A lint/test must fail the build if a key-bearing value is passed to the webview or logger.
2. Extension host does everything sensitive; the webview is presentation only. All network, secrets, file-system and LLM access happens in the extension host. The webview communicates only via a typed, schema-validated message protocol with a strict CSP and nonces.
3. The extension never connects to MongoDB. It reads a read-only Catalog API. No database credentials ship in the package. The catalog is cached locally with ETag revalidation and a bundled fallback snapshot so the extension works offline.
4. Deterministic estimation. Token and cost numbers come from explicit, versioned formulas over a structured project profile, not from asking an LLM for a number. The same profile + catalog version always yields the same estimate. LLMs may extract the profile; they never produce the final numbers.
5. Honest savings. Every optimization strategy declares preconditions, a savings range with a stated basis, and conflicts with other strategies. Combined savings are computed multiplicatively and shown as a conservative range. No unqualified "up to X%".
6. Nothing is written to the user's project without review. Every code change goes through a diff view with per-hunk accept/reject, is applied as one undoable WorkspaceEdit batch, and is preceded by a checkpoint (git stash/commit if a repo exists, otherwise backup copies in .ai-optimizer/backups/). Generated files never overwrite user-edited files without confirmation.
7. Data-driven catalog. Providers, models, pricing (with history), strategies (with implementation guidance), platforms (detection + artifact paths), and prompt templates live in the catalog, not in code. Adding a model or strategy requires no extension release.
8. Authoring gate for strategies. A strategy is user-visible only when reviewStatus = "approved". Draft implementation content may be LLM-generated but must be human-reviewed before approval.
9. Privacy by default. Show exactly what will be sent to a provider before each call (project description, code snippets). Support a "Copilot only / no external keys" mode. Offer redaction of obvious secrets. Telemetry is opt-in and never includes prompts, code or keys.
10. Platform-agnostic core. Core logic is a pure TypeScript library with no vscode imports. Platform specifics live in adapters. Platform artifact paths come from the catalog, verified against each platform's current documentation at build time.
11. Spec-driven discipline. Work proceeds constitution → specify → clarify → plan → tasks → implement, with /speckit.analyze after each phase and each slice; findings are logged and resolved before advancing.

Technical guardrails: TypeScript strict mode, pnpm monorepo, no `any` across package boundaries, zod (or equivalent) schemas for every external boundary (catalog responses, LLM JSON output, webview messages), unit tests for core with golden-file tests for estimation and artifact rendering, and CI that packages the extension for both Marketplace and Open VSX.
```

---

## 2. `/speckit.specify`

```
Build "Token Optimizer": an extension for the VS Code family that helps a developer (1) describe a project, (2) get a structured, detailed project description, (3) estimate token usage and cost across BUILD-time and RUNTIME phases for every model, (4) choose optimization strategies, and (5) apply those strategies to the project.

## Users
Developers and tech leads who build LLM-powered applications or use AI coding assistants heavily and want to predict and reduce token cost.

## User stories

### US1 — Onboarding and login screen (P1)
On first launch the user sees a login screen:
- Platform selector (VS Code, Antigravity, Cursor, Windsurf, Other VS Code fork). Auto-detected from the host application and pre-selected; user can override.
- Provider list loaded from the catalog (e.g., Anthropic, OpenAI, Google, Mistral, plus any added later). For each provider the user can enter an API key. On save, the key is validated with a cheap authenticated call and stored only in SecretStorage.
- Per provider, the user selects the models they have access to. Offer the intersection of (models returned by the provider's list-models endpoint, if available) and (models in the catalog); allow manual add for catalog models the endpoint doesn't list.
- On VS Code-family hosts that expose the Language Model API, a "GitHub Copilot" pseudo-provider is available with no key.
- Later, via Settings, the user can add, replace or remove keys and change enabled models. Removing a key deletes it from SecretStorage.
Acceptance: keys are never visible after saving (masked, last 4 characters only); offline start works using cached catalog; invalid key shows a clear error and is not stored.

### US2 — Enhance (P1)
The user types a rough project description (optionally pre-filled from workspace scan: package manifests, SDK imports, README). Pressing Enhance calls an LLM (user's chosen provider/model) with a versioned system prompt and produces:
- A readable detailed description (overview, tech stack, agents/components, data flow, AI/LLM integration, scale assumptions, constraints), and
- A structured Project Profile (JSON, schema-validated) used by later steps.
The user can edit the text and press Enhance again; each run refines the previous version (not re-wraps it). A version history with diff lets the user step back. The user can mark a version as "final" to proceed. Ctrl/Cmd+Enter runs Enhance; Enter inserts a newline. The cost of each enhance call is shown.
Acceptance: re-running Enhance never nests or duplicates sections; invalid LLM JSON triggers one automatic repair attempt and then a clear error.

### US3 — Phase-wise estimation for build AND runtime (P1)
From the final Project Profile, the extension derives project-specific phases in two tracks:
- BUILD track: phases for AI-assisted development of the project (e.g., scaffolding, feature implementation per major component, testing, refactoring, deployment, maintenance — the set depends on the project).
- RUNTIME track: phases of the application's own LLM usage (e.g., ingestion/embedding, retrieval, generation, evaluation, agent steps — depends on the project).
For each phase the user sees tokens (input / output / cached-input where applicable), a low / expected / high range, and cost per enabled model using catalog pricing. Runtime is shown per request, per user-day and per month using the scale assumptions in the profile. The user can edit any phase's assumptions (calls, tokens per call, retries, volume) and see numbers update immediately. A model-comparison table shows total cost per model for each track.
Acceptance: identical profile + catalog version → identical numbers; every number is traceable to a formula and inputs shown in an "explain" popover; token counts use a real tokenizer where one exists for the model family and are labelled "approximate" otherwise.

### US4 — Strategy selection (P1)
Strategies are loaded from the catalog (only reviewStatus = approved). Strategies applicable to the profile are pre-selected, with the reason shown. The user can select or deselect any strategy, grouped by category (prompt efficiency, caching, model strategy, build-time agent practices, etc.). Conflicting strategies cannot both be selected (UI explains why). A live panel shows combined estimated savings per track as a conservative range.
Acceptance: pre-selection is derived from declarative applicability predicates against the profile; no hardcoded regex rules in code.

### US5 — "i" try-it panel (P2)
Each strategy has an "i" button that opens detail (what it does, preconditions, savings basis, risks) and a try-it area: the user pastes a prompt/response/schema sample and sees a before/after using the strategy's preview kind (real tokenizer counts for before/after; an optional "run with LLM" button for strategies that need a model to transform, with cost shown first).

### US6 — Optimize: generate files (P1)
On Optimize with "Generate files" the extension writes a Spec-Kit-style workspace into the project:
.ai-optimizer/
  optimizer.yaml (platform, selected strategies, models, budgets, catalog version)
  project/ (architecture.md, requirements.md, constraints.md, profile.json)
  strategies/<strategy-id>.md (what, where to apply, detection hints, steps, acceptance criteria, verification metric)
  commands/ (source templates for analyse, optimise, implement, audit)
plus platform-native command/prompt files rendered from the same templates into the locations defined in the catalog's `platforms` collection for the detected host, so the user can trigger them with "/" in that host's AI chat (e.g., /optimizer.analyse, /optimizer.optimise, /optimizer.implement, /optimizer.audit). Existing files are never silently overwritten (diff + confirm).
The `audit` command re-measures token usage against the stored baseline and reports verified savings.

### US7 — Optimize: Apply now (P1)
With "Apply now" the extension applies selected strategies directly:
1. Scan the workspace for LLM call sites and prompt locations using each strategy's detection rules (per language).
2. For each target, ask the chosen model (a user-keyed provider or Copilot via the Language Model API) to produce edits as structured JSON (file, anchor/content hash, original snippet, replacement, rationale). No free-form code blocks.
3. Validate: anchor still matches, replacement parses (syntax check), only declared files touched.
4. Show every proposed change in a native diff view with per-hunk accept/reject and the strategy that motivated it.
5. Create a checkpoint, then apply accepted hunks in a single WorkspaceEdit so one undo reverts everything.
6. Offer to run the audit to compare before/after tokens.
Acceptance: stale ranges are re-located by content hash or skipped with a message, never applied blindly; cancelling at any point leaves the project unchanged.

### US8 — Catalog freshness (P2)
The extension fetches providers, models, pricing, strategies, platforms and prompt templates from the Catalog API on start and every 24h, revalidates with ETag, shows the catalog version and "last updated", and falls back to cache or bundled snapshot when offline.

## Non-goals (v1)
Pure-CLI agents (Claude Code or Codex outside an IDE), cloud accounts or sync of keys, server-side storage of any user data, billing or invoicing, automatic model price scraping.

## Edge cases to specify
Multi-root workspaces; no workspace open; monorepos with several languages; very large files; provider rate limits and retries; key validation endpoint unavailable; model missing from catalog; pricing without cached-input rate; user edits files while diff is open; Copilot unavailable or user declines consent; catalog schema version newer than the extension.
```

---

## 3. `/speckit.clarify`

```
Run clarification focused on these known risk areas. Record answers in the spec:

1. Phase derivation: how are BUILD and RUNTIME phases derived from the profile (LLM proposes, user confirms? fixed templates per project archetype?) and what is the minimum/maximum phase count?
2. Estimation formula inputs: which parameters are user-editable per phase, and what default ranges (low/expected/high) are used and where do they come from?
3. Tokenizers: which model families get exact counting (and via what mechanism: local library vs provider count endpoint) and which are approximated, and how is approximation error communicated?
4. Strategy conflicts and stacking: which pairs conflict, which are additive vs multiplicative, which apply only to BUILD or only to RUNTIME or both?
5. Detection scope for Apply now: which languages in v1 (suggest TypeScript/JavaScript and Python) and which SDKs/frameworks per language?
6. Platform artifact locations: confirm current prompt/command/rule file conventions for each supported host and how they are verified over time.
7. Copilot model availability: behavior when the LM API returns no models or the user declines consent.
8. Catalog authoring workflow: who approves strategies and pricing changes, and how are catalog versions published?
9. Privacy mode: what exactly is redacted, and what is the default?
```

---

## 4. `/speckit.plan`

```
Technical plan for Token Optimizer.

## Repository layout (pnpm monorepo, TypeScript strict)
packages/
  core/            pure TS: catalog client+cache, provider adapters, enhance, profile schema, phase builder, estimation engine, strategy engine (applicability, stacking), artifact renderer, apply planner/validator. No `vscode` imports.
  extension/       VS Code extension host: activation, platform detection, SecretStorage, webview provider, message router, Language Model API bridge, WorkspaceEdit/diff/checkpoint, file generation.
  webview/         React + Vite + Tailwind UI (tabs: Enhance, Estimate, Optimize; login and settings views). Reuse the existing prototype's layout and visual language; replace all simulated logic with host messages.
  catalog-api/     read-only HTTP service in front of MongoDB (reuse the existing FastAPI backend if present, otherwise Fastify). Endpoints: GET /v1/catalog (full snapshot with version + ETag), GET /v1/catalog/{collection}, GET /v1/health. No write endpoints; no auth required for read; rate limited.
  catalog-tools/   scripts: inspect DB, migrate, seed, validate, publish catalog version, strategy authoring/LLM-draft helper.
  fixtures/        golden projects and expected estimates/artifacts for tests.

## Catalog data model (MongoDB; extend existing collections, do not drop them)
Use docs/db-snapshot/ to diff against the current schema and write idempotent migrations. Required collections and fields:
- providers: id, label, adapterType (anthropic|openai|google|mistral|openai-compatible), baseUrl, listModelsEndpoint?, keyFormatHint, enabled.
- models: id, providerId, label, contextWindow, maxOutput, tier, supportsCaching, supportsBatch, supportsStructuredOutput, tokenizer {kind, name}, status (active|deprecated), addedAt.
- pricing: modelId, currency, inputPerMTok, outputPerMTok, cachedInputPerMTok?, cacheWriteMultiplier?, batchDiscount?, effectiveFrom, sourceUrl, verifiedAt. Keep history; the active price is the latest effectiveFrom <= now.
- strategies: see "Strategy document" below.
- platforms: id, label, detect {appNames[], uriSchemes[], markerFiles[]}, artifactTargets [{kind: command|prompt|rule|instruction, pathTemplate, format, frontmatterTemplate}], docsUrl, verifiedAt.
- prompt_templates: id, version, purpose (enhance|profile-extract|apply-edit|preview), template, outputSchemaRef, active.
- catalog_meta: version (monotonic), publishedAt, schemaVersion.
Add indexes and a JSON-schema validator per collection.

## Strategy document (the gap to fill: existing strategies have names only)
{
  id, name, group, targets: ["build"|"runtime"],
  summary,
  applicability: declarative predicate tree over the Project Profile (e.g., {all:[{path:"llm.usesRag",eq:true},{path:"llm.avgPrefixTokens",gte:1024}]}),
  reasonTemplate,                       // text shown for pre-selection
  preconditions: [..],                  // human-readable, also machine checkable where possible
  savings: {min, max, unit:"percent", appliesTo:"input|output|total", basis, sourceUrl},
  conflicts: [strategyId], requires: [strategyId],
  preview: {kind, params},
  implementation: {
    overview,
    detection: [{language, kind:"regex|ast", query, description}],
    steps: [ordered, concrete instructions for a coding agent],
    transforms: [{language, framework?, before, after, notes}],     // reference examples, not blind templates
    applyPrompt: "prompt template used by Apply now, outputs the edit JSON schema",
    acceptanceCriteria: [..], verification: {metric, method},
    risks: [..], rollback: ".."
  },
  reviewStatus: "draft"|"approved", reviewedBy, reviewedAt, version
}
Provide a catalog-tools command that drafts `implementation` for every existing strategy name using an LLM (with the platform's schema), writes them as reviewStatus="draft", and a review report listing what a human must verify. Only approved strategies are served by the API.

## Model and pricing update
catalog-tools includes a seed/update path that adds new models and pricing rows from a reviewed JSON file (never hardcoded in source). Each pricing row must carry sourceUrl and verifiedAt. The extension displays "pricing verified <date>" per model. Do not invent prices; the input file is supplied by the maintainer.

## Extension design
- Activation: onStartupFinished and on view open. Webview provider with CSP (default-src 'none'; script via nonce).
- Platform detection: vscode.env.appName, vscode.env.uriScheme, then marker files; match against catalog `platforms`.
- Secrets: context.secrets keyed provider:{id}:{n}. A KeyService is the only code that reads them; adapters receive a short-lived getter, never the raw key in messages.
- Provider adapters (core): anthropic, openai, google, mistral native; openai-compatible generic. Interface: validateKey, listModels, countTokens?, complete(messages, {schema?, maxTokens, signal}) with retry/backoff and cancellation. Copilot adapter in extension via vscode.lm.selectChatModels.
- Message protocol (extension↔webview): discriminated unions, zod-validated both directions, versioned. Examples: login/saveKey (webview→host, value cleared immediately), catalog/updated, enhance/run, enhance/result, estimate/recompute, optimize/generate, optimize/apply/plan, optimize/apply/progress.
- Enhance: prompt template from catalog; JSON-schema output (ProjectProfile + narrative); one repair retry; version history stored in workspaceState; token count of input and output recorded.
- Phase builder: deterministic mapping from profile (archetype, components, agents, scale) to BUILD and RUNTIME phase lists; LLM may propose components during Enhance but phase math is code.
- Estimation engine: per phase, for each step: tokens = calls × (inputTokens + outputTokens) × (1 + retryRate) × iterations; runtime multiplies by requests/day × days with user/session assumptions; caching modeled with prefix size, hit rate and cache pricing when strategy or model supports it. Low/expected/high from declared parameter ranges. Output includes an `explain` tree for every number. Costs use the active catalog pricing for each enabled model. Property tests: monotonicity (more calls → never less cost), determinism, sum of phases = total.
- Strategy engine: evaluate applicability predicates; resolve requires/conflicts; compute combined savings per track as product of (1 - s) across selected strategies using min and max separately, then present the conservative range.
- Artifact renderer: single template set → .ai-optimizer/ plus platform-native files from `platforms.artifactTargets`; idempotent, checksum-tracked, diff-before-overwrite.
- Apply now pipeline: scanner (per-language detection from strategy docs; tree-sitter or equivalent where specified, regex as fallback) → planner (LLM edit JSON per target, schema-validated) → validator (anchor hash match, syntax parse, allowed paths) → reviewer (vscode.diff with per-hunk selection) → checkpoint → single WorkspaceEdit → audit prompt. All steps cancellable; progress via vscode.window.withProgress.
- Audit: re-run scanner + tokenizer on call sites/prompts and compare with baseline stored in .ai-optimizer/baseline.json.

## Packaging and CI
vsce package and ovsx publish; a build matrix that installs the VSIX into VS Code and one fork in CI smoke tests; secret-scanning in CI; dependency audit; catalog schema contract tests between catalog-api and core.

## Testing strategy
Unit (core), golden-file (estimates, artifacts), contract (catalog schema), extension integration via @vscode/test-electron, webview component tests, and an end-to-end script on fixtures/ that runs Enhance (mocked LLM) → Estimate → Optimize (generate and apply) and asserts on files and numbers.
```

---

## 5. `/speckit.tasks`

```
Generate tasks grouped into independently shippable slices, each ending with an analyze gate. Mark parallelizable tasks [P]. Suggested slices:

Slice 0 — Foundations: monorepo, CI, lint rules (no key to webview/logger), zod schemas, message protocol, strict CSP webview shell, prototype UI ported with simulated logic removed.
Slice 1 — Catalog: DB snapshot + diff, migrations, catalog_meta versioning, read-only Catalog API, client with ETag cache + bundled fallback, contract tests. Seed new models and pricing from a maintainer-provided reviewed JSON.
Slice 2 — Login and keys: platform detection, provider list from catalog, SecretStorage KeyService, key validation per adapter, model selection (list-models ∩ catalog), Copilot pseudo-provider, settings view add/remove.
Slice 3 — Enhance: prompt templates, adapters.complete with structured output + repair, workspace scan pre-fill, version history/diff, cost display, fixed keyboard behavior.
Slice 4 — Estimation: ProjectProfile schema, phase builder (BUILD + RUNTIME), tokenizer layer, estimation engine with ranges and explain tree, editable assumptions, per-model comparison UI, property and golden tests.
Slice 5 — Strategies: strategy schema, authoring tool (LLM drafts → draft status → review report → approved), applicability engine, conflicts/requires, combined-savings math, selection UI, "i" panel with real-tokenizer previews and optional LLM preview.
Slice 6 — Generate files: artifact templates, platform renderers from catalog, diff-before-overwrite, baseline capture, audit command.
Slice 7 — Apply now: scanner (TS/JS and Python), planner, validator, diff review with per-hunk accept, checkpointing, single WorkspaceEdit, Copilot and keyed-provider backends, cancellation, post-apply audit.
Slice 8 — Hardening: privacy mode and "what will be sent" preview, redaction, offline behavior, telemetry opt-in, accessibility, packaging for Marketplace and Open VSX, multi-fork smoke tests, docs.

Each task must reference the FR/user story it satisfies and name its verification (test or manual check).
```

---

## 6. Analyze gates (run after each phase and slice)

```
/speckit.analyze
Focus on: (a) any path where an API key could reach the webview, a log, a message or the network other than the provider; (b) any estimate number without an explain trail; (c) any strategy shown to users that is not approved; (d) any file write not preceded by diff + checkpoint; (e) any hardcoded model, price, provider, platform path or strategy rule in code instead of the catalog; (f) mismatches between spec, plan and tasks; (g) tasks missing verification. Log findings with severity, resolve before advancing.
```

---

## 7. `/speckit.implement` prompts (one per slice)

Use this wrapper each time:

```
/speckit.implement Slice <N> only. Do not start the next slice. Follow the constitution. After finishing, list: files changed, tests added and results, any deviation from plan with justification, and open questions. Do not touch .env or print any connection string or key.
```

Slice-specific additions:

- **Slice 1:** "Never read MONGODB_URI anywhere except catalog-api and catalog-tools via environment variables. The inspect script must print schema summaries and counts only, never credentials. Migrations are idempotent and non-destructive; write a dry-run mode."
- **Slice 2:** "Add a unit test and a lint rule proving no code path posts a raw key to the webview. Key fields in the UI are write-only after saving."
- **Slice 4:** "Estimation must pass determinism and monotonicity property tests and match the golden fixtures exactly. Every UI number must open an explain popover."
- **Slice 5:** "The authoring tool writes strategies as draft. Add a CI check that the API never returns drafts."
- **Slice 7:** "Add tests where the file changes between plan and apply (stale anchor), where the model returns invalid JSON, where syntax validation fails, and where the user cancels mid-way. In all cases the workspace must be unchanged or fully reverted."

---

## Notes on the MongoDB work

- Existing strategy names stay as the stable `id`/`name`. The authoring tool fills `implementation`, `applicability`, `savings` and the rest as `draft`. A human approves each one.
- New models and their pricing go in through a reviewed JSON input with `sourceUrl` and `verifiedAt` per price, so you control accuracy and history.
- Platform artifact paths for Antigravity and the other forks should be checked against each tool's current documentation before approving the `platforms` documents, since these conventions change quickly.
