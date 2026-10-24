/**
 * `pnpm demo:workspace`: refreshes .demo-workspace/ (gitignored) from examples/demo-langchain-app
 * so a live demo (F5 "Run Extension (demo workspace)" or an installed VSIX) can export, scan and
 * apply edits without touching the tracked demo app. Skips __pycache__ and virtualenvs.
 * The folder itself is kept and only its contents are replaced, because Windows refuses to remove
 * a folder that VS Code or a terminal has open (EBUSY). Entries that are locked are skipped with a
 * message instead of failing the whole refresh.
 *
 * Exports: none (CLI script)
 * Feature: tooling (demo)
 */
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = resolve(root, "examples/demo-langchain-app");
const dest = resolve(root, ".demo-workspace");
const skip = [`${sep}__pycache__`, `${sep}.venv`, `${sep}venv`, `${sep}ai_optimizer`];
const LOCK_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"]);

const skipped = new Set();
const tolerant = (what, fn) => {
  try {
    fn();
  } catch (err) {
    if (!LOCK_CODES.has(err.code)) throw err;
    skipped.add(`${what} (${err.code})`);
  }
};

mkdirSync(dest, { recursive: true });
// Keep a demo venv the presenter already created; everything else is replaced.
for (const name of readdirSync(dest)) {
  if (name === ".venv") continue;
  tolerant(name, () => rmSync(join(dest, name), { recursive: true, force: true }));
}
for (const name of readdirSync(src)) {
  if (skip.some((s) => `${sep}${name}`.startsWith(s))) continue;
  tolerant(name, () =>
    cpSync(join(src, name), join(dest, name), {
      recursive: true,
      force: true,
      filter: (p) => !skip.some((s) => p.slice(src.length).includes(s)),
    })
  );
}

console.log(`demo workspace ready: ${dest}`);
if (skipped.size > 0) {
  console.warn(
    `skipped ${skipped.size} locked entr${skipped.size === 1 ? "y" : "ies"} ` +
      `(close the editor/terminal using them and run again if they matter): ${[...skipped].join(", ")}`
  );
}
