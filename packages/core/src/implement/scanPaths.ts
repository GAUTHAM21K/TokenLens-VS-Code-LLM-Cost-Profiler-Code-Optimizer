/**
 * Which workspace files the Implement scanner reads: `.py` files outside virtualenvs, VCS and
 * dependency folders, and outside the exported `ai_optimizer` package itself. Pure.
 *
 * Exports: DEFAULT_EXPORT_DIR, SCAN_EXCLUDED_DIRS, scanExcludeGlob, shouldScanPythonPath
 * Feature: implement optimization (scanner)
 */

/** Default workspace-relative directory of the exported Python package. */
export const DEFAULT_EXPORT_DIR = "ai_optimizer";

export const SCAN_EXCLUDED_DIRS = [
  "venv",
  ".venv",
  ".git",
  "node_modules",
  "site-packages",
  "__pycache__",
] as const;

const normalize = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");

/** Glob for `workspace.findFiles` excludes (the planner re-checks with shouldScanPythonPath). */
export function scanExcludeGlob(exportDir: string = DEFAULT_EXPORT_DIR): string {
  return `{${[...SCAN_EXCLUDED_DIRS.map((d) => `**/${d}/**`), `${normalize(exportDir)}/**`].join(",")}}`;
}

/** True for a workspace-relative `.py` path the scanner should plan edits for. */
export function shouldScanPythonPath(relPath: string, exportDir: string = DEFAULT_EXPORT_DIR): boolean {
  const p = normalize(relPath);
  if (!p.endsWith(".py")) return false;
  const parts = p.split("/");
  if (parts.slice(0, -1).some((d) => (SCAN_EXCLUDED_DIRS as readonly string[]).includes(d))) return false;
  const exp = normalize(exportDir);
  return !(p === exp || p.startsWith(exp + "/"));
}
