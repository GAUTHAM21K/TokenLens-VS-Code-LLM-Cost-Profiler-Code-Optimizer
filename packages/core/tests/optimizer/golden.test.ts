/**
 * Runs every golden case in packages/fixtures/optimizer/*.json through the TS rule techniques
 * (list order, catalog params from the bundled snapshot, `config` overrides) and requires a
 * byte-for-byte match. The Python runtime runs the same cases (parity).
 *
 * Exports: none (test suite)
 * Feature: prompt optimizer (parity tests)
 */
import { describe, it, expect } from "vitest";
import {
  CatalogSnapshotSchema,
  OptimizerFixtureCaseSchema,
  minifyStructuredDataText,
  optimizeRequest,
  optimizeText,
} from "../../src/index.js";

const snapshot = CatalogSnapshotSchema.parse(
  Object.values(
    import.meta.glob("../../resources/catalog-snapshot.json", { eager: true, import: "default" })
  )[0]
);
const cases = Object.entries(
  import.meta.glob("../../../fixtures/optimizer/*.json", { eager: true, import: "default" })
).map(([p, data]) => [p.split("/").pop() as string, OptimizerFixtureCaseSchema.parse(data)] as const);

describe("optimizer golden fixtures", () => {
  it("covers every rule technique", () => {
    const used = new Set(cases.flatMap(([, c]) => c.techniques));
    for (const id of [
      "whitespace-normalize",
      "filler-removal",
      "dedupe-sentences",
      "cache-prefix-ordering",
      "caveman-output",
      "max-output-cap",
    ]) {
      expect(used.has(id), id).toBe(true);
    }
  });

  it("minifies valid JSON without changing surrounding text or malformed data", () => {
    expect(minifyStructuredDataText('Payload: { "name": "A", "items": [ 1, 2 ] } done.'))
      .toBe('Payload: {"name":"A","items":[1,2]} done.');
    expect(minifyStructuredDataText('```json\n{ "ok": true }\n```')).toBe('```json\n{"ok":true}\n```');
    expect(minifyStructuredDataText('```json\n{ broken }\n```')).toBe('```json\n{ broken }\n```');
    expect(optimizeText('Payload: { "ok": true } done.', ["whitespace-normalize"]))
      .toBe('Payload: { "ok": true } done.');
    expect(optimizeText('Please { "name": "A" }', ["filler-removal"], {
      config: { "filler-removal": { phrases: ["please"] } },
    })).toBe('{ "name": "A" }');
  });

  it("preserves the exact system prefix while appending output directives", () => {
    const systemPrefix = 'Static  system\n{"stable": true}';
    const optimized = optimizeRequest(
      {
        messages: [
          { role: "system", content: systemPrefix },
          { role: "user", content: "Please summarize this." },
        ],
        params: {},
      },
      ["cache-prefix-ordering", "whitespace-normalize", "caveman-output"],
      { config: { "caveman-output": { instruction: "Be terse." } } }
    );
    expect(optimized.messages[0]!.content).toBe(systemPrefix);
    expect(optimized.messages[1]).toEqual({ role: "system", content: "Be terse." });
    expect(optimized.messages[2]!.content).toBe("Please summarize this.");
  });

  it.each(cases)("%s", (_file, c) => {
    const opts = { strategies: snapshot.strategies, config: c.config };
    if (c.input.kind === "text") {
      const out = optimizeText(c.input.text, c.techniques, opts);
      expect(c.expected.kind).toBe("text");
      if (c.expected.kind === "text") expect(out).toBe(c.expected.text);
    } else {
      const out = optimizeRequest(
        { messages: c.input.messages, params: c.input.params ?? {} },
        c.techniques,
        opts
      );
      expect(JSON.stringify(out)).toBe(
        JSON.stringify(
          c.expected.kind === "messages"
            ? { messages: c.expected.messages, params: c.expected.params }
            : null
        )
      );
    }
  });
});
