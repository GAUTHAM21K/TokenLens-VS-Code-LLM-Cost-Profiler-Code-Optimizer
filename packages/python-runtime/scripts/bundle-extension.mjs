/**
 * Copies the `ai_optimizer` Python package (.py + .json, no caches) into
 * packages/extension/resources/python/ai_optimizer/, replacing what was there, so the extension
 * can export it into user workspaces. Run with `pnpm python:bundle`.
 *
 * Exports: none (CLI script).
 * Feature: Implement flow / model router (Python runtime packaging).
 */
/* global console */
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "ai_optimizer");
const dest = resolve(here, "..", "..", "extension", "resources", "python", "ai_optimizer");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".py") || f.endsWith(".json"));
for (const f of files) cpSync(join(src, f), join(dest, f));
console.log(`ai_optimizer: copied ${files.length} files to ${dest}`);
