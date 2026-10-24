<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.1.0 (PROPOSED: needs the amendment PR and two maintainer approvals)
Added sections:
  - Principle XII (Staged Pipeline With a Determinism Boundary)
Modified principles:
  - VI  Scope limited to writes made by the extension; new files go through a review list and the same single
        WorkspaceEdit batch; checkpoint required even for all-new files; delegated (host-agent) edits get
        compensating controls.
  - VII Adds phase taxonomy, host-model selectors and agent-invocation mechanisms to catalog-owned data;
        verification reworded (a file path cannot be fetched as a URL).
  - IX  No silent LLM calls, including calls to the host model API.
  - X   `artifactPaths` renamed `artifactTargets` to match the data model; adapter package named generically.
  - XI  Feature directory is `specs/<id>/` (what the Spec-Kit scripts use), not `specs/<id>/`.
Technical Guardrails: one row added (LLM only in Enhance and Implement).
Removed sections: none
Deferred TODOs: none
-->

# Token Optimizer Constitution

## Core Principles

### I. Keys Never Leave the Device

LLM provider API keys MUST be stored exclusively in VS Code `SecretStorage`
(`context.secrets`). They MUST NOT be written to `settings.json`,
`globalState`, log output, telemetry payloads, the webview HTML/JS bundle,
or any backend service. All LLM calls MUST originate directly from the
extension host process to the provider endpoint — no proxy, relay, or
intermediary service may receive a key.

**Rationale**: User trust depends on unconditional key confidentiality.
Any key exposure vector — even accidental — constitutes a critical security
failure.

**Verification**:
- A dedicated ESLint rule (`no-key-in-webview`) and a Semgrep pattern scan
  the codebase at build time for any call that passes a key-shaped value to
  `postMessage`, a logger, or a telemetry sink. A match MUST fail the CI build.
- The unit-test suite includes a "key exfiltration" integration test that
  mounts a fake provider, sets a secret, and asserts no key string appears
  in any message captured by a mock webview panel or logger.

---

### II. Extension Host Owns Everything Sensitive; Webview Is Presentation Only

All network I/O, `SecretStorage` access, file-system reads/writes, and LLM
invocations MUST execute inside the extension host process. The webview
MUST NOT perform any of these operations directly.

Communication between the extension host and the webview MUST use a
**typed, schema-validated message protocol** (Zod schemas at both ends).
Every webview panel MUST be initialized with a strict Content Security
Policy (CSP) and a per-panel cryptographic nonce. The webview MUST NOT
receive raw secret values under any circumstances.

**Rationale**: Webview code executes in a sandboxed renderer but is still
susceptible to XSS and prototype-pollution attacks. Keeping sensitive
operations in the extension host minimizes the blast radius of any renderer
vulnerability.

**Verification**:
- CSP header is asserted in a unit test that renders a webview panel and
  inspects the returned HTML string.
- A Zod schema validator is applied to every `onDidReceiveMessage` handler;
  an unrecognized or malformed message MUST be logged and dropped, never acted on.
- E2E smoke test verifies that no `fetch` or `XMLHttpRequest` call is
  initiated from within the webview `window` context.

---

### III. No Database Credentials; Read-Only Catalog API with Offline Fallback

The extension MUST NOT connect to MongoDB or any mutable database. Catalog
data (providers, models, pricing, strategies, platforms, prompt templates)
is served by a **read-only Catalog API** over HTTPS. No database credentials,
connection strings, or write-capable API tokens MUST ship in the packaged
extension.

The extension MUST cache catalog responses locally using HTTP ETag
revalidation. A **bundled fallback snapshot** of the catalog (committed to
the repository and updated on each release) MUST ensure the extension
operates correctly when the Catalog API is unreachable.

**Rationale**: Shipping database credentials in a VS Code extension exposes
them to every user who installs it. A read-only API with a local cache gives
the benefits of a live catalog while preserving offline usability.

**Verification**:
- A Semgrep/grep pattern fails the build if any string matching a MongoDB
  URI scheme (`mongodb://`, `mongodb+srv://`) or write-capable credential
  pattern appears in any source or bundled file.
- Integration tests run against a mock Catalog API server and assert that
  when the server returns `304 Not Modified`, the local cache is used
  without a full parse cycle.
- CI runs a dedicated offline test that severs network access and asserts
  the fallback snapshot is loaded and estimation produces deterministic results.

---

### IV. Deterministic Estimation

Token counts and cost estimates MUST be derived from **explicit, versioned
formulas** applied to a structured project profile. The same profile
combined with the same catalog version MUST always yield bit-identical
numeric output — no random sampling, no LLM-generated numbers.

LLMs MAY be used to **extract or populate** the project profile from
natural-language descriptions. They MUST NOT produce the final token count
or cost figure. The estimation engine is a pure function:
`estimate(profile, catalog) → EstimationResult`.

**Rationale**: Users and teams rely on cost estimates for budgeting decisions.
Non-deterministic or LLM-generated estimates are unauditable and untrustworthy.

**Verification**:
- The `@token-optimizer/core` package exposes `estimate()` as a pure
  TypeScript function with no I/O side effects.
- **Golden-file tests** commit expected JSON outputs for a fixed set of
  `(profile, catalog)` pairs. CI asserts byte-for-byte equality; any formula
  change that alters output MUST update the golden files in the same commit
  with an explicit rationale comment.
- A property-based test asserts idempotency: running `estimate()` twice with
  the same inputs always returns equal results.

---

### V. Honest Savings

Every optimization strategy MUST declare:
1. **Preconditions** — constraints that must hold before the strategy is applicable.
2. **Savings range** — a `[min%, max%]` interval with a stated empirical or
   theoretical basis.
3. **Conflicts** — identifiers of other strategies that are mutually exclusive
   or whose combined effect is not simply additive.

When multiple strategies are combined, savings MUST be computed
**multiplicatively** (i.e., compounded reduction, not summed) and displayed as
a conservative range. The UI MUST NEVER display an unqualified "up to X%" claim
without the associated basis and range bounds.

**Rationale**: Over-promising savings erodes user trust and may constitute
misleading advertising. Conservative, documented ranges protect both users
and the project.

**Verification**:
- The strategy schema (Zod) enforces presence of `preconditions`, `savingsRange`,
  and `conflicts` fields; a missing field fails catalog validation at load time.
- A unit test suite covers all combinatorial logic in the savings aggregator,
  asserting multiplicative composition and range narrowing.
- UI snapshot tests assert that no strategy card renders without a visible
  range and basis string.

---

### VI. Nothing Written Without Review

Every code or file change **made by the extension** MUST be shown to the user
for review before anything is written to disk. Changes to existing code MUST be
shown in a **diff view** with per-hunk accept/reject controls; new files MUST be
shown in a list of files to be created. All accepted changes, including file
creation, MUST be applied as a **single, undoable `WorkspaceEdit` batch**.

Before applying any batch, the extension MUST create a checkpoint, even when
every file in the batch is new:
- If a Git repository is detected: perform a `git stash` or an auto-commit
  (`git commit --no-verify -m "token-optimizer: pre-apply checkpoint"`).
- Otherwise: write backup copies of all affected files to
  `.ai-optimizer/backups/<timestamp>/`.

Generated or suggested files MUST NEVER silently overwrite a user-edited file.
If the target file has been modified since the last known checkpoint, the
extension MUST prompt the user for explicit confirmation before proceeding.
Anchors MUST be re-validated against the current file contents immediately
before applying.

**Delegated edits.** When the extension hands the work to the host IDE's own
agent (chat hand-off), that agent's edits are outside the extension's diff
review and the extension itself writes nothing. In that case the extension MUST
(a) create the checkpoint and capture the audit baseline before dispatch,
(b) tell the user before dispatch that the edits will not go through this
review, (c) never submit the prompt automatically, and (d) offer rollback to the
checkpoint and the audit afterwards.

**Rationale**: AI-applied edits that cannot be undone or that silently destroy
user work are unacceptable. Checkpointing and atomic workspace edits are the
minimum safety guarantees; where the extension cannot review the edits, it
must still make them recoverable and make the loss of review explicit.

**Verification**:
- Integration tests mock `vscode.workspace.applyEdit` and assert it is called
  exactly once per accepted batch, including a batch of only new files (no
  partial writes, no direct `fs` writes).
- A test asserts that when a target file's mtime is newer than the last
  checkpoint timestamp, a confirmation dialog is shown before any write, and
  that a file edited while its diff is open is flagged stale.
- E2E test verifies that `Ctrl+Z` (Undo) after an applied batch restores all
  affected files to their pre-edit state.
- A chat hand-off test asserts: checkpoint exists before the host command runs,
  the prompt is pre-filled and not submitted, and the extension performed no
  workspace write.

---

### VII. Data-Driven Catalog

Providers (including host language-model selectors such as vendor and family),
models, pricing (including historical price records), the phase taxonomy,
optimization strategies (with implementation guidance), platform definitions
(detection heuristics, artifact targets and agent-invocation mechanisms such as
chat commands), and prompt templates MUST reside in the **catalog**, not
hard-coded in extension source files.

Adding a new model, provider, or strategy MUST require only a catalog entry
update — no extension release is required for data-only additions. Platform
artifact paths declared in the catalog MUST be verified against each
platform's current public documentation as part of the catalog CI pipeline.

**Rationale**: Coupling data to code inflates release cadence, slows
community contribution, and makes the extension fragile to external pricing
or model changes.

**Verification**:
- A Zod schema validates every catalog entry at load time; malformed entries
  are rejected with a structured error (not silently ignored).
- The catalog CI job fetches each platform's `docsUrl` and asserts a non-404
  response and a `verifiedAt` newer than the configured age limit; a platform
  entry is served only after a maintainer has checked its artifact targets and
  invocation mechanisms against that documentation (a repository path such as a
  skills folder cannot be fetched as a URL, so this check is human-confirmed).
- A grep/ESLint check fails the build if a model name, host-model vendor or
  family, chat command id or platform artifact path appears as a literal in
  extension source.
- A unit test confirms that adding a catalog entry with a new model ID causes
  `estimate()` to use that model without any source-code change.

---

### VIII. Authoring Gate for Strategies

A strategy entry MUST have `reviewStatus = "approved"` before it is surfaced
in any user-facing UI (strategy list, recommendations, diff view). Entries
with `reviewStatus = "draft"` or `"pending"` MUST be invisible to end users.

Draft implementation content MAY be generated by an LLM to accelerate
authoring. It MUST be reviewed and approved by a human maintainer before the
`reviewStatus` field is set to `"approved"`. The approval MUST be recorded as
a Git commit authored by the reviewing maintainer.

**Rationale**: Unreviewed LLM-generated guidance could contain incorrect,
misleading, or harmful advice. The authoring gate ensures human accountability
for every strategy surfaced to users.

**Verification**:
- The catalog schema (Zod) enforces `reviewStatus` as a string enum
  `["draft", "pending", "approved"]`.
- A unit test asserts that the strategy list returned by the catalog service
  contains only entries where `reviewStatus === "approved"`.
- CI asserts that no `reviewStatus = "approved"` change is present in a commit
  whose author is a known bot account (checked against a `.bots-allowlist` file).

---

### IX. Privacy by Default

Before each LLM call, the extension MUST display to the user exactly what will
be sent: the project description, any code snippets, and the prompt template
in use. The user MUST be able to review and cancel before the request is
dispatched. No LLM call, including a call to the host IDE's model API, may be
made silently.

The extension MUST support a **"Copilot only / no external keys"** mode in
which no requests are sent to any external provider. In this mode, all LLM
features route exclusively through the VS Code Language Model API (`vscode.lm`).

The extension MUST offer **automatic redaction** of obvious secrets (tokens,
passwords, connection strings matching common patterns) from any content
included in an LLM prompt.

Telemetry is **opt-in only** and MUST NEVER include prompt text, code content,
or API keys. The default telemetry state is disabled.

**Rationale**: Users sharing proprietary code or sensitive configuration deserve
transparency and control over what leaves their machine.

**Verification**:
- A unit test asserts that with telemetry disabled (default), no telemetry
  event is dispatched regardless of user actions.
- Integration test asserts that in "Copilot only" mode, calls to external
  provider endpoints are never made (mock `fetch` records zero calls).
- A redaction unit test runs a corpus of strings containing common secret
  patterns and asserts each is replaced with `[REDACTED]` before prompt assembly.
- UI tests assert the "preview prompt" panel is always rendered before
  `postMessage` dispatches the LLM request to the host.

---

### X. Platform-Agnostic Core

The `@token-optimizer/core` package MUST contain zero imports from `vscode`
or any IDE-specific namespace. All IDE integration MUST live in platform-specific
adapter code outside core (the extension package).

Platform artifact paths (settings files, extension directories, workspace roots)
MUST come from the catalog, not from hard-coded strings in the adapter code.
This enables the extension to support new VS Code forks without adapter code
changes — only a catalog update is required.

**Rationale**: Tightly coupling business logic to `vscode` APIs prevents reuse,
makes unit testing difficult, and blocks future multi-platform support.

**Verification**:
- A build-time check (custom ESLint rule or `grep` in CI) fails if any file
  under `packages/core/` contains the string `"vscode"` as an import source.
- Unit tests for `@token-optimizer/core` run in a plain Node.js environment
  with no VS Code test runner; they MUST pass without any VS Code extension host.
- A catalog CI job validates that each `platforms[].artifactTargets` entry is
  marked as checked against the documentation for the corresponding platform version.

---

### XI. Spec-Driven Discipline

All feature development MUST follow this ordered workflow:

> **constitution → specify → clarify → plan → tasks → implement**

`/speckit-analyze` MUST be run after each phase completion and after each
implementation slice. Its findings MUST be logged in `.specify/memory/` and
all `FAIL` or `WARN` items MUST be resolved before the next phase begins.

No implementation work may begin without an approved `tasks.md`. No tasks may
be generated without an approved `plan.md`. No plan may be authored without an
approved `spec.md`. Skipping phases is not permitted.

**Rationale**: Rushing to implementation without structured specification produces
brittle code, misaligned features, and expensive rework. The disciplined phase
gate catches ambiguities when they are cheapest to resolve.

**Verification**:
- CI asserts that every merged PR targeting `main` has a corresponding
  `specs/<feature-id>/` directory with `spec.md`, `plan.md`, and
  `tasks.md` present and non-empty.
- A pre-commit hook runs `speckit-analyze` on the current feature directory and
  exits non-zero if any unresolved `FAIL` findings remain.

---

### XII. Staged Pipeline With a Determinism Boundary

The product MUST be built as four stages with typed inputs and outputs:
**Enhance**, **Estimate**, **Optimize**, **Implement**. Only Enhance and
Implement MAY invoke an LLM. Estimate and Optimize MUST be pure functions of
their inputs and the catalog: Estimate computes tokens and cost for the phases
in the Project Profile, and Optimize pre-selects strategies by evaluating
catalog predicates against the profile, its phase types and the estimate.

Phases are part of the Project Profile. An LLM MAY propose them in Enhance, but
the user MUST confirm them before the profile can be finalised, and every later
stage MUST treat them as profile data, not as LLM output.

**Rationale**: Splitting the product at the point where LLM judgement ends and
auditable computation begins keeps Principle IV enforceable and makes each stage
independently testable.

**Verification**:
- Stage input and output types live in `@token-optimizer/core` with no IDE
  imports.
- A test injects spy provider and host-model adapters and asserts the Estimate
  and Optimize stages make zero calls.
- A golden test shows two profiles that differ only in their confirmed phases
  produce different estimates and, where a catalog predicate depends on the
  phase, a different pre-selected strategy set.

---

## Technical Guardrails

The following constraints apply across all packages in the monorepo and are
enforced at the build and CI level. Violations MUST fail the build.

| Constraint | Enforcement Mechanism |
|---|---|
| TypeScript `strict: true` in all packages | `tsconfig.json` in each package; `tsc --noEmit` in CI |
| `pnpm` monorepo; no `npm` or `yarn` at repo root | CI pre-flight checks for `yarn.lock` / `package-lock.json` |
| No `any` across package boundaries | ESLint `@typescript-eslint/no-explicit-any` set to `error` in boundary packages |
| Zod schemas on every external boundary | All catalog responses, LLM JSON outputs, and webview messages validated via Zod |
| Unit tests for `@token-optimizer/core` | Vitest; minimum 80% statement coverage enforced by CI |
| Golden-file tests for estimation and artifact rendering | Committed JSON/MD snapshots; byte-equality check in CI |
| CI packages for both Marketplace and Open VSX | `vsce package` and `ovsx publish --dry-run` run on every PR |
| No MongoDB URI or write-credential strings in bundle | Semgrep pattern scan; match = build failure |
| No `vscode` import in `packages/core/` | ESLint `no-restricted-imports` rule |
| Secrets never passed to webview or logger | ESLint `no-key-in-webview` custom rule; Semgrep scan |
| LLM calls only from the Enhance and Implement stages | Spy-adapter tests on Estimate and Optimize; no adapter imports in those modules |

---

## Development Workflow

All contributors MUST follow the spec-driven workflow defined in Principle XI.
The steps below elaborate on process expectations:

1. **Specify**: Create `specs/<id>/spec.md` via `/speckit-specify`.
2. **Clarify**: Run `/speckit-clarify` to surface and resolve ambiguities
   before planning begins.
3. **Plan**: Generate `specs/<id>/plan.md` via `/speckit-plan`.
4. **Tasks**: Generate `specs/<id>/tasks.md` via `/speckit-tasks`.
5. **Analyze**: Run `/speckit-analyze` after each phase; resolve all findings.
6. **Implement**: Execute tasks via `/speckit-implement` in dependency order.
7. **Converge**: If implementation diverges, run `/speckit-converge` to surface
   gaps and append remaining work to `tasks.md`.

**Branch strategy**: Feature branches named `feature/<id>-<short-description>`.
All PRs require at least one human reviewer and a passing CI run. Squash-merge
to `main`; no force-pushes to `main`.

**Release cadence**: Catalog-only updates may ship as patch releases without a
full development cycle. Source code changes require the full speckit flow.

---

## Governance

This constitution supersedes all other project guidelines, ADRs, and
README-level practices. In cases of conflict, the constitution wins.

**Amendment procedure**:
1. Open a PR with the proposed changes to this file and a written rationale.
2. The PR must include an updated `SYNC IMPACT REPORT` comment at the top of
   the file reflecting the version delta.
3. At least two maintainers must approve the PR.
4. The `CONSTITUTION_VERSION` MUST be incremented following semantic versioning:
   MAJOR for principle removals or redefinitions, MINOR for new principles or
   materially expanded guidance, PATCH for clarifications and wording fixes.

**Versioning policy**:
- `MAJOR.MINOR.PATCH` following the semantic rules above.
- Version is the single source of truth; `LAST_AMENDED_DATE` MUST be updated
  to the merge date of the amending PR.

**Compliance review**:
- Maintainers MUST review constitution compliance as part of every sprint
  retrospective.
- Any principle that cannot be verified by its stated mechanism MUST be amended
  or removed within the same sprint.
- The pre-commit hook and CI guardrail checks serve as the continuous automated
  compliance layer.

All PRs and code reviews MUST verify that no principle listed here is violated.
Complexity that cannot be justified against these principles MUST NOT be merged.

**Version**: 1.1.0 (proposed) | **Ratified**: 2026-10-07 | **Last Amended**: 2026-10-08 (pending amendment PR)
