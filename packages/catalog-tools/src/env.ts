/**
 * Loads a local .env file into process.env for the catalog CLI tools.
 *
 * Exports: loadEnv
 * Feature: catalog
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

function parseAndApplyEnv(filePath: string): void {
  if (typeof (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile === "function") {
    try {
      (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(filePath);
      return;
    } catch {
      // Fall through to manual parser
    }
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch {
    // Ignore file read error
  }
}

export function loadEnv(): void {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(currentDir, "../../../.env"),
    path.resolve(currentDir, "../../.env"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      parseAndApplyEnv(p);
      break;
    }
  }
}

