/**
 * Scans workspace files for project signals (languages, frameworks, LLM SDKs).
 *
 * Exports: ScannedProjectInfo, WorkspaceScanner
 * Feature: token cost estimator
 */
import * as vscode from "vscode";

export interface ScannedProjectInfo {
  name?: string;
  languages: string[];
  frameworks: string[];
  summary?: string;
}

export class WorkspaceScanner {
  /**
   * Scans the active workspace folder for package manifests and documentation.
   * Returns a markdown / text pre-fill draft string for the Enhance input prompt.
   * If no workspace is open, returns an empty string without error (FR-009).
   */
  public static async scanWorkspace(
    targetFolder?: vscode.WorkspaceFolder
  ): Promise<string> {
    const folder =
      targetFolder ||
      (typeof vscode !== "undefined" && vscode.workspace?.workspaceFolders?.[0]);

    if (!folder) {
      return "";
    }

    const info: ScannedProjectInfo = {
      languages: [],
      frameworks: [],
    };

    // 1. Scan package.json
    try {
      const packageJsonUri = vscode.Uri.joinPath(folder.uri, "package.json");
      const bytes = await vscode.workspace.fs.readFile(packageJsonUri);
      const content = new TextDecoder().decode(bytes);
      const pkg = JSON.parse(content);

      if (pkg.name) info.name = pkg.name;
      if (pkg.description && !info.summary) info.summary = pkg.description;

      info.languages.push("JavaScript/TypeScript");

      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      const detected = [
        "react",
        "next",
        "vue",
        "nuxt",
        "svelte",
        "angular",
        "express",
        "fastify",
        "nest",
        "langchain",
        "@langchain/core",
        "openai",
        "@anthropic-ai/sdk",
        "@google/genai",
        "chromadb",
        "pinecone",
      ];

      for (const dep of detected) {
        if (allDeps[dep]) {
          info.frameworks.push(dep);
        }
      }
    } catch {
      // Manifest not present; continue
    }

    // 2. Scan requirements.txt
    try {
      const reqUri = vscode.Uri.joinPath(folder.uri, "requirements.txt");
      const bytes = await vscode.workspace.fs.readFile(reqUri);
      const content = new TextDecoder().decode(bytes);

      if (!info.languages.includes("Python")) {
        info.languages.push("Python");
      }

      const pythonDeps = [
        "fastapi",
        "flask",
        "django",
        "langchain",
        "llama-index",
        "openai",
        "anthropic",
        "google-generativeai",
        "chromadb",
        "pinecone-client",
      ];

      for (const dep of pythonDeps) {
        if (new RegExp(`^${dep}\\b`, "mi").test(content)) {
          info.frameworks.push(dep);
        }
      }
    } catch {
      // Manifest not present
    }

    // 3. Scan pyproject.toml
    try {
      const tomlUri = vscode.Uri.joinPath(folder.uri, "pyproject.toml");
      const bytes = await vscode.workspace.fs.readFile(tomlUri);
      const content = new TextDecoder().decode(bytes);

      if (!info.languages.includes("Python")) {
        info.languages.push("Python");
      }

      const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/i);
      if (nameMatch && !info.name) {
        info.name = nameMatch[1];
      }
    } catch {
      // Manifest not present
    }

    // 4. Scan go.mod
    try {
      const goUri = vscode.Uri.joinPath(folder.uri, "go.mod");
      const bytes = await vscode.workspace.fs.readFile(goUri);
      const content = new TextDecoder().decode(bytes);

      if (!info.languages.includes("Go")) {
        info.languages.push("Go");
      }

      const modMatch = content.match(/^module\s+([^\s]+)/m);
      if (modMatch && !info.name) {
        info.name = modMatch[1].split("/").pop();
      }
    } catch {
      // Manifest not present
    }

    // 5. Scan README.md for overview
    if (!info.summary) {
      try {
        const readmeUri = vscode.Uri.joinPath(folder.uri, "README.md");
        const bytes = await vscode.workspace.fs.readFile(readmeUri);
        const content = new TextDecoder().decode(bytes);

        // Extract first non-header paragraph
        const lines = content.split("\n").map((l) => l.trim());
        const paragraphs = lines.filter((l) => l.length > 20 && !l.startsWith("#"));
        if (paragraphs.length > 0) {
          info.summary = paragraphs[0].slice(0, 300);
        }
      } catch {
        // README not present
      }
    }

    // If nothing was discovered, return empty
    if (!info.name && info.languages.length === 0 && !info.summary) {
      return "";
    }

    // Assemble draft
    const parts: string[] = [];
    if (info.name) {
      parts.push(`Project: ${info.name}`);
    }
    if (info.languages.length > 0) {
      parts.push(`Tech Stack: ${info.languages.join(", ")}`);
    }
    if (info.frameworks.length > 0) {
      parts.push(`Frameworks / Libraries: ${info.frameworks.join(", ")}`);
    }
    if (info.summary) {
      parts.push(`Overview: ${info.summary}`);
    }

    return parts.join("\n\n");
  }
}
