# Implementation Plan: Token Optimizer

**Branch**: `001-token-optimizer` | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-token-optimizer/spec.md`

---

## Summary

Token Optimizer is a VS Code-family extension (installable on VS Code, Antigravity IDE,
Cursor, Windsurf, and compatible forks via Marketplace or Open VSX) that helps developers
describe an LLM-powered project, estimate its token cost across BUILD and RUNTIME phases,
select optimization strategies, and apply them. It is structured as a pnpm monorepo with
five packages: a pure TypeScript core library, a VS Code extension host, a React webview
UI, a read-only Catalog API, and catalog-tools scripts.

**Technical approach**: The estimation engine is a pure deterministic function in `core`.
All secrets live in VS Code SecretStorage, accessed only by a `KeyService` in `extension`.
The webview communicates with the extension host via a typed, Zod-validated, nonce-protected
message protocol. Catalog data is consumed from a read-only API with ETag caching and a
bundled offline fallback. The existing MongoDB database is extended with idempotent
migrations — no collections are dropped.

---

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode throughout); Node.js 20 LTS for the
extension host and catalog-api; Python 3.11 for any legacy catalog-tools scripts (migrated
to TS where new code is written).

**Primary Dependencies**:
- `packages/core`: zod, tiktoken (OpenAI/GPT tokenizer), js-tiktoken or gpt-tokenizer
  (browser-safe alternative), @anthropic-ai/sdk, openai, @google/generative-ai,
  @mistralai/client-ts (adapter libraries used without vscode import).
- `packages/extension`: @types/vscode (VS Code extension API); tree-sitter + tree-sitter-
  typescript + tree-sitter-python (for Apply now AST scanning); vscode-diff (built-in
  diff viewer via API).
- `packages/webview`: React 18, Vite, Tailwind CSS, @radix-ui primitives.
- `packages/catalog-api`: Fastify 4 (preferred; fall back to existing FastAPI if the
  backend is already deployed); mongoose or native mongodb driver; zod-to-json-schema for
  endpoint response validation.
- `packages/catalog-tools`: tsx (TypeScript scripts), commander, execa, Zod.

**Storage**:
- Extension: VS Code SecretStorage (keys), workspaceState (profile version history,
  baseline.json pointer), globalState (catalog cache + ETag). UserSetup (platform, enabled
  models, Enhance model; FR-050): `globalState`, on-device only.
- Catalog: MongoDB (existing Cluster0). No new databases.
- Workspace artefacts: `.ai-optimizer/` directory written to the open workspace folder.

**Testing**:
- `packages/core`: Vitest (unit + golden-file + property-based with fast-check).
- `packages/extension`: @vscode/test-electron (integration), mocha.
- `packages/webview`: Vitest + @testing-library/react.
- `packages/catalog-api`: Vitest (contract + integration against test MongoDB instance).
- End-to-end: custom fixture runner in `packages/fixtures/` exercising Enhance (mocked
  LLM) → Estimate → Optimize → Apply on `fixtures/` project snapshots.

**Target Platform**: VS Code extension host (Node.js); VSIX packaged for VS Code Marketplace
and Open VSX Registry. Webview runs in VS Code's built-in Chromium renderer.

**Project Type**: VS Code Extension (monorepo with supporting backend service).

**Performance Goals**:
- Estimation re-computation on phase-assumption edit: < 50 ms (pure function, no I/O).
- Catalog ETag check on startup: < 500 ms p95 (single HTTP HEAD/GET).
- Apply now scanner on a 500-file workspace: < 10 s (parallelised per-file, streaming).
- Webview initial render: < 1 s after extension activation.

**Constraints**:
- Extension bundle: < 5 MB (exclude tree-sitter WASM from the VSIX; load lazily from
  a CDN or include as a separate download step).
- Webview CSP: `default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'`.
- No `vscode` imports in `packages/core/`.
- No MongoDB connection strings or write credentials in any shipped artifact.
- All LLM calls originate from the extension host; the webview never calls a provider.

**Scale/Scope**: Single-user, local extension. The Catalog API serves all installed instances;
target throughput ≤ 500 req/min (Cloudflare or nginx rate limiter upstream).

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate Status | Notes |
|---|---|---|
| I — Keys never leave device | ✅ PASS | KeyService sole reader; adapters get getter fn; no key in webview messages |
| II — Extension host owns sensitive work | ✅ PASS | Webview is React UI only; all network/secrets/FS in extension host |
| III — No DB credentials; read-only catalog + fallback | ✅ PASS | Catalog API has no write endpoints; no credentials in VSIX; bundled snapshot |
| IV — Deterministic estimation | ✅ PASS | `estimate()` is pure fn in core; golden-file tests enforce it |
| V — Honest savings | ✅ PASS | Multiplicative stacking; min/max range; `basis` field required in strategy |
| VI — Nothing written without review | ✅ PASS | Diff view before any workspace write; single WorkspaceEdit; checkpoint first |
| VII — Data-driven catalog | ✅ PASS | Providers, models, phases, strategies, platforms all in catalog; no hardcoded data |
| VIII — Authoring gate | ✅ PASS | `reviewStatus` enum; only "approved" served by API; bot-commit CI check |
| IX — Privacy by default | ✅ PASS | FR-047/048/049; redact-by-default; preview-before-send; Copilot-only mode |
| X — Platform-agnostic core | ✅ PASS | No vscode import in core/; platform paths from catalog |
| XI — Spec-driven discipline | ✅ PASS | Constitution → Specify → Clarify → Plan (current) → Tasks → Implement |
| XII — Staged pipeline, determinism boundary (proposed, constitution 1.1.0) | ✅ PASS | Only Enhance and Implement call an LLM; spy-adapter test (T149) |

**Complexity justification** (Principle XI — no unnecessary complexity):

| Decision | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 5-package monorepo | core must be vscode-free; webview must be bundled separately; catalog-api and catalog-tools are separate deployment units | Single package would couple vscode to core and prevent Node-only unit tests |
| MongoDB (read-only via API) | Existing live data; 40 models, 11 providers, 10 phases | Replacing with flat JSON files would lose the existing DB and the migration path |
| React + Vite webview | Complex multi-tab UI with live estimation updates; reusing existing prototype visual language | VS Code's native TreeView/WebviewView cannot deliver the required interactive experience |
| tree-sitter for Apply now | Accurate AST-based detection of LLM call sites across TS/JS and Python | Regex-only detection produces too many false positives/negatives on real codebases |

---

## Project Structure

### Documentation (this feature)

```text
specs/001-token-optimizer/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── catalog-api.yaml          # OpenAPI 3.1
│   ├── webview-messages.ts       # Discriminated union types
│   └── project-profile.schema.json
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/
├── core/
│   ├── src/
│   │   ├── catalog/           # CatalogClient, ETag cache, fallback loader, Zod schemas
│   │   ├── providers/         # Adapter interfaces + Anthropic/OpenAI/Google/Mistral/Compat impls
│   │   ├── enhance/           # Enhance prompt runner, profile extractor, repair logic
│   │   ├── profile/           # ProjectProfile Zod schema, version history types
│   │   ├── phases/            # PhaseResolver (confirmed profile phases + catalog defaults), PhaseSuggester (deterministic fallback)
│   │   ├── estimation/        # estimate(), ExplainTree, per-phase formula, property tests
│   │   ├── strategies/        # ApplicabilityEvaluator, ConflictResolver, SavingsAggregator
│   │   ├── artifacts/         # ArtifactRenderer: template → .ai-optimizer/ + platform files
│   │   ├── apply/             # EditProposal schema, AnchorValidator
│   │   ├── pipeline/          # stage contracts (Enhance, Estimate, Optimize, Implement)
│   │   └── index.ts
│   ├── fixtures/              # golden profiles, catalogs, estimate outputs
│   └── vitest.config.ts
│
├── extension/
│   ├── src/
│   │   ├── activation.ts      # extension activate/deactivate
│   │   ├── platform/          # PlatformDetector (appName + uriScheme + markerFiles)
│   │   ├── secrets/           # KeyService (sole SecretStorage reader/writer)
│   │   ├── webview/           # WebviewProvider, MessageRouter, nonce + CSP builder
│   │   ├── lm/                # CopilotAdapter (vscode.lm bridge)
│   │   ├── workspace/         # CheckpointService, WorkspaceEditApplier, DiffReviewer
│   │   ├── scanner/           # tree-sitter scanner wrapper, language loader
│   │   ├── handoff/           # HandoffService: chat-handoff and clipboard mechanisms of the IDE agent route (prompt, preview, checkpoint)
│   │   └── commands/          # VS Code command registrations
│   └── package.json           # extension manifest (contributes, engines.vscode)
│
├── webview/
│   ├── src/
│   │   ├── views/             # Login, Settings, Enhance, Estimate, Optimize (tabs)
│   │   ├── components/        # StrategyCard, PhaseRow, ModelTable, DiffPreview, etc.
│   │   ├── protocol/          # typed postMessage wrappers (mirrors extension/protocol/)
│   │   └── main.tsx
│   └── vite.config.ts
│
├── catalog-api/
│   ├── src/
│   │   ├── routes/            # GET /v1/catalog, /v1/catalog/:collection, /v1/health
│   │   ├── db/                # MongoDB connection, collection accessors, ETag generator
│   │   ├── schemas/           # Zod schemas matching catalog data model
│   │   └── server.ts
│   └── migrations/            # idempotent migration scripts (run once per deploy)
│
├── catalog-tools/
│   ├── src/
│   │   ├── inspect.ts         # dump collection contents
│   │   ├── migrate.ts         # run migrations
│   │   ├── seed.ts            # load reviewed JSON → providers/models/pricing
│   │   ├── validate.ts        # validate all docs against Zod schemas
│   │   ├── publish.ts         # bump catalog_meta.version, set publishedAt
│   │   ├── draft-strategies.ts # LLM-draft implementation for existing strategy names
│   │   └── review-report.ts   # generate human-review checklist for drafted strategies
│   └── tsconfig.json
│
└── fixtures/
    ├── projects/              # sample workspace snapshots (TS/JS, Python)
    ├── profiles/              # golden ProjectProfile JSON files
    ├── estimates/             # golden EstimationResult JSON files
    └── artifacts/             # golden .ai-optimizer/ directory snapshots
```

---

## Pipeline Architecture (2026-10-08)

The product is four stages (called agents in the project brief), each with a typed input and output in `packages/core/src/pipeline/`:

| Stage | Input | Output | LLM? | Notes |
|---|---|---|---|---|
| Enhance | description, previous profile | narrative, Project Profile with phases | Yes (user's provider/model, or host model in Copilot-only mode) | Phases proposed here, verified and edited by the user here; editing phases makes no LLM call |
| Estimate | profile, catalog, overrides | EstimationResult per confirmed phase and model | No | Principle IV; pure function |
| Optimize | profile, estimation, approved strategies | pre-selected set with reasons, conflicts, savings | No | Predicates run against ApplicabilityContext (profile + phase types + token share per phase); reasons come from catalog `reasonTemplate` |
| Implement | selection, platform, profile | Install plan or IDE agent run | Only through the host model API or host chat | Route and mechanism come from the platform's catalog entry |

**Implement routes.** Install writes skills, files or instructions to the platform's catalog targets in one undoable `WorkspaceEdit`. The IDE agent route walks the platform's ordered `agentInvocation.mechanisms`: `lm-edit` (the extension calls the host model API, receives structured edit proposals, validates anchors, shows per-hunk diff, checkpoints, applies one batch), then `chat-handoff` (open host chat with a reviewed prompt), then `clipboard`. `lm-edit` is a model completion with context the extension supplies, not the host's agent mode; it cannot browse the repository or run tools, which is why detection and anchoring are done by the extension.

**Why the host vendor/family, command ids and platform paths are in the catalog**: Principle VII. An example of what to avoid is a hard-coded `vendor: 'copilot', family: 'gpt-4o'` selector or a hard-coded strategy registry in extension source.

## Constitution Notes (2026-10-08)

- A proposed `constitution.md` 1.1.0 accompanies this plan: Principle VI scoped to writes made by the extension and extended to the chat hand-off, new Principle XII (pipeline and determinism boundary), plus naming and path fixes in X and XI. It needs the amendment PR and two maintainer approvals from the Governance section before it is in force; this plan treats it as pending.
- Keys stay on the device (Principle I holds unchanged). No accounts or server-side user data.
- Prompt preview ordering: FR-047 requires preview before every LLM call, but PromptPreviewService (T117) is in Slice 8 while Enhance (T059) ships in Slice 3. See T146.
