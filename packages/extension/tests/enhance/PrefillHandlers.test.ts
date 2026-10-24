/**
 * Tests: PrefillHandlers. enhance/prefill returns the WorkspaceScanner draft with signals (or a
 * prefillError without a workspace), and webview/ready hydrates the latest profile through
 * enhance/versionLoaded.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator (Enhance)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const vscodeMock = vi.hoisted(() => ({ workspace: { workspaceFolders: undefined as unknown } }));
vi.mock("vscode", () => vscodeMock);
vi.mock("../../src/workspace/WorkspaceScanner.js", () => ({
  WorkspaceScanner: {
    scanWorkspace: vi.fn(async () => "Project: demo\n\nTech Stack: Python\n\nFrameworks / Libraries: langchain"),
  },
}));

import {
  HostToWebviewMsgSchema,
  ProjectProfileSchema,
  type HostToWebviewMsg,
} from "@token-optimizer/core";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { FeatureHandlerDeps } from "../../src/webview/handlers/FeatureHandlerDeps.js";
import type { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { PrefillHandlers, signalsFromDraft } from "../../src/enhance/PrefillHandlers.js";
import profileFixture from "../../../fixtures/profiles/ts-rag-chatbot.json";

const profile = ProjectProfileSchema.parse(profileFixture);

describe("PrefillHandlers", () => {
  let posted: HostToWebviewMsg[];
  let router: MessageRouter;
  let latest: unknown;

  beforeEach(() => {
    posted = [];
    latest = undefined;
    vscodeMock.workspace.workspaceFolders = [{ uri: { path: "/w" }, name: "w", index: 0 }];
    router = new MessageRouter({
      postMessage: async (m: unknown) => {
        posted.push(HostToWebviewMsgSchema.parse(m));
        return true;
      },
    });
    const historyStore = { getLatest: () => latest } as unknown as ProfileHistoryStore;
    new PrefillHandlers({ router, historyStore } as unknown as FeatureHandlerDeps).register();
  });

  it("answers prefillResult with the scanner draft and its signals", async () => {
    await router.handleInbound({ version: 1, type: "enhance/prefill", payload: { operationId: "op1" } });
    expect(posted[0]).toEqual({
      version: 1,
      type: "enhance/prefillResult",
      payload: {
        operationId: "op1",
        description: "Project: demo\n\nTech Stack: Python\n\nFrameworks / Libraries: langchain",
        signals: ["Project: demo", "Tech Stack: Python", "Frameworks / Libraries: langchain"],
      },
    });
  });

  it("answers prefillError when no workspace is open", async () => {
    vscodeMock.workspace.workspaceFolders = undefined;
    await router.handleInbound({ version: 1, type: "enhance/prefill", payload: {} });
    expect(posted[0].type).toBe("enhance/prefillError");
  });

  it("hydrates the latest profile on webview/ready, and stays quiet with no history", async () => {
    await router.handleInbound({ version: 1, type: "webview/ready", payload: {} });
    expect(posted).toHaveLength(0);
    latest = { version: 2, narrative: "n", profile, createdAt: profile.createdAt, finalizedAt: profile.finalizedAt };
    await router.handleInbound({ version: 1, type: "webview/ready", payload: {} });
    expect(posted[0].type).toBe("enhance/versionLoaded");
  });

  it("signalsFromDraft truncates long paragraphs", () => {
    expect(signalsFromDraft(`Overview: ${"x".repeat(400)}`)[0]).toHaveLength(300);
  });
});
