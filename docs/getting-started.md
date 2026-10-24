# Getting started

Everything runs from the repo root. pnpm is not needed globally: use `npx -y pnpm@12.10.1 …`.
Requirements: Node 20+, Python 3.10+ (for the Python runtime and the demo app), VS Code 1.90+.

## 1. Install and build

```bash
npx -y pnpm@12.10.1 install --frozen-lockfile
```

```bash
npx -y pnpm@12.10.1 -r build
```

The extension build also copies `packages/python-runtime/ai_optimizer` into
`packages/extension/resources/python/` (generated, gitignored), which is what Implement exports.

## 2. Catalog (models, pricing, techniques, router preset)

```bash
npx -y pnpm@12.10.1 catalog:dev --no-snapshot
```

This starts a local `mongod` (cached binary, data in `.data/mongo`), or uses `MONGODB_URI` when it
is set (e.g. Atlas), then migrates, seeds, approves the seeded techniques as `CATALOG_REVIEWER`
(set it in `.env`), publishes, and serves the API on `http://127.0.0.1:3000/v1` (the extension's
default `tokenOptimizer.catalogApiUrl`).

- Without `--no-snapshot` it also regenerates the bundled offline snapshots
  (`packages/{extension,core}/resources/catalog-snapshot.json`); do that only when catalog data
  changed, and commit them.
- Seed data lives in `packages/catalog-tools/data/seed/<collection>.json`. Pricing rows must
  already be effective (`effectiveFrom` ≤ publish time); seed and publish refuse otherwise.
- With the API down the extension falls back to the bundled snapshot (header badge: amber
  "Snapshot from <date>").

## 3. Run the extension

**F5:** open the repo in VS Code, run **Run Extension (demo workspace)** (it opens `.demo-workspace`,
a disposable copy of the demo app made by `npx -y pnpm@12.10.1 demo:workspace`), or **Run Extension**
for an empty window.

**VSIX:**

```bash
npx -y pnpm@12.10.1 package:vsix
```

Install into a separate profile. The profile must exist first: open `code --profile TokenOptDemo`
once and close that window, then install:

```bash
code --profile TokenOptDemo
```

```bash
code --profile TokenOptDemo --install-extension packages/extension/token-optimizer.vsix
```

In the Token Optimizer view, open **Settings**, choose **Groq** as Target Provider, paste your key,
**Save Key** (stored in VS Code SecretStorage only), and keep the Groq models enabled.

Settings (`tokenOptimizer.*`): `catalogApiUrl` (empty = offline only), `implement.exportDir`
(default `ai_optimizer`).

## 4. Use it

Follow [demo-script.md](demo-script.md): Enhance → Estimate → Optimize → Prompt Optimizer →
Implement → Router, then run the optimized app.

## 5. The exported Python package

`ai_optimizer` is stdlib-only for techniques and routing; LangChain is imported lazily by
`ai_optimizer.middleware` and `get_model`. Pins: `packages/python-runtime/requirements.txt`
(`langchain==1.4.4`, `langchain-groq==1.1.3`). Router decisions are logged on the `ai_optimizer`
logger at INFO. Usage: [packages/python-runtime/README.md](../packages/python-runtime/README.md).

## 6. Development checks

```bash
npx -y pnpm@12.10.1 lint
```

```bash
npx -y pnpm@12.10.1 -r test
```

```bash
npx -y pnpm@12.10.1 test:tools
```

```bash
npx -y pnpm@12.10.1 secret-scan
```

```bash
npx -y pnpm@12.10.1 harness:check --list
```

Tests that start MongoDB use the cached binary; set `MONGOMS_SYSTEM_BINARY` to it if the download
is blocked. Python:

```bash
pip install -r packages/python-runtime/requirements-dev.txt -r packages/python-runtime/requirements.txt
```

```bash
pytest packages/python-runtime
```

Live provider check (one validateKey + one tiny completion per key found in env or `.env`; never
prints keys):

```bash
npx -y pnpm@12.10.1 smoke:live
```
