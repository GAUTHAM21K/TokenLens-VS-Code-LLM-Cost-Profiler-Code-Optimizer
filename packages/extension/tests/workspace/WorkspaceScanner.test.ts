/**
 * Tests: WorkspaceScanner Unit Tests (T058, FR-009).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect, vi } from "vitest";
import type * as vscode from "vscode";

const mockFiles = new Map<string, string>();

vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: undefined as vscode.WorkspaceFolder[] | undefined,
    fs: {
      readFile: vi.fn(async (uri: { fsPath: string; path: string }) => {
        const filePath = uri.path || uri.fsPath;
        const matchingKey = Array.from(mockFiles.keys()).find((k) =>
          filePath.endsWith(k)
        );
        if (matchingKey) {
          const content = mockFiles.get(matchingKey)!;
          return new TextEncoder().encode(content);
        }
        throw new Error("File not found");
      }),
    },
  },
  Uri: {
    joinPath: (_base: unknown, ...parts: string[]) => ({
      path: parts.join("/"),
      fsPath: parts.join("/"),
    }),
  },
}));

import { WorkspaceScanner } from "../../src/workspace/WorkspaceScanner.js";

describe("WorkspaceScanner Unit Tests (T058, FR-009)", () => {
  it("returns empty draft when no workspace is open without throwing error", async () => {
    const draft = await WorkspaceScanner.scanWorkspace(undefined);
    expect(draft).toBe("");
  });

  it("detects Node.js project name and frameworks from package.json", async () => {
    mockFiles.clear();
    mockFiles.set(
      "package.json",
      JSON.stringify({
        name: "my-ai-rag-service",
        description: "Enterprise assistant using LangChain and Next.js",
        dependencies: {
          next: "^14.0.0",
          langchain: "^0.2.0",
          openai: "^4.0.0",
        },
      })
    );

    const mockFolder = {
      uri: { path: "/workspace", fsPath: "/workspace" },
      name: "workspace",
      index: 0,
    } as vscode.WorkspaceFolder;

    const draft = await WorkspaceScanner.scanWorkspace(mockFolder);

    expect(draft).toContain("Project: my-ai-rag-service");
    expect(draft).toContain("Tech Stack: JavaScript/TypeScript");
    expect(draft).toContain("next");
    expect(draft).toContain("langchain");
    expect(draft).toContain("Overview: Enterprise assistant using LangChain and Next.js");
  });

  it("detects Python dependencies from requirements.txt", async () => {
    mockFiles.clear();
    mockFiles.set(
      "requirements.txt",
      "fastapi==0.110.0\nuvicorn\nllama-index\nchromadb\n"
    );

    const mockFolder = {
      uri: { path: "/workspace", fsPath: "/workspace" },
      name: "workspace",
      index: 0,
    } as vscode.WorkspaceFolder;

    const draft = await WorkspaceScanner.scanWorkspace(mockFolder);

    expect(draft).toContain("Tech Stack: Python");
    expect(draft).toContain("fastapi");
    expect(draft).toContain("llama-index");
  });
});
