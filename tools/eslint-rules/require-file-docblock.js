/**
 * ESLint rule `docs/require-file-docblock`: every JS/TS source file must open with a module
 * docblock (a `/** ... *\/` comment before any code, after an optional shebang) that states the
 * file's purpose and contains `Exports:` and `Feature:` lines (plan section 2, rule 1).
 *
 * Exports: default (ESLint rule module)
 * Feature: tooling (lint / engineering rules)
 */
const REQUIRED_FIELDS = ["Exports:", "Feature:"];

export default {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require a module docblock (purpose, Exports:, Feature:) at the top of every source file",
      recommended: true,
    },
    schema: [],
    messages: {
      missing:
        "File must start with a module docblock (/** purpose ... Exports: ... Feature: ... */) before any code.",
      missingField: "Module docblock is missing a '{{ field }}' line.",
      noPurpose: "Module docblock must start with a one-line purpose description.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program(node) {
        const first = sourceCode.getAllComments().find((c) => c.type !== "Shebang");
        const firstToken = sourceCode.getFirstToken(node, { includeComments: false });
        const isDocblock =
          first &&
          first.type === "Block" &&
          first.value.startsWith("*") &&
          (!firstToken || first.range[0] < firstToken.range[0]) &&
          sourceCode.text.slice(0, first.range[0]).replace(/^#!.*\n?/, "").trim() === "";

        if (!isDocblock) {
          context.report({ loc: { line: 1, column: 0 }, messageId: "missing" });
          return;
        }

        const lines = first.value
          .split("\n")
          .map((l) => l.replace(/^\s*\*?\s?/, "").trim())
          .filter(Boolean);
        if (lines.length === 0 || REQUIRED_FIELDS.some((f) => lines[0].startsWith(f))) {
          context.report({ loc: first.loc, messageId: "noPurpose" });
        }
        for (const field of REQUIRED_FIELDS) {
          if (!lines.some((l) => l.startsWith(field))) {
            context.report({ loc: first.loc, messageId: "missingField", data: { field } });
          }
        }
      },
    };
  },
};
