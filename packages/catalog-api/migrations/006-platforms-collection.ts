/**
 * Migration 006: creates the platforms collection (IDE/agent platform detection + artifact
 * targets).
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 006: Platforms Collection & Seed Data
 * - Creates platforms collection
 * - Creates unique index on id
 * - Seeds stubs for vscode (default), cursor, windsurf, antigravity
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("platforms");

  const platforms = [
    {
      id: "vscode",
      label: "Visual Studio Code",
      isDefault: true,
      detect: {
        appNames: ["Visual Studio Code", "Code - OSS", "VSCodium"],
        uriSchemes: ["vscode", "vscode-insiders"],
        markerFiles: [".vscode/settings.json"],
      },
      artifactTargets: [
        {
          kind: "instruction",
          layout: "file" as const,
          defaultEnabled: true,
          pathTemplate: ".vscode/token-optimizer.instructions.md",
          format: "markdown",
        },
        {
          kind: "skill",
          layout: "directory" as const,
          defaultEnabled: true,
          pathTemplate: ".vscode/skills/{{strategyId}}",
          format: "markdown",
        },
      ],
      docsUrl: "https://code.visualstudio.com/docs",
      verifiedAt: "2026-10-09T00:00:00Z",
      agentInvocation: {
        mechanisms: ["lm-edit" as const, "chat-handoff" as const, "clipboard" as const],
      },
    },
    {
      id: "cursor",
      label: "Cursor",
      isDefault: false,
      detect: {
        appNames: ["Cursor"],
        uriSchemes: ["cursor"],
        markerFiles: [".cursorrules", ".cursor"],
      },
      artifactTargets: [
        {
          kind: "rule",
          layout: "file" as const,
          defaultEnabled: true,
          pathTemplate: ".cursorrules",
          format: "markdown",
        },
        {
          kind: "skill",
          layout: "directory" as const,
          defaultEnabled: true,
          pathTemplate: ".cursor/skills/{{strategyId}}",
          format: "markdown",
        },
      ],
      docsUrl: "https://docs.cursor.com",
      verifiedAt: "2026-10-09T00:00:00Z",
      agentInvocation: {
        mechanisms: ["chat-handoff" as const, "clipboard" as const],
      },
    },
    {
      id: "windsurf",
      label: "Windsurf",
      isDefault: false,
      detect: {
        appNames: ["Windsurf"],
        uriSchemes: ["windsurf"],
        markerFiles: [".codeium/windsurf"],
      },
      artifactTargets: [
        {
          kind: "rule",
          layout: "file" as const,
          defaultEnabled: true,
          pathTemplate: ".windsurfrules",
          format: "markdown",
        },
        {
          kind: "skill",
          layout: "directory" as const,
          defaultEnabled: true,
          pathTemplate: ".windsurf/skills/{{strategyId}}",
          format: "markdown",
        },
      ],
      docsUrl: "https://codeium.com/windsurf",
      verifiedAt: "2026-10-09T00:00:00Z",
      agentInvocation: {
        mechanisms: ["clipboard" as const],
      },
    },
    {
      id: "antigravity",
      label: "Antigravity IDE",
      isDefault: false,
      detect: {
        appNames: ["Antigravity"],
        uriSchemes: ["antigravity"],
        markerFiles: [".agents"],
      },
      artifactTargets: [
        {
          kind: "rule",
          layout: "file" as const,
          defaultEnabled: true,
          pathTemplate: ".agents/rules/token-optimizer.md",
          format: "markdown",
        },
        {
          kind: "skill",
          layout: "directory" as const,
          defaultEnabled: true,
          pathTemplate: ".agents/skills/{{strategyId}}",
          format: "markdown",
        },
      ],
      docsUrl: "https://antigravity.google.com/docs",
      verifiedAt: "2026-10-09T00:00:00Z",
      agentInvocation: {
        mechanisms: ["lm-edit" as const, "chat-handoff" as const, "clipboard" as const],
      },
    },
  ];

  for (const platform of platforms) {
    await collection.updateOne(
      { id: platform.id },
      {
        $set: platform,
      },
      { upsert: true }
    );
  }

  await collection.createIndex({ id: 1 }, { unique: true, background: true });
}
