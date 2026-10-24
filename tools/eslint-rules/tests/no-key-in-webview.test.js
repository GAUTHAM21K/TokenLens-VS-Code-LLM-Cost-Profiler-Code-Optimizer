/**
 * Tests: no-key-in-webview.test.js.
 *
 * Exports: none (test suite)
 * Feature: tooling
 */
import { test } from "node:test";
import { RuleTester } from "eslint";
import noKeyInWebview from "../no-key-in-webview.js";

test("no-key-in-webview ESLint rule (Finding 8)", () => {
  const ruleTester = new RuleTester({
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  });

  ruleTester.run("no-key-in-webview", noKeyInWebview, {
    valid: [
      {
        code: `postMessage({ type: "auth/keySaved", maskedKey: "...a1b2", keySlot: 0 });`,
      },
      {
        code: `webview.postMessage({ status: "ok", tokenCount: 42 });`,
      },
      {
        code: `logger.info("Key saved successfully for slot " + keySlot);`,
      },
      {
        code: `console.log("Configured providers", providerList);`,
      },
      {
        // vscodeBridge.postMessage allowed ONLY for auth/saveKey (Finding 8)
        code: `vscodeBridge.postMessage({ type: "auth/saveKey", payload: { providerId: "p", key: "sk-123" } });`,
      },
      {
        code: `router.send({ type: "auth/keySaved", payload: { maskedKey: "...abc" } });`,
      },
    ],
    invalid: [
      {
        code: `postMessage({ key });`,
        errors: [
          {
            message:
              "Potential secret 'key' passed to postMessage. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `router.send({ apiKey: rawKey });`,
        errors: [
          {
            message:
              "Potential secret 'apiKey' passed to send. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `send({ value: rawKey });`,
        errors: [
          {
            message:
              "Potential secret 'rawKey' passed to send. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `logger.info(\`Key is \${apiKey}\`);`,
        errors: [
          {
            message:
              "Potential secret 'apiKey' passed to logger. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `logger.info("Key: " + rawKey);`,
        errors: [
          {
            message:
              "Potential secret 'rawKey' passed to logger. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `console.log(msg.payload.key);`,
        errors: [
          {
            message:
              "Potential secret 'key' passed to logger. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `vscode.window.showInformationMessage(key);`,
        errors: [
          {
            message:
              "Potential secret 'key' passed to vscode.window.showInformationMessage. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        code: `outputChannel.appendLine(secret);`,
        errors: [
          {
            message:
              "Potential secret 'secret' passed to OutputChannel.appendLine. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
      {
        // vscodeBridge.postMessage with non-saveKey sending secrets is disallowed
        code: `vscodeBridge.postMessage({ type: "catalog/query", key });`,
        errors: [
          {
            message:
              "Potential secret 'key' passed to vscodeBridge.postMessage. API keys and secrets must never be passed to the webview or logger.",
          },
        ],
      },
    ],
  });
});
