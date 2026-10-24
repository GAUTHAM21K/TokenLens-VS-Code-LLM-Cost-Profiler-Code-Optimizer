/**
 * Tests: Webview Message Protocol Schemas (T011, T012, Principle II).
 *
 * Exports: none (test suite)
 * Feature: shared protocol / webview shell
 */
import { describe, it, expect } from "vitest";
import {
  HostToWebviewMsgSchema,
  WebviewToHostMsgSchema,
} from "../../src/protocol/schemas.js";

describe("Webview Message Protocol Schemas (T011, T012, Principle II)", () => {
  it("validates valid HostToWebview messages", () => {
    const keySaved = {
      version: 1,
      type: "auth/keySaved",
      payload: {
        providerId: "anthropic",
        keySlot: 0,
        maskedKey: "...a1b2",
      },
    };
    const parsedKeySaved = HostToWebviewMsgSchema.parse(keySaved);
    expect(parsedKeySaved.type).toBe("auth/keySaved");

    const enhanceResult = {
      version: 1,
      type: "enhance/result",
      payload: {
        narrative: "Detailed project breakdown",
        profile: {
          schemaVersion: "1.0",
          projectType: "rag-chatbot",
          overview: "RAG system for answering technical documentation questions",
          techStack: [{ language: "Python" }],
          llm: {
            providers: ["openai"],
            usesRag: true,
            usesAgents: false,
            avgPromptTokens: 800,
            avgOutputTokens: 250,
          },
          components: [],
          dataFlow: "User query -> vector search -> LLM synthesis -> response",
          scale: { requestsPerDay: 2000, peakMultiplier: 2 },
          buildAssumptions: { teamSize: 3, sprintWeeks: 2, iterationsPerFeature: 1 },
          phases: [],
          constraints: [],
          profileVersion: 1,
          createdAt: "2026-10-08T10:00:00Z",
        },
        profileVersion: 1,
        inputTokens: 1200,
        outputTokens: 450,
        costUsd: 0.0035,
      },
    };
    const parsedEnhance = HostToWebviewMsgSchema.parse(enhanceResult);
    expect(parsedEnhance.type).toBe("enhance/result");
  });

  it("validates valid WebviewToHost messages", () => {
    const saveKey = {
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: "openai",
        keySlot: 0,
        key: "mock-token-test-12345",
      },
    };
    const parsedSaveKey = WebviewToHostMsgSchema.parse(saveKey);
    expect(parsedSaveKey.type).toBe("auth/saveKey");

    const enhanceRun = {
      version: 1,
      type: "enhance/run",
      payload: {
        description: "Build an AI agent that optimizes tokens",
        providerId: "anthropic",
        modelId: "claude-3-5-sonnet",
      },
    };
    const parsedEnhanceRun = WebviewToHostMsgSchema.parse(enhanceRun);
    expect(parsedEnhanceRun.type).toBe("enhance/run");
  });

  it("throws on unknown or malformed message types", () => {
    const unknownHostMsg = {
      version: 1,
      type: "unknown/invalidMsg",
      payload: {},
    };
    expect(() => HostToWebviewMsgSchema.parse(unknownHostMsg)).toThrow();

    const unknownWebviewMsg = {
      version: 1,
      type: "malicious/executeCommand",
      payload: { cmd: "rm -rf /" },
    };
    expect(() => WebviewToHostMsgSchema.parse(unknownWebviewMsg)).toThrow();
  });

  it("throws on missing required fields", () => {
    const invalidSaveKey = {
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: "openai",
        // missing key and keySlot
      },
    };
    expect(() => WebviewToHostMsgSchema.parse(invalidSaveKey)).toThrow();
  });
});
