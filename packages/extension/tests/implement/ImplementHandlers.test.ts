/**
 * Unit tests for the Implement host pieces that need no real workspace: runtime file discovery
 * (bundled copy vs. monorepo source) and the handler error paths (no folder, unknown block).
 * The full export -> scan -> apply/skip/stale flow runs in `harness:check implement-flow`.
 *
 * Exports: none (test suite)
 * Feature: implement optimization
 */
import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: undefined,
    registerTextDocumentContentProvider: () => ({ dispose() {} }),
    getConfiguration: () => ({ get: () => undefined }),
  },
}));

import { DEFAULT_EXPORT_DIR, HostToWebviewMsgSchema } from "@token-optimizer/core";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { FeatureHandlerDeps } from "../../src/webview/handlers/FeatureHandlerDeps.js";
import { ImplementHandlers } from "../../src/implement/ImplementHandlers.js";
import { readRuntimeFiles, runtimeSourceDir } from "../../src/implement/pythonRuntime.js";

const EXT_DIR = path.resolve(__dirname, "../..");

describe("python runtime discovery", () => {
  it("falls back to packages/python-runtime/ai_optimizer in the monorepo", () => {
    const dir = runtimeSourceDir(EXT_DIR)!;
    expect(dir).toBeTruthy();
    const names = readRuntimeFiles(dir).map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["__init__.py", "router.py", "techniques.py", "middleware.py"]));
    expect(names.every((n) => /\.(py|json|typed)$/.test(n))).toBe(true);
  });

  it("prefers the bundled resources/python copy when present", () => {
    const ext = fs.mkdtempSync(path.join(os.tmpdir(), "to-ext-"));
    const bundled = path.join(ext, "resources", "python", "ai_optimizer");
    fs.mkdirSync(path.join(bundled, "__pycache__"), { recursive: true });
    fs.writeFileSync(path.join(bundled, "__init__.py"), '"""x."""\n');
    fs.writeFileSync(path.join(bundled, "notes.md"), "skip me");
    expect(runtimeSourceDir(ext)).toBe(bundled);
    expect(readRuntimeFiles(bundled).map((f) => f.name)).toEqual(["__init__.py"]);
    expect(runtimeSourceDir(path.join(ext, "nowhere"))).toBeNull();
    fs.rmSync(ext, { recursive: true, force: true });
  });
});

describe("ImplementHandlers error paths", () => {
  function setup() {
    const posted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const router = new MessageRouter({
      postMessage: async (m: unknown) => {
        posted.push(HostToWebviewMsgSchema.parse(m) as never);
        return true;
      },
    });
    const deps = {
      router,
      context: { subscriptions: [], extensionPath: EXT_DIR },
      getCatalogSnapshot: () => null,
    } as unknown as FeatureHandlerDeps;
    new ImplementHandlers(deps).register();
    const send = (type: string, payload: Record<string, unknown>) => router.handleInbound({ version: 1, type, payload });
    return { posted, send };
  }

  it("asks for a folder when none is open, and fails unknown blocks", async () => {
    const { posted, send } = setup();
    await send("implement/export", { operationId: "e1", techniqueIds: [] });
    await send("implement/scan", { operationId: "s1", features: ["router"], techniqueIds: [] });
    await send("implement/applyBlock", { proposalId: "nope" });
    await send("implement/skipBlock", { proposalId: "nope" });
    await send("implement/openDiff", { proposalId: "nope" });
    expect(posted.map((m) => [m.type, m.payload.error ?? m.payload.status, m.payload.operationId])).toEqual([
      ["implement/error", "invalid-request", "e1"],
      ["implement/error", "invalid-request", "s1"],
      ["implement/blockResult", "failed", undefined],
      ["implement/blockResult", "failed", undefined],
      ["implement/blockResult", "failed", undefined],
    ]);
  });
});

describe("tokenOptimizer.implement.exportDir setting", () => {
  it("is contributed in package.json with the code default", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"));
    const prop = pkg.contributes.configuration.properties["tokenOptimizer.implement.exportDir"];
    expect(prop.type).toBe("string");
    expect(prop.default).toBe(DEFAULT_EXPORT_DIR);
  });
});
