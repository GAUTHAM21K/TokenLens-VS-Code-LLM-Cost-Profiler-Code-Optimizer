# Host harness

Runs the **real built** extension host (`packages/extension/dist/extension.js`) in Node with a
mocked `vscode` module. Build first: `npx -y pnpm@12.10.1 -r build`.

| command | use |
|---|---|
| `npx -y pnpm@12.10.1 harness:check <scenario> [--api-url URL] [--verbose]` | scripted, asserting; exit code ≠ 0 on failure (gate tool) |
| `npx -y pnpm@12.10.1 harness:check --list` | list scenarios |
| `npx -y pnpm@12.10.1 harness:serve [--seed-profile] [--catalog-url URL] [--port 5177]` | real webview in a browser at http://localhost:5177 |

Scenarios live in `scenarios/<name>.cjs` and export `{ description, run(ctx) }`; `ctx` gives
`createHost({ config, seedProfile, workspaceDir })`, `assert`, `step`, `args`,
`startStubCatalogApi()`, `closedPort()`, `sleep()`. A host exposes `activate()`, `openView()`,
`send(msg)`, `waitFor(type, predicate, timeoutMs)`, `messages`, `deactivate()`.

Phase 1 tracks add their own scenario file (`estimate-flow`, `promptopt-rules`,
`implement-flow`, `router-preview`).

Track D scenarios: `implement-flow` (export -> scan -> apply / skip / stale / diff / undo on a temp
copy of `examples/demo-langchain-app`) and `router-preview` (config, live preview, save, export).
Both run offline (`catalogApiUrl: ""`) with no keys. For them the mock gained, additively:
`createHost({ tempWorkspaceFrom })` (temp-dir workspace, removed on `deactivate()`; env
`HARNESS_TEMP_WORKSPACE_FROM=examples/demo-langchain-app` does the same for `harness:serve`),
`WorkspaceEdit` / `workspace.applyEdit` / `openTextDocument` (in-memory documents; `save()` writes
to disk), `findFiles`, `registerTextDocumentContentProvider`, `Position` / `Range` / `Uri.from`, and
host helpers `appliedEdits`, `diffs` (recorded `vscode.diff`), `documentText(rel)`,
`setDocumentText(rel, text)` (simulated typing) and `undo()` (last applyEdit). If a track needs more of the `vscode` API mocked (e.g. `WorkspaceEdit`,
`workspace.applyEdit`, `findFiles`), extend `lib/host.cjs` additively and say so in the gate report.

The old `--replay-catalog` workaround is gone: the catalog delivery race is fixed (task 0.5) and
`catalog-delivery` guards it.
