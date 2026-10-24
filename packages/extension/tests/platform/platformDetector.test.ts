/**
 * Tests: PlatformDetector Unit Tests (T041, FR-001, Principle VII & X).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect } from "vitest";
import { PlatformDetector } from "../../src/platform/PlatformDetector.js";
import type { CatalogSnapshot } from "@token-optimizer/core";

const mockSnapshot: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00Z",
  providers: [],
  models: [],
  pricing: [],
  phases: [],
  strategies: [],
  platforms: [
    {
      id: "cursor",
      label: "Cursor",
      detect: {
        appNames: ["Cursor"],
        uriSchemes: ["cursor"],
        markerFiles: [".cursor/settings.json"],
      },
      artifactTargets: [],
      isDefault: false,
    },
    {
      id: "vscode",
      label: "Visual Studio Code",
      detect: {
        appNames: ["Visual Studio Code", "Code"],
        uriSchemes: ["vscode"],
        markerFiles: [".vscode/settings.json"],
      },
      artifactTargets: [],
      isDefault: true,
    },
  ],
  promptTemplates: [],
};

describe("PlatformDetector Unit Tests (T041, FR-001, Principle VII & X)", () => {
  it("detects platform by appName substring match", () => {
    const platform = PlatformDetector.detect(mockSnapshot, {
      appName: "Visual Studio Code - Insiders",
    });
    expect(platform.id).toBe("vscode");
  });

  it("detects platform by uriScheme match", () => {
    const platform = PlatformDetector.detect(mockSnapshot, {
      appName: "Custom Editor",
      uriScheme: "cursor",
    });
    expect(platform.id).toBe("cursor");
  });

  it("detects platform by markerFile existence", () => {
    const platform = PlatformDetector.detect(mockSnapshot, {
      appName: "Unknown",
      workspaceRoot: "/mock/workspace",
      fileExists: (p) => p.includes(".cursor"),
    });
    expect(platform.id).toBe("cursor");
  });

  it("falls back to default platform if no match is found", () => {
    const platform = PlatformDetector.detect(mockSnapshot, {
      appName: "Vim / Emacs",
    });
    expect(platform.id).toBe("vscode");
    expect(platform.isDefault).toBe(true);
  });

  it("throws descriptive error when catalog has no platforms or no default", () => {
    const badSnapshot: CatalogSnapshot = {
      ...mockSnapshot,
      platforms: [
        {
          id: "custom",
          label: "Custom",
          detect: { appNames: ["Special"] },
          artifactTargets: [],
          isDefault: false,
        },
      ],
    };

    expect(() =>
      PlatformDetector.detect(badSnapshot, { appName: "Other" })
    ).toThrow(/Catalog validation failure: No matching platform detected and no platform is flagged isDefault=true/);
  });
});
