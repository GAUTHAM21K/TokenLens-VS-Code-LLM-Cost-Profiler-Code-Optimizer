# Quickstart Validation Guide: Token Optimizer

**Phase**: 1 | **Date**: 2026-10-07 | **Plan**: [plan.md](plan.md)

This guide describes how to validate that the Token Optimizer extension works end-to-end
without reading implementation details. Follow each scenario in order; each one proves
an independently testable slice of the feature.

---

## Prerequisites

| Requirement | How to satisfy |
|---|---|
| pnpm 9+ installed | `npm i -g pnpm` |
| Node.js 20 LTS | `node --version` → `v20.x` |
| VS Code 1.90+ (or any supported fork) | Install from marketplace |
| MongoDB accessible (for catalog-api) | Local or Atlas; URI in `MONGO_URI` env var |
| At least one LLM provider API key | Anthropic, OpenAI, Google, or Mistral |

---

## Scenario 0: Monorepo builds clean

**Goal**: Confirm TypeScript strict compilation, linting, and unit tests pass before any
manual testing.

```bash
# From repo root
pnpm install
pnpm -r build              # all packages compile
pnpm -r lint               # no ESLint violations (including no-vscode-in-core, no-key-in-webview)
pnpm --filter @token-optimizer/core test   # Vitest unit + golden-file tests
```

**Expected outcomes**:
- Zero TypeScript errors across all packages.
- Zero lint errors; in particular the `no-vscode-in-core` rule emits no violations.
- All Vitest tests pass; golden-file tests report no diff.
- Secret-scan step (`pnpm secret-scan`) reports zero matches.

---

## Scenario 1: Catalog API serves the snapshot

**Goal**: Confirm the read-only Catalog API returns a valid snapshot with ETag support and
serves only `reviewStatus="approved"` strategies.

```bash
# Start the catalog API (dev mode)
pnpm --filter @token-optimizer/catalog-api dev

# 1. Fetch full snapshot
curl -i http://localhost:3001/v1/catalog

# Expected: HTTP 200, Content-Type: application/json, ETag header present
# Body: { version: <integer>, schemaVersion: "1.0", providers: [...], strategies: [...], ... }

# 2. ETag revalidation
ETAG=$(curl -si http://localhost:3001/v1/catalog | grep -i etag | awk '{print $2}')
curl -i -H "If-None-Match: $ETAG" http://localhost:3001/v1/catalog

# Expected: HTTP 304 Not Modified, empty body

# 3. Confirm only approved strategies are returned
curl http://localhost:3001/v1/catalog/strategies | jq '[.items[] | select(.reviewStatus != "approved")] | length'

# Expected: 0
```

**Validation**: JSON body passes Zod schema validation in `packages/core` (run
`pnpm --filter @token-optimizer/catalog-tools validate` to check all DB documents).

---

## Scenario 2: Offline fallback snapshot loads in the extension

**Goal**: Confirm the extension starts and all catalog-dependent screens load when the
Catalog API is unreachable, using the bundled snapshot.

**Steps**:
1. Disconnect from the network or stop the catalog-api process.
2. Open VS Code with the extension installed (use `F5` in the extension package or install
   the VSIX from `packages/extension`).
3. Open the Token Optimizer sidebar panel.

**Expected outcomes**:
- The Login/Onboarding screen loads within 5 seconds.
- A "Working offline — using bundled catalog (v<N>)" notice is displayed.
- The provider list and model list are populated from the bundled snapshot.
- No JavaScript errors appear in the webview developer console.

---

## Scenario 3: Provider key setup and masking

**Goal**: Confirm a key can be saved, is immediately masked, and is never echoed in any
message.

**Steps**:
1. Open the Token Optimizer onboarding screen.
2. Select any provider (e.g., Anthropic).
3. Enter a valid API key and click Save.

**Expected outcomes**:
- The key input field clears immediately after Save is clicked.
- The provider row shows `...XXXX` (last 4 characters only).
- The VS Code Output panel (Token Optimizer channel) contains no key string.
- Opening the Settings → Providers view shows the same masked display.

**Invalid key check**:
1. Enter a deliberately malformed key (e.g., `invalid-key`).
2. Click Save.

**Expected outcomes**:
- A clear error message "Invalid API key" appears in the UI.
- The key is not stored (re-opening the panel shows no key for that provider).

---

## Scenario 4: Enhance produces a valid Project Profile

**Goal**: Confirm the Enhance step returns a schema-valid ProjectProfile and costs are shown.

**Steps**:
1. Open a workspace folder containing a `package.json` or `requirements.txt`.
2. Navigate to the Enhance tab.
3. Observe the pre-filled description draft (auto-scanned from workspace manifests).
4. Edit the description if desired, then press `Ctrl+Enter` (or `Cmd+Enter` on macOS).

**Expected outcomes**:
- A loading indicator appears; the narrative streams in character by character.
- After completion, the cost of the call is shown (e.g., "Input: 1,234 tokens • Output: 856 tokens • $0.0012").
- The Project Profile panel shows valid JSON matching the schema at
  `contracts/project-profile.schema.json`.
- Running Enhance a second time on modified text produces a refined output without
  duplicate sections.

**Invalid JSON repair check**:
- Use a mock provider (see `packages/fixtures/mocks/malformed-profile-provider.ts`) that
  returns truncated JSON. Confirm:
  - One automatic repair attempt is made (visible in the extension Output channel).
  - If repair fails, a clear error is shown and the previous profile version is preserved.

---

## Scenario 4b: Phases are verified in Enhance and drive estimation and pre-selection

**Goal**: Prove FR-052, FR-017 and FR-026.

1. Run Enhance on the fixture description. Expected: BUILD and RUNTIME phases are listed, each with a catalog phase type.
2. Change one phase's type and remove another. Expected: no LLM call is made; a new draft version appears.
3. Try to finalise with an unconfirmed phase. Expected: refused with a message naming the phase.
4. Finalise, open Estimate. Expected: exactly the confirmed phases appear and numbers match the golden fixture for that profile.
5. Open Optimize, then go back and remove the retrieval phase and finalise again. Expected: the pre-selected strategies change
   and no retrieval-triggered reason remains.

---

## Scenario 5: Estimation produces deterministic, traceable numbers

**Goal**: Confirm estimation is identical on repeated runs and every number has an Explain
popover.

**Steps**:
1. With a finalised Project Profile, navigate to the Estimate tab.
2. Note the total BUILD cost for any enabled model.
3. Close and reopen the panel.
4. Navigate back to Estimate.

**Expected outcomes**:
- The numbers are identical to step 2 (deterministic).
- Click the "Explain" icon (ⓘ) next to any cost figure. A popover appears showing:
  - The formula (e.g., `calls × tokensPerCall × (1 + retryRate) × pricePer1MTok / 1_000_000`)
  - All input values with their sources (catalog default or user override).
- Edit any phase assumption (e.g., increase "Calls per phase" for "Architecture").
- All affected cost figures update immediately without a page reload.
- RUNTIME costs show per-request, per-user-day, and per-month columns.

**Golden-file validation** (automated):
```bash
pnpm --filter @token-optimizer/core test:golden
# Compares estimate outputs against fixtures/estimates/*.json
# Any deviation fails the test.
```

---

## Scenario 6: Strategy selection — applicability, conflicts, savings

**Goal**: Confirm strategies are pre-selected from profile predicates, conflicts are
enforced, and savings are multiplicative.

**Steps**:
1. Navigate to the Optimize → Strategies tab with a finalised profile.

**Expected outcomes**:
- Only `reviewStatus="approved"` strategies appear.
- Pre-selected strategies each display a human-readable reason (e.g., "Your project uses
  RAG with an average prefix of 2,048 tokens — prompt caching can reduce input costs").
- Attempt to select two strategies that are in each other's `conflicts` list. The UI
  prevents it and shows the conflict explanation inline.
- Select 3 non-conflicting strategies with declared savings [10%-20%], [5%-15%], [8%-12%].
  The combined savings panel shows a range computed as:
  `[1-(0.9×0.95×0.92), 1-(0.8×0.85×0.88)] = [~23%, ~40%]` (not the sum ~40%+).
- The basis string and source for each strategy's savings range is visible.

---

## Scenario 7: Generate files — idempotency and diff-before-overwrite

**Goal**: Confirm `.ai-optimizer/` is created correctly and existing files are not
silently overwritten.

**Steps**:
1. With strategies selected, click "Generate files".
2. Inspect the created workspace:

**Expected file tree**:
```
.ai-optimizer/
├── optimizer.yaml
├── baseline.json          (empty baseline, filled after Apply now)
├── project/
│   ├── architecture.md
│   ├── requirements.md
│   ├── constraints.md
│   └── profile.json
├── strategies/
│   └── <strategy-id>.md   (one per selected strategy)
└── commands/
    ├── analyse.md
    ├── optimise.md
    ├── implement.md
    └── audit.md
```

- For the detected platform (e.g., Cursor), confirm a `.cursorrules` file (or the
  catalog-declared path for that platform) was also written.

**Idempotency check**:
1. Manually edit `.ai-optimizer/optimizer.yaml`.
2. Run Generate files again.

**Expected outcome**: A diff view appears showing the difference between the existing and
generated content. The file is not updated until the user clicks "Accept".

**Checkpoint check**:
- If a git repository is present: `git stash list` shows a new stash entry
  `"token-optimizer: pre-apply checkpoint <timestamp>"` created before any write.

---

## Scenario 8: Apply now — structured proposals, atomic undo, stale-anchor skip

**Goal**: Confirm Apply now produces structured proposals, applies atomically, and skips
stale hunks.

**Setup**: Use the fixture workspace at `fixtures/projects/ts-rag-chatbot/` which contains
known LLM call sites.

**Steps**:
1. Open `fixtures/projects/ts-rag-chatbot/` as the workspace.
2. Run a full Enhance → Estimate → Strategy selection flow.
3. Select a detection-capable strategy (e.g., "Prompt Prefix Caching").
4. Click "Apply now".

**Expected outcomes during scanning**:
- Progress indicator shows "Scanning workspace… 12/34 files".
- Only `.ts`, `.js`, and `.py` files are scanned (v1 scope); other languages are listed
  as skipped in the progress output.

**Expected outcomes in diff view**:
- Each proposed change shows: file path, the original snippet, the replacement, and the
  rationale from the strategy.
- The proposal is structured (not free-form text).

**Stale-anchor test**:
1. While the diff view is open (before accepting), manually edit one of the target files
   to change the relevant code.
2. Click "Apply".
3. **Expected**: The stale hunk is skipped with a message "Anchor no longer matches in
   `src/llm.ts:42` — skipped". The other hunks apply normally.

**Atomic undo**:
1. Accept and apply a set of hunks.
2. Press `Ctrl+Z` (or `Cmd+Z`) once.
3. **Expected**: All applied changes are reverted in one step. The workspace returns to
   its pre-apply state.

**Cancel test**:
1. Start Apply now, wait for scanning to begin.
2. Click the cancel button.
3. **Expected**: The workspace is completely unchanged.

---

## Scenario 9: Catalog freshness and schema version guard

**Goal**: Confirm ETag revalidation, offline fallback, and schema-version forward-compat.

**Steps**:
1. Start the extension with network access. Check the status bar for "Catalog v<N> — updated <date>".
2. Restart the extension without changing the catalog. Observe the HTTP request in the
   extension Output channel.

**Expected**: `304 Not Modified` — local cache used, no re-parse.

**Offline fallback**:
1. Stop the catalog-api. Restart VS Code.
2. **Expected**: The bundled snapshot loads; "Working offline" notice appears. All screens
   are usable.

**Schema version guard**:
1. Manually bump `schemaVersion` in the catalog-api response to `"99.0"`.
2. Restart the extension.
3. **Expected**: The extension falls back to its cached snapshot and displays "Extension
   update available — catalog schema v99.0 is newer than supported v1.0". It does not crash.

---

## Scenario 10: End-to-end fixture runner (automated)

**Goal**: Full pipeline validation without a human in the loop.

```bash
# Run the complete fixture pipeline with mocked LLM responses
pnpm --filter @token-optimizer/fixtures run e2e

# The runner:
# 1. Loads fixtures/projects/ts-rag-chatbot/ as the workspace
# 2. Runs Enhance with a mocked LLM (fixtures/mocks/enhance-response.json)
# 3. Asserts the ProjectProfile matches fixtures/profiles/ts-rag-chatbot.json
# 4. Runs Estimate and asserts output matches fixtures/estimates/ts-rag-chatbot.json (golden)
# 5. Runs Generate files and asserts .ai-optimizer/ matches fixtures/artifacts/ts-rag-chatbot/
# 6. Runs Apply now with a mocked planner and asserts proposed edits match fixtures/proposals/
# 7. Accepts all proposals and verifies the workspace file diffs match expected patches
```

**Expected**: All assertions pass. Any deviation surfaces the diff and fails the run.

---

## Scenario 11: Implement via Install and via the IDE agent

**Goal**: Prove both implementation routes (US6, US7, FR-053 to FR-058).

1. Select two approved strategies on a platform whose catalog entry has a `skill` target and choose **Install**. Expected: a review
   list of files; after confirming, skill folders (`SKILL.md` plus supporting files) at the catalog-declared location, the neutral
   copy under `.ai-optimizer/`, one undo step removes everything, and a checkpoint exists.
2. Repeat on a platform with only instruction or rule targets. Expected: those files are written instead.
3. Choose **IDE agent** on a host where the catalog's first mechanism (`lm-edit`) is available. Expected: proposals appear as
   structured diffs with per-hunk accept; edit one target file before accepting and the changed hunk is flagged stale; accepted
   hunks apply in one undo step.
4. Cancel at any point before applying. Expected: workspace unchanged.
5. Use a test catalog where `lm-edit` is absent and `chat-handoff` is present. Expected: prompt preview with redaction count and the
   notice that host-agent edits are outside diff review; on confirm, checkpoint and baseline exist, chat opens pre-filled and not
   submitted, and the extension itself wrote no files.
6. Remove both. Expected: prompt copied to the clipboard, nothing written.

---

## References

- [data-model.md](data-model.md) — entity schemas and state transitions
- [contracts/catalog-api.yaml](contracts/catalog-api.yaml) — OpenAPI 3.1 spec
- [contracts/webview-messages.ts](contracts/webview-messages.ts) — message protocol
- [contracts/project-profile.schema.json](contracts/project-profile.schema.json) — profile schema
- [plan.md](plan.md) — technical context and constitution check
- [research.md](research.md) — design decisions and rationale
