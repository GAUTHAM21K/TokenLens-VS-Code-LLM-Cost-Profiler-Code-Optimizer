/**
 * Tests: Packaged Extension Runtime Smoke Test (Finding 1).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

describe("Packaged Extension Runtime Smoke Test (Finding 1)", () => {
  const extDir = path.resolve(__dirname, "../..");
  const distExtension = path.join(extDir, "dist", "extension.js");
  const webviewIndex = path.join(extDir, "dist", "webview", "index.html");
  const licenseFile = path.join(extDir, "LICENSE");

  it("bundled extension.js and webview/index.html exist and are populated", () => {
    expect(fs.existsSync(distExtension), "dist/extension.js must exist").toBe(true);
    expect(fs.statSync(distExtension).size).toBeGreaterThan(10000);

    expect(fs.existsSync(webviewIndex), "dist/webview/index.html must exist").toBe(true);
    const htmlContent = fs.readFileSync(webviewIndex, "utf-8");
    expect(htmlContent).toContain("<div id=\"root\">");

    expect(fs.existsSync(licenseFile), "LICENSE must exist in packages/extension").toBe(true);
  });

  it("loads dist/extension.js with vscode stubbed without MODULE_NOT_FOUND", () => {
    // Stub vscode in require cache
    const require = createRequire(import.meta.url);
    const mockVscode = {
      window: {
        registerWebviewViewProvider: () => ({ dispose: () => {} }),
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
        executeCommand: () => {},
      },
      Uri: {
        joinPath: (...parts: unknown[]) => parts.join("/"),
        file: (p: string) => ({ fsPath: p, toString: () => p }),
      },
      workspace: {
        getConfiguration: () => ({ get: () => undefined }),
      },
    };

    // Override require cache for 'vscode'
    const Module = require("node:module");
    const originalLoad = Module._load;
    Module._load = function (request: string, parent: unknown, isMain: boolean) {
      if (request === "vscode") {
        return mockVscode;
      }
      return originalLoad.apply(this, [request, parent, isMain]);
    };

    try {
      // Clear require cache for extension if previously loaded
      delete require.cache[require.resolve(distExtension)];
      const extensionModule = require(distExtension);

      expect(extensionModule).toBeDefined();
      expect(typeof extensionModule.activate).toBe("function");
      expect(typeof extensionModule.deactivate).toBe("function");

      // Test activating with mock context
      const mockContext = {
        extensionUri: { fsPath: extDir, toString: () => extDir },
        extensionPath: extDir,
        globalState: {
          get: () => undefined,
          update: async () => {},
        },
        subscriptions: [],
      };
      extensionModule.activate(mockContext);
      expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(1);
    } finally {
      Module._load = originalLoad;
    }
  });
});
