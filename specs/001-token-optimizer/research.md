# Research: Token Optimizer

**Phase**: 0 | **Date**: 2026-10-07 | **Plan**: [plan.md](plan.md)

---

## Decision 1: Tokenizer Strategy

**Decision**: Use `tiktoken` (via `@dqbd/tiktoken` WASM port) for GPT/O-series models in
`packages/core`; use `@anthropic-ai/tokenizer` or character-heuristic for Claude models
where no official JS tokenizer ships; use provider count-tokens endpoint as the fallback
exact-count mechanism where available (Anthropic `/v1/messages/count_tokens`); label all
non-library counts "approximate" with a ±15% margin displayed in the UI.

**Rationale**: `tiktoken` is the authoritative tokenizer for OpenAI model families and
runs in Node.js or browser via WASM without a network call. Anthropic's count-tokens
endpoint is the only reliable path for Claude (the SentencePiece model is not public).
For Gemini, Google's countTokens API endpoint provides exact counts. For models with
no known tokenizer (Mistral, custom OpenAI-compatible endpoints), character-based
approximation (chars / 4) is the industry standard fallback.

**Alternatives considered**:
- Ship all tokenizer WASM blobs in the VSIX: rejected — adds 3–8 MB per model family;
  use lazy WASM loading from `globalStorageUri` instead.
- Call provider count-tokens for every model always: rejected — adds latency and cost
  to every estimation re-computation; use local library as primary, endpoint as fallback.

---

## Decision 2: Extension↔Webview Message Protocol

**Decision**: Discriminated union TypeScript types shared between `packages/extension` and
`packages/webview` via a `packages/core/src/protocol/` export (no vscode import needed
there). Zod schemas in core validate every inbound message on both ends. Versioning via
a `version` field on every envelope. Nonce injected by the extension host into the webview
HTML at panel creation time.

**Rationale**: Sharing the union types from `core` (which has no vscode import) means both
ends import from the same source of truth without creating a circular dependency. Zod
validation at the boundary means malformed or unknown messages are caught before any
handler runs — satisfying Principle II.

**Alternatives considered**:
- JSON Schema + ajv: rejected — Zod provides runtime types that TypeScript inference
  picks up directly, reducing duplication.
- tRPC: rejected — tRPC requires a server; extension host is not an HTTP server; the
  postMessage channel is not a standard request/response transport.

---

## Decision 3: Catalog API Framework

**Decision**: Fastify 4 (TypeScript-native, fast, schema-validated routes via `@fastify/
swagger`). If an existing FastAPI (Python) backend is already deployed and stable, keep it
running as-is and add the missing collections/routes to it rather than re-deploying; the
extension's CatalogClient is agnostic to the framework — it only cares about the OpenAPI
contract.

**Rationale**: Fastify's built-in JSON schema serialization enforces the response contract
at the server boundary (defense in depth). TypeScript throughout keeps the `packages/`
monorepo uniform. However, not breaking a working deployed backend is a higher priority
than tech uniformity.

**Alternatives considered**:
- Express: rejected — no built-in schema enforcement; more boilerplate for route typing.
- Hono: considered but Fastify has more mature MongoDB/mongoose ecosystem plugins.

---

## Decision 4: MongoDB Migration Strategy

**Decision**: Idempotent migration scripts in `packages/catalog-api/migrations/`. Each
script checks whether the target field/index/collection already exists before writing.
Scripts run in numbered order on deploy (`migrate.ts --from 001`). No collection is
dropped; the existing `optimizer_rules` collection is preserved and the new `strategies`
collection is added alongside it as the authoritative store for the richer Strategy
document.

**Schema deltas vs existing DB snapshot**:

| Collection | Existing field | Action |
|---|---|---|
| `providers` | `provider_id`, `display_name`, `active`, `implementation_type`, `native_key` | Rename `provider_id`→`id`, `display_name`→`label`, `implementation_type`→`adapterType`; add `baseUrl`, `listModelsEndpoint`, `keyFormatHint`, `enabled`; keep originals as deprecated aliases for one release |
| `models` | `model_id`, `provider`, `pricing` (embedded), `context_window`, `active` | Add `id` alias for `model_id`; add `providerId` alias; add `maxOutput`, `tier`, `supportsCaching`, `supportsBatch`, `supportsStructuredOutput`, `tokenizer{kind,name}`, `status`; `pricing` embedded object retained for backward compat but `pricing` collection becomes authoritative |
| `pricing` (new) | — | New collection; seed from `models.pricing` values; each row: `modelId`, `currency`, `inputPerMTok`, `outputPerMTok`, `cachedInputPerMTok`, `cacheWriteMultiplier`, `batchDiscount`, `effectiveFrom`, `sourceUrl`, `verifiedAt` |
| `pricing_history` | `model_id`, `previous_pricing`, `new_pricing`, `pricing_version`, `changed_by`, `changed_at`, `reason` | Retained as-is for audit trail; new pricing rows go to `pricing` collection |
| `phases` | `phase_id`, `sort_order`, `default_agent_role`, `default_cacheable_fraction`, `ams_classified` | Add `track` ("build"|"runtime"), `defaultParams{callsLow,callsExpected,callsHigh,tokensPerCallLow,...}`, `paramHints{}` per clarification Q2; keep existing fields |
| `strategies` (new) | — | New collection; full Strategy document per spec; `optimizer_rules` preserved untouched |
| `platforms` (new) | — | New collection |
| `prompt_templates` (new) | — | New collection |
| `catalog_meta` (new) | — | New collection, one document |

**Rationale**: Adding fields rather than replacing keeps existing queries working. The
duplicate `optimizer_rules` vs `strategies` collections coexist; catalog-api serves only
`strategies` (reviewStatus=approved) to the extension.

---

## Decision 5: Apply Now Scanner — tree-sitter vs Regex

**Decision**: Use tree-sitter with `tree-sitter-typescript` and `tree-sitter-python`
grammars as the primary scanner for the Apply now pipeline. Each strategy's `detection`
array in the catalog specifies `kind: "ast"` or `kind: "regex"`. The scanner dispatches
to the appropriate implementation. Regex is the fallback for strategies that only need
pattern matching (e.g., string-literal prompt detection). Tree-sitter WASM is loaded
lazily from `globalStorageUri` (downloaded once, cached).

**Rationale**: LLM call-site detection requires understanding method chaining, argument
shapes, and import aliases — patterns that regex cannot handle reliably across real
codebases. Tree-sitter provides a stable, language-aware AST without requiring a full
TypeScript Language Server.

**Alternatives considered**:
- VS Code language server (LSP): rejected — too heavyweight to invoke programmatically
  from the extension host for a batch scan; LSP has no stable programmatic query API.
- Semgrep CLI: considered — good patterns, but adds a binary dependency and subprocess
  IPC, complicating sandboxing and Windows support.

---

## Decision 6: Checkpoint Strategy

**Decision**:
- Git repo present → `git stash push -m "token-optimizer: pre-apply checkpoint <timestamp>"`.
  If stash fails (e.g., no changes, or git not found), fall back to backup copies.
- No git repo → copy affected files to `.ai-optimizer/backups/<ISO-timestamp>/` before
  any write.
- The `CheckpointService` stores the checkpoint reference (stash SHA or backup path) in
  workspaceState so the audit and rollback commands can reference it.

**Rationale**: Git stash is the safest atomic snapshot mechanism when a repo is present;
it integrates with the developer's existing git workflow. Backup copies provide equivalent
safety for unversioned workspaces.

---

## Decision 7: Catalog Fallback Snapshot

**Decision**: The bundled snapshot is a single `catalog-snapshot.json` file committed to
`packages/extension/resources/` and included in the VSIX. It is generated by
`catalog-tools/src/publish.ts --snapshot` as part of every catalog release. The extension's
`CatalogClient` (in `core`) loads this file via a loader function injected by the extension
adapter — keeping `core` free of file-system imports.

**Rationale**: A single bundled JSON file is the simplest offline fallback. The loader
injection pattern keeps the platform boundary clean (Principle X).

---

## Decision 8: Platform Detection Order

**Decision**: Detect in this order:
1. `vscode.env.appName` substring match against `platforms[].detect.appNames[]`
2. `vscode.env.uriScheme` match against `platforms[].detect.uriSchemes[]`
3. Existence of marker files (e.g., `.cursor/settings.json`) from `platforms[].detect.markerFiles[]`
4. Fall back to `"vscode"` (generic VS Code) if no match.

All three arrays come from the catalog; no platform strings are hardcoded in the
extension source (Principle X verified by ESLint `no-restricted-syntax` rule checking
for string literals matching known platform names in the extension/ source).

---

## Decision 9: Key Service Design

**Decision**: `KeyService` (in `packages/extension/src/secrets/`) is the only class that
calls `context.secrets.get/store/delete`. Provider adapters (instantiated in `core`)
receive a `() => Promise<string>` getter closure, not the key string itself. The getter is
created by the extension host and passed to the adapter factory. The raw key never appears
in any message object, log entry, or webview payload — enforced by the ESLint
`no-key-in-webview` rule and the "key exfiltration" integration test.

---

## Decision 10: CI Pipeline Structure

**Decision**:
```
CI jobs (parallel where independent):
  lint          : ESLint (no-key-in-webview, no-vscode-in-core, no-any-boundary) + tsc --noEmit
  secret-scan   : Semgrep patterns (mongodb://, password=, API key shapes)
  unit-core     : Vitest (core) — Node.js only, no VS Code host
  unit-webview  : Vitest + @testing-library/react
  golden-files  : compare estimate + artifact outputs against fixtures/
  catalog-contract: Zod schema validation of all DB docs via catalog-tools validate
  extension-integration: @vscode/test-electron on VS Code stable
  extension-fork: @vscode/test-electron on one fork (Cursor or Windsurf via --extensionDevelopmentPath)
  package-vsce  : vsce package (dry-run; artifact upload)
  package-ovsx  : ovsx publish --dry-run
  e2e-fixtures  : fixture runner: mock LLM → Enhance → Estimate → Optimize → Apply
```
