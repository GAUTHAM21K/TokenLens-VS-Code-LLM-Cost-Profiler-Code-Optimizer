# Token Optimizer: 10-minute demo script

For the human presenter. It walks through the four features (estimator, prompt optimizer,
Implement, model router) on the bundled demo app, against the local Catalog API, and ends with
the optimized app running on Groq.

Live requests during the demo: **1** for Enhance (optional) and **4** for the demo app run
(summarize, classify, and the agent, whose tool round-trip makes two requests). Everything else
is local.

---

## 0. Setup (before the audience arrives, about 5 minutes)

Run these from the repo root (`<repo-root>`). No global pnpm is needed.

```bash
npx -y pnpm@12.10.1 install --frozen-lockfile
```

```bash
npx -y pnpm@12.10.1 -r build
```

Start the catalog. This runs local MongoDB, migrations, seed, publish (`--no-snapshot` leaves the
bundled offline snapshots alone), then the API on
127.0.0.1:3000. Leave this terminal open:

```bash
npx -y pnpm@12.10.1 catalog:dev --no-snapshot
```

Make a fresh, disposable copy of the demo app (`.demo-workspace/`, gitignored), so the tracked
`examples/demo-langchain-app` stays untouched:

```bash
npx -y pnpm@12.10.1 demo:workspace
```

Pick **one** way to run the extension:

- **A. F5 (Extension Development Host).** Open the repo in VS Code. In *Run and Debug*, choose
  **Run Extension (demo workspace)** and press F5. A second window opens on `.demo-workspace`.
- **B. Installed VSIX in a clean profile.**
  ```bash
  npx -y pnpm@12.10.1 package:vsix
  ```
  The profile must exist before `--install-extension` can target it. The first time, open
  `code --profile TokenOptDemo` once, close that window, then install:
  ```bash
  code --profile TokenOptDemo
  ```
  ```bash
  code --profile TokenOptDemo --install-extension packages/extension/token-optimizer.vsix
  ```
  ```bash
  code --profile TokenOptDemo .demo-workspace
  ```

Prepare the Python side in `.demo-workspace` once (the scanner skips `.venv`). These are
Windows paths; on macOS/Linux use `.venv/bin/pip`:

```bash
cd .demo-workspace && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
```

In the extension window, open the **Token Optimizer** view from the activity bar (the gauge
icon). The header badge must say **Catalog Connected** (green).

**For presenting, use the editor view.** Click the expand icon (↗, *Open in editor*) in the panel
header, or run **Token Optimizer: Open Optimizer Panel** from the Command Palette. The same UI
opens full width in an editor tab, sharing state with the sidebar. The sidebar works at its
default narrow width too: tabs collapse to icons (hover for the name, and the active tab keeps
its label). Then go to **Settings** and do the key step below.

### Groq key (Settings tab)

1. **Target Provider**: choose **Groq**.
2. Paste the Groq key into *Paste key here (write-only)...* and click **Save Key**. The key goes
   to VS Code SecretStorage only. It is never shown again and never logged.
3. Under *Enabled Models for Optimization*, keep the three Groq models ticked
   (`openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`).

---

## 1. Enhance → profile (1.5 min)

**Say:** "We start from a plain-English description of the AI feature."

1. Open **Enhance**. Click **Scan Workspace**. Chips with the scanned signals appear, and the
   description box gets a draft built from the workspace manifests and README.
2. Replace or extend the description with:

   > A customer-support assistant in Python + LangChain on Groq. An agent with an order-lookup
   > tool answers about 2,000 tickets a day. Each request sends a 1,200-token shared system
   > prompt plus knowledge snippets, a ~300-token user message, and gets ~300 tokens back. A
   > nightly job summarizes and classifies every ticket.

3. Click **Enhance Profile** (1 Groq request; the Enhance model is the first enabled model unless
   you pick another in Settings). The architecture narrative and the BUILD / RUNTIME phases appear.
4. Click **Finalize Profile**.

*If you want zero live calls:* skip step 3. A finalized profile from earlier runs loads from
*Version History & Diff*.

## 2. Estimate (1.5 min)

**Say:** "Monthly cost per model, with every number explained."

1. Open **Estimate**. The per-phase tables and the model-comparison table show low / expected /
   high cost for 7 models, **including the three Groq models**.
2. Click **Explain** on a phase: the popover shows the formula and inputs (calls × retries ×
   tokens × price).
3. Point at the two columns **Build w/ selected techniques** and **Runtime w/ selected
   techniques**. Hover a cell: the tooltip shows the input saving applied to input spend and the
   output saving applied to output spend.

## 3. Optimize (techniques) (1 min)

**Say:** "The catalog recommends techniques for *this* profile and explains why."

1. Open **Optimize**. The techniques that apply to this profile are pre-selected, each with a
   reason (e.g. "Shared prefix of 1200 tokens qualifies for prompt caching."). The others say why
   they were left out.
2. Read the **Runtime Savings** card, a range (all 7 techniques give roughly 25–80 %). The basis
   line says how it is computed: input techniques on the input share of cost, output techniques
   on the rest. They are never compounded together.
3. Untick `cache-prefix-ordering` and `llm-compress`. The savings card and the Estimate columns
   update at once.

## 4. Prompt Optimizer (1.5 min)

**Say:** "The same techniques, applied to a real prompt."

1. Open **Prompt Optimizer**. Model: the Groq `openai/gpt-oss-20b` entry.
2. Under *Rule techniques (local, deterministic)*, keep `whitespace-normalize`,
   `filler-removal`, `dedupe-sentences`, `caveman-output`, `max-output-cap` ticked. Leave the
   LLM technique off (it would call Groq).
3. Paste this prompt and click **Optimize** (or Ctrl+Enter):

   ```
   Please could you kindly read the following customer support ticket very carefully and then write a short summary of it.   Please keep it short.


   Ticket: my order A100 was charged twice. Please keep it short.
   ```

4. Show the result: the optimized prompt, a per-step token table (each input rule shrinks the
   prompt; `caveman-output` adds a short system instruction that cuts *output* tokens), and the
   **$ per 1k calls** before → after.

## 5. Implement (2.5 min)

**Say:** "Now we put the optimizations into the code, one reviewed block at a time."

1. Open **Implement**. Feature: **Both** (prompt optimizer + model router). The rule techniques
   from the Optimize tab are pre-ticked.
2. Click **Export ai_optimizer**. "Exported 6 files to ai_optimizer/" appears, and the folder
   shows up in the Explorer: `techniques.py`, `router.py`, `middleware.py`, and two JSON configs.
3. Click **Scan workspace**: "4 blocks in 4 files".
   - `reply_drafter.py` (multi-line `stream`), `summarizer.py` ×2 (`llm.invoke`): routed with
     `get_model(arg, temperature=…)` *and* the input wrapped in `optimize_messages(...)`.
   - `support_agent.py`: `create_agent(...)` gets
     `middleware=[PromptOptimizationMiddleware([...]), ModelRouterMiddleware()]`.
4. On the first `summarizer.py` block click **Open diff**. VS Code's native diff opens. Close it
   and click **Apply**. The file changes, and the `import` lines are added once.
   - Note that the second `summarizer.py` block's `file:line` label moved down by the added lines.
5. Open `summarizer.py`, press **Ctrl+Z** to show that the apply is one undoable edit, then
   **Ctrl+Y** to redo it. (The block stays marked *applied* in the list.)
6. Click **Skip** on `reply_drafter.py` (it isn't called by `main.py`), then **Apply all
   remaining**.

## 6. Router (1 min)

**Say:** "Cheap model for easy prompts, strong model only when needed."

1. Open **Router**. The tier table comes from the catalog: economy `openai/gpt-oss-20b`,
   standard `openai/gpt-oss-120b`, advanced `qwen/qwen3.8-27b`.
2. Type into *Route this prompt*:
   - `Summarize: order A100 was charged twice.` → **economy** (short prompt)
   - `Analyze the architecture trade-offs of our refund pipeline.` → **advanced** (keyword)
   - tick **Request uses tools** with `What is the status of order A100?` → **standard**
3. Optional: change *maxCharsForEconomy*, then click **Save config** and **Export to ai_optimizer**.

## 7. Run the optimized app (1 min, 4 Groq requests)

In a terminal in `.demo-workspace` (PowerShell shown):

```powershell
$env:GROQ_API_KEY = "<your key>"; .venv\Scripts\python main.py
```

Output from the Phase 2 run (the model text varies). There is one `ai_optimizer: route:` line per model
call. The two agent calls are the tool call and the final answer. The agent's prompt (system prompt
plus tool schema) is longer than 600 chars, so it routes to the default tier, standard:

```
ai_optimizer: route: economy groq/openai/gpt-oss-20b (289 chars <= 600)
ai_optimizer: route: economy groq/openai/gpt-oss-20b (219 chars <= 600)
ai_optimizer: route: standard groq/openai/gpt-oss-120b (default tier)
ai_optimizer: route: standard groq/openai/gpt-oss-120b (default tier)
summary: Order A100 double-charged. Request status check and duplicate refund.
label: billing
agent: Shipped
```

## 8. Offline fallback (30 s, optional)

Stop `catalog:dev` (Ctrl+C), then reload the window (*Developer: Reload Window*). The badge
turns amber, **Snapshot from <date>**, and every tab keeps working from the bundled snapshot.

---

### Reset between runs

```bash
npx -y pnpm@12.10.1 demo:workspace
```

This refreshes `.demo-workspace` from the tracked demo app. It empties the folder's contents rather than
deleting the folder, so it works while the folder is open in VS Code or a terminal. Files that are
locked are skipped with a message, and an existing `.venv` is kept.
