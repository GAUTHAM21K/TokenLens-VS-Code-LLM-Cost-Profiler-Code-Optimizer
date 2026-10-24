/**
 * Detects the host IDE/agent platform from app name, URI scheme and marker files.
 *
 * Exports: PlatformDetectionEnv, PlatformDetector
 * Feature: settings / API keys
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { CatalogSnapshot, Platform } from "@token-optimizer/core";

export interface PlatformDetectionEnv {
  appName?: string;
  uriScheme?: string;
  workspaceRoot?: string;
  fileExists?: (filePath: string) => boolean;
}

export class PlatformDetector {
  /**
   * Detects the host platform from catalog platform definitions in priority order:
   * 1. appName substring match against platform.detect.appNames
   * 2. uriScheme exact match against platform.detect.uriSchemes
   * 3. marker file existence from platform.detect.markerFiles in workspace
   * 4. Fallback to the platform where platform.isDefault === true (Principle VII & Decision 8)
   */
  public static detect(
    catalog: CatalogSnapshot,
    env: PlatformDetectionEnv = {}
  ): Platform {
    const platforms = catalog.platforms || [];
    if (platforms.length === 0) {
      throw new Error("Catalog contains no platform definitions.");
    }

    const appName = env.appName;
    const uriScheme = env.uriScheme;
    const workspaceRoot = env.workspaceRoot;
    const fileExists =
      env.fileExists ||
      ((p: string) => {
        try {
          return fs.existsSync(p);
        } catch {
          return false;
        }
      });

    // 1. appName substring match
    if (appName) {
      for (const p of platforms) {
        if (p.detect?.appNames && Array.isArray(p.detect.appNames)) {
          for (const candidate of p.detect.appNames) {
            if (candidate && appName.toLowerCase().includes(candidate.toLowerCase())) {
              return p;
            }
          }
        }
      }
    }

    // 2. uriScheme match
    if (uriScheme) {
      for (const p of platforms) {
        if (p.detect?.uriSchemes && Array.isArray(p.detect.uriSchemes)) {
          for (const candidate of p.detect.uriSchemes) {
            if (candidate && uriScheme.toLowerCase() === candidate.toLowerCase()) {
              return p;
            }
          }
        }
      }
    }

    // 3. Marker file match
    if (workspaceRoot) {
      for (const p of platforms) {
        if (p.detect?.markerFiles && Array.isArray(p.detect.markerFiles)) {
          for (const marker of p.detect.markerFiles) {
            const targetPath = path.resolve(workspaceRoot, marker);
            if (fileExists(targetPath)) {
              return p;
            }
          }
        }
      }
    }

    // 4. Default platform fallback
    const defaultPlatform = platforms.find((p) => p.isDefault);
    if (defaultPlatform) {
      return defaultPlatform;
    }

    throw new Error(
      "Catalog validation failure: No matching platform detected and no platform is flagged isDefault=true."
    );
  }
}
