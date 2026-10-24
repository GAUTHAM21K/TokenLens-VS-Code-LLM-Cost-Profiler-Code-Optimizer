/**
 * Tests: eslint-config.test.js.
 *
 * Exports: none (test suite)
 * Feature: tooling
 */
import { test } from "node:test";
import assert from "node:assert";
import { ESLint } from "eslint";

test("ESLint config enforces Principle X and Principle II import restrictions (Finding 18)", async () => {
  const eslint = new ESLint();

  // 1. Core importing vscode
  const coreVscodeResult = await eslint.lintText(
    `import * as vscode from "vscode";\nexport const x = 1;`,
    { filePath: "packages/core/src/sample.ts" }
  );
  assert.ok(
    coreVscodeResult[0].messages.some(
      (m) =>
        m.ruleId === "no-restricted-imports" &&
        m.message.includes("Principle X")
    ),
    "Should reject 'vscode' import in packages/core"
  );

  // 2. Core importing node:fs
  const coreFsResult = await eslint.lintText(
    `import * as fs from "node:fs";\nexport const x = 1;`,
    { filePath: "packages/core/src/sample.ts" }
  );
  assert.ok(
    coreFsResult[0].messages.some(
      (m) =>
        m.ruleId === "no-restricted-imports" &&
        m.message.includes("bundled in the webview")
    ),
    "Should reject 'node:fs' import in packages/core"
  );

  // 3. Webview importing vscode
  const webviewVscodeResult = await eslint.lintText(
    `import * as vscode from "vscode";\nexport const y = 1;`,
    { filePath: "packages/webview/src/sample.ts" }
  );
  assert.ok(
    webviewVscodeResult[0].messages.some(
      (m) =>
        m.ruleId === "no-restricted-imports" &&
        m.message.includes("Principle II")
    ),
    "Should reject 'vscode' import in packages/webview"
  );

  // 4. Webview importing node:fs
  const webviewFsResult = await eslint.lintText(
    `import * as fs from "node:fs";\nexport const y = 1;`,
    { filePath: "packages/webview/src/sample.ts" }
  );
  assert.ok(
    webviewFsResult[0].messages.some(
      (m) =>
        m.ruleId === "no-restricted-imports" &&
        m.message.includes("browser sandbox")
    ),
    "Should reject 'node:fs' import in packages/webview"
  );
});
