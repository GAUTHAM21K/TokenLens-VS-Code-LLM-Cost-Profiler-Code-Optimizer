# Optimizer golden fixtures (TS ↔ Python parity)

Format: one case per `*.json`, validated by `OptimizerFixtureCaseSchema`
(`packages/core/src/protocol/fixtures.ts`). Both suites run every case:

- Vitest (Track B): `core/src/optimizer` techniques.
- pytest (Track C): `ai_optimizer.techniques.optimize_text` (text cases) /
  `optimize_request` (messages cases; returns `(messages, params)`, `params` holds request params such as `max_tokens`).

Rules: `techniques` run in **list order**; `config[<techniqueId>]` overrides that technique's
catalog `optimizer.params`; output must equal `expected` **byte for byte**. Add cases freely;
never change the format (frozen contract).

Semantics pinned by the Phase 0 cases (tracks define the rest via new cases, in both runtimes):

| technique | rule |
|---|---|
| `whitespace-normalize` | per text: `\r\n`→`\n`; drop lines that are only `---`/`***`/`___` (3+); collapse runs of spaces/tabs after the leading indentation to one space; strip trailing whitespace; collapse 2+ blank lines to one; trim the whole text |
| `max-output-cap` | `params.max_tokens = min(existing, maxTokens)` (or `maxTokens` if absent); messages untouched; no-op for text |
| `cache-prefix-ordering` | stable partition: all `system` messages first, others keep their order; no-op for text |
| `caveman-output` | append `"\n\n" + instruction` to the first system message, or insert `{role: system, content: instruction}` at index 0 if none; text: append `"\n\n" + instruction` |
| `filler-removal` | text, or each string `content` of `system`/`user` messages (`assistant` untouched). `params.phrases` processed longest first (ties keep list order); remove every case-insensitive occurrence matching `(?<![A-Za-z0-9])` + escaped phrase + `(?![A-Za-z0-9])`. Then **only on lines where something was removed**: collapse runs of spaces/tabs to one space; remove spaces directly before `, . ; : ! ?`; remove one leading `", "` or `","`; trim; if the original line started with an uppercase letter and now starts with a lowercase one, uppercase that character. A fully removed line stays as an empty line. No other changes |
| `dedupe-sentences` | scope = the whole text, or ALL string contents of a request in message order (all roles). Line by line, split at `(?<=[.!?])\s+`; key = lowercase → collapse whitespace to one space → strip trailing `.!?` → trim; drop a sentence whose non-empty key was seen earlier in scope; re-join kept sentences with one space. A line that had sentences but lost all of them is removed; originally empty lines are kept; an emptied message keeps its role with content `""` |

Track B cases are named `b-*.json` (filler-removal, dedupe-sentences, and combinations).

Phase 2 integration cases are named `p2-*.json` (e.g. `p2-whitespace-normalize-roles`: whitespace-normalize applies to every role).
