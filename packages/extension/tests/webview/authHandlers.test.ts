/**
 * Tests: AuthHandlers Unit Tests (T052, Principle I & II).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  env: { appName: "Visual Studio Code", uriScheme: "vscode" },
  workspace: { workspaceFolders: [] },
}));

import type * as vscode from "vscode";
import { AuthHandlers } from "../../src/webview/handlers/AuthHandlers.js";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import { KeyService } from "../../src/secrets/KeyService.js";
import { KeyValidationService } from "../../src/secrets/KeyValidationService.js";
import type { CatalogSnapshot, Provider, HostToWebviewMsg } from "@token-optimizer/core";

const mockSnapshot: CatalogSnapshot = {
  version: 1,
  schemaVersion: "1.0",
  publishedAt: "2026-10-09T00:00:00Z",
  providers: [
    {
      id: "anthropic",
      label: "Anthropic",
      adapterType: "anthropic",
      enabled: true,
    } as unknown as Provider,
  ],
  models: [],
  pricing: [],
  phases: [],
  strategies: [],
  platforms: [
    {
      id: "vscode",
      label: "Visual Studio Code",
      detect: { appNames: ["Code"] },
      artifactTargets: [],
      isDefault: true,
    },
  ],
  promptTemplates: [],
};

describe("AuthHandlers Unit Tests (T052, Principle I & II)", () => {
  it("auth/saveKey calls validation and clears raw key; posts auth/state with masked keys only", async () => {
    const postedMessages: HostToWebviewMsg[] = [];
    const router = new MessageRouter({
      postMessage: async (msg) => {
        postedMessages.push(msg as HostToWebviewMsg);
        return true;
      },
    });

    const mockStorage = new Map<string, string>();
    const keyService = new KeyService({
      get: async (k) => mockStorage.get(k),
      store: async (k, v) => { mockStorage.set(k, v); },
      delete: async (k) => { mockStorage.delete(k); },
    } as unknown as vscode.SecretStorage);

    const validationService = new KeyValidationService({
      keyService,
      adapters: new Map([
        [
          "anthropic",
          {
            providerId: "anthropic",
            validateKey: vi.fn().mockResolvedValue({ valid: true }),
            listModels: vi.fn(),
            complete: vi.fn(),
          },
        ],
      ]),
      postMessage: async (msg) => {
        postedMessages.push(msg as HostToWebviewMsg);
        return true;
      },
    });

    const globalState = new Map<string, unknown>();
    const workspaceState = new Map<string, unknown>();
    const mockContext = {
      globalState: {
        get: (k: string) => globalState.get(k),
        update: async (k: string, v: unknown) => { globalState.set(k, v); },
      },
      workspaceState: {
        get: (k: string) => workspaceState.get(k),
        update: async (k: string, v: unknown) => { workspaceState.set(k, v); },
      },
    } as unknown as vscode.ExtensionContext;

    const handlers = new AuthHandlers({
      context: mockContext,
      router,
      keyService,
      validationService,
      getCatalogSnapshot: () => mockSnapshot,
    });
    handlers.register();

    // Trigger auth/saveKey
    await router.handleInbound({
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: "anthropic",
        keySlot: 0,
        key: "sk-ant-verysecret9999",
      },
    });

    // Check posted messages
    const keySaved = postedMessages.find((m) => m.type === "auth/keySaved");
    expect(keySaved).toBeDefined();
    expect(keySaved.payload.maskedKey).toBe("...9999");

    const authState = postedMessages.find((m) => m.type === "auth/state");
    expect(authState).toBeDefined();
    expect(authState.payload.configuredKeys).toEqual([
      {
        providerId: "anthropic",
        keySlot: 0,
        maskedKey: "...9999",
        enabledModels: [],
      },
    ]);

    // Raw key MUST NOT appear anywhere in posted messages (Principle I)
    const jsonStr = JSON.stringify(postedMessages);
    expect(jsonStr).not.toContain("verysecret");
  });

  it("auth/removeKey deletes key and posts auth/keyRemoved and updated auth/state", async () => {
    const postedMessages: HostToWebviewMsg[] = [];
    const router = new MessageRouter({
      postMessage: async (msg) => {
        postedMessages.push(msg as HostToWebviewMsg);
        return true;
      },
    });

    const mockStorage = new Map<string, string>([
      ["provider:anthropic:0", "sk-ant-test1234"],
    ]);
    const keyService = new KeyService({
      get: async (k) => mockStorage.get(k),
      store: async (k, v) => { mockStorage.set(k, v); },
      delete: async (k) => { mockStorage.delete(k); },
    } as unknown as vscode.SecretStorage);

    const validationService = new KeyValidationService({
      keyService,
      adapters: new Map(),
    });

    const mockContext = {
      globalState: { get: () => undefined, update: async () => {} },
      workspaceState: { get: () => undefined, update: async () => {} },
    } as unknown as vscode.ExtensionContext;

    const handlers = new AuthHandlers({
      context: mockContext,
      router,
      keyService,
      validationService,
      getCatalogSnapshot: () => mockSnapshot,
    });
    handlers.register();

    await router.handleInbound({
      version: 1,
      type: "auth/removeKey",
      payload: {
        providerId: "anthropic",
        keySlot: 0,
      },
    });

    expect(mockStorage.has("provider:anthropic:0")).toBe(false);

    const keyRemoved = postedMessages.find((m) => m.type === "auth/keyRemoved");
    expect(keyRemoved).toBeDefined();
    expect(keyRemoved.payload).toEqual({ providerId: "anthropic", keySlot: 0 });

    const authState = postedMessages.find((m) => m.type === "auth/state");
    expect(authState).toBeDefined();
    expect(authState.payload.configuredKeys).toEqual([]);
  });
});
