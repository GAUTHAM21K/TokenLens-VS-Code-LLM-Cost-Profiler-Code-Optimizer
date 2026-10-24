/**
 * Locates and reads the `ai_optimizer` Python runtime shipped with the extension: the bundled
 * copy `resources/python/ai_optimizer/` (added by the python-runtime build step) when present,
 * else the monorepo source `packages/python-runtime/ai_optimizer/` (dev / harness runs).
 *
 * Exports: RUNTIME_FILE_PATTERN, runtimeSourceDir, readRuntimeFiles
 * Feature: implement optimization (exporter)
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Files copied from the runtime package (no caches, tests or build output). */
export const RUNTIME_FILE_PATTERN = /\.(py|json|typed)$/;

/** First existing runtime directory, or null. */
export function runtimeSourceDir(extensionPath: string): string | null {
  const candidates = [
    path.join(extensionPath, "resources", "python", "ai_optimizer"),
    path.join(extensionPath, "..", "python-runtime", "ai_optimizer"),
  ];
  return candidates.find((d) => fs.existsSync(path.join(d, "__init__.py"))) ?? null;
}

/** Top-level runtime files (name + UTF-8 text), sorted by name. */
export function readRuntimeFiles(dir: string): Array<{ name: string; content: string }> {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && RUNTIME_FILE_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, content: fs.readFileSync(path.join(dir, name), "utf8") }));
}
