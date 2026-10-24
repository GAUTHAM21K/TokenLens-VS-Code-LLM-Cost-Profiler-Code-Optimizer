/**
 * Tests for the require-file-docblock ESLint rule (valid headers, shebang, and each failure mode).
 *
 * Exports: none (node:test suite)
 * Feature: tooling (lint / engineering rules)
 */
import { test } from "node:test";
import { RuleTester } from "eslint";
import rule from "../require-file-docblock.js";

const header = "/**\n * Does a thing.\n *\n * Exports: x\n * Feature: demo\n */\n";

test("require-file-docblock ESLint rule", () => {
  const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: "module" },
  });

  ruleTester.run("require-file-docblock", rule, {
    valid: [
      { code: `${header}export const x = 1;` },
      { code: `#!/usr/bin/env node\n${header}console.log(1);` },
      { code: `${header}` },
    ],
    invalid: [
      { code: "export const x = 1;", errors: [{ messageId: "missing" }] },
      { code: `import a from "a";\n${header}`, errors: [{ messageId: "missing" }] },
      { code: "// Exports: x\n// Feature: y\nconst a = 1;", errors: [{ messageId: "missing" }] },
      { code: "/* Purpose.\n Exports: x\n Feature: y */\nconst a = 1;", errors: [{ messageId: "missing" }] },
      {
        code: "/**\n * Purpose only.\n */\nconst a = 1;",
        errors: [
          { messageId: "missingField", data: { field: "Exports:" } },
          { messageId: "missingField", data: { field: "Feature:" } },
        ],
      },
      {
        code: "/**\n * Exports: x\n * Feature: y\n */\nconst a = 1;",
        errors: [{ messageId: "noPurpose" }],
      },
    ],
  });
});
