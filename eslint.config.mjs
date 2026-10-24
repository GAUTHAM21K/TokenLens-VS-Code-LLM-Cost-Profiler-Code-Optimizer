/**
 * Root ESLint flat config: TS/JS recommended rules, security and docblock custom rules, and the
 * per-package import boundaries (core = platform-free, webview = browser sandbox).
 *
 * Exports: default (ESLint flat config array)
 * Feature: tooling (lint / engineering rules)
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import noKeyInWebview from "./tools/eslint-rules/no-key-in-webview.js";
import requireFileDocblock from "./tools/eslint-rules/require-file-docblock.js";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/out/**",
      "**/.pnpm-store/**",
      "**/*.d.ts",
      "**/coverage/**",
      "specs/**",
      ".agents/**",
      ".specify/**",
      "docs/**",
      ".venv/**",
      ".data/**",
      "**/*.tmp.mts",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: {
      security: {
        rules: {
          "no-key-in-webview": noKeyInWebview,
        },
      },
      docs: {
        rules: {
          "require-file-docblock": requireFileDocblock,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "security/no-key-in-webview": "error",
      // Plan section 2, rule 1: module docblock (purpose, Exports:, Feature:) in every file
      "docs/require-file-docblock": "error",
    },
  },
  // CommonJS scripts configuration
  {
    files: ["**/*.cjs", "**/scripts/**/*.{js,cjs}"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Core: pure platform-agnostic library (Principle X & Finding 18)
  {
    files: ["packages/core/**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: {}, // No window, document, or process allowed
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "Principle X: packages/core must contain zero imports from vscode or IDE namespaces.",
            },
            {
              name: "fs",
              message: "packages/core is bundled in the webview and cannot import Node 'fs'.",
            },
            {
              name: "node:fs",
              message: "packages/core is bundled in the webview and cannot import 'node:fs'.",
            },
            {
              name: "path",
              message: "packages/core cannot import Node 'path'.",
            },
            {
              name: "node:path",
              message: "packages/core cannot import 'node:path'.",
            },
            {
              name: "crypto",
              message: "packages/core cannot import Node 'crypto'.",
            },
            {
              name: "node:crypto",
              message: "packages/core cannot import 'node:crypto'.",
            },
            {
              name: "os",
              message: "packages/core cannot import Node 'os'.",
            },
            {
              name: "node:os",
              message: "packages/core cannot import 'node:os'.",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Principle X: packages/core cannot import Node builtins.",
            },
          ],
        },
      ],
    },
  },
  // Webview source files: browser sandbox only (Principle II & Finding 18)
  {
    files: ["packages/webview/src/**/*.{ts,tsx}"],
    ignores: ["packages/webview/src/**/*.test.tsx"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vscode",
              message:
                "Principle II: packages/webview is presentation-only and cannot import vscode directly.",
            },
            {
              name: "fs",
              message: "Webview runs in browser sandbox and cannot import Node 'fs'.",
            },
            {
              name: "node:fs",
              message: "Webview runs in browser sandbox and cannot import 'node:fs'.",
            },
            {
              name: "path",
              message: "Webview runs in browser sandbox and cannot import Node 'path'.",
            },
            {
              name: "node:path",
              message: "Webview runs in browser sandbox and cannot import 'node:path'.",
            },
            {
              name: "crypto",
              message: "Webview runs in browser sandbox and cannot import Node 'crypto'.",
            },
            {
              name: "node:crypto",
              message: "Webview runs in browser sandbox and cannot import 'node:crypto'.",
            },
          ],
          patterns: [
            {
              group: ["node:*"],
              message: "Webview runs in browser sandbox and cannot import Node builtins.",
            },
          ],
        },
      ],
    },
  },
  // Webview tests: run in Node jsdom environment
  {
    files: ["packages/webview/src/**/*.test.tsx"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly",
        process: "readonly",
        __dirname: "readonly",
      },
    },
  },
  // Extension & Tools: Node environment
  {
    files: ["packages/extension/**/*.{js,mjs,ts}", "tools/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        TextDecoder: "readonly",
      },
    },
  }
);
