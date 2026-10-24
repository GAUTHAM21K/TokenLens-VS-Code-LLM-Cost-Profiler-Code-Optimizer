/**
 * Repository secret scanner (keys, tokens, Mongo URIs) used by `pnpm secret-scan` and CI.
 *
 * Exports: SECRET_PATTERNS, scanFile, scanDirectory, scanRepo
 * Feature: tooling
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SECRET_PATTERNS = [
  {
    name: "MongoDB URI (Principle III)",
    regex: /mongodb(\+srv)?:\/\/[^\s"']+/i,
  },
  {
    name: "Hardcoded password assignment",
    regex: /password\s*[:=]\s*["'][^"'\s]{4,}["']/i,
  },
  {
    name: "Hardcoded API key assignment",
    regex: /api_?key\s*[:=]\s*["'][^"'\s]{4,}["']/i,
  },
  {
    name: "Raw API secret token (sk-*)",
    regex: /sk-[a-zA-Z0-9_-]{20,}/,
  },
  {
    name: "Google API Key (AIza...)",
    regex: /AIza[0-9A-Za-z-_]{35}/,
  },
  {
    name: "Groq API Key (gsk_...)",
    regex: /gsk_[a-zA-Z0-9_-]{20,}/,
  },
  {
    name: "xAI API Key (xai-...)",
    regex: /xai-[a-zA-Z0-9_-]{20,}/,
  },
  {
    name: "Private Key block",
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/,
  },
  {
    name: "Hardcoded Bearer Token",
    regex: /bearer\s+["']?[a-zA-Z0-9_\-.]{25,}["']?/i,
  },
];

const IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  ".pnpm-store",
  "coverage",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".ruff_cache",
]);

// Git-ignored local environment files (contain real local dev credentials; never committed)
const IGNORE_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.test",
  ".env.production",
]);

export function scanFile(filePath, violations = []) {
  if (!fs.existsSync(filePath)) return violations;
  // Skip secret scanner script itself and tests to avoid self-matching
  if (
    filePath.endsWith("secret-scan.js") ||
    filePath.endsWith("secret-scan.test.js") ||
    filePath.includes("test-secrets-fixture")
  ) {
    return violations;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  for (const pattern of SECRET_PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      violations.push({
        file: filePath,
        pattern: pattern.name,
        match: match[0],
      });
    }
  }
  return violations;
}

export function scanDirectory(dir, violations = []) {
  if (!fs.existsSync(dir)) return violations;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || IGNORE_FILES.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, violations);
    } else if (entry.isFile()) {
      // scan source, config, and env templates (e.g., .env.example)
      if (
        /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py|toml|txt|json|yaml|yml|md|html)$/i.test(entry.name) ||
        entry.name.startsWith(".env")
      ) {
        scanFile(fullPath, violations);
      }
    }
  }

  return violations;
}

export function scanRepo(rootDir = process.cwd()) {
  const violations = [];
  const dirsToScan = ["packages", "tools", ".github", "docs", "examples"];

  for (const subDir of dirsToScan) {
    const fullDir = path.join(rootDir, subDir);
    if (fs.existsSync(fullDir)) {
      scanDirectory(fullDir, violations);
    }
  }

  // Also scan root config and template env files
  const rootEntries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (entry.isFile()) {
      if (IGNORE_FILES.has(entry.name)) continue;
      if (
        /\.(ts|js|json|yaml|yml|md)$/i.test(entry.name) ||
        entry.name.startsWith(".env")
      ) {
        scanFile(path.join(rootDir, entry.name), violations);
      }
    }
  }

  return violations;
}

// Robust CLI execution guard (Finding 9)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2];
  const violations = target ? scanDirectory(path.resolve(target)) : scanRepo();

  if (violations.length > 0) {
    console.error(`\n❌ Secret scan failed with ${violations.length} violations:`);
    for (const v of violations) {
      console.error(`  - [${v.pattern}] in ${v.file}: "${v.match}"`);
    }
    process.exit(1);
  } else {
    console.log(`\n✅ Secret scan passed: 0 secret violations found.`);
    process.exit(0);
  }
}
