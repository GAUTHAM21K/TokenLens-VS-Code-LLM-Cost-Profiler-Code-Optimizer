/**
 * Tests: CatalogService Extension Tests (T034, FR-043-FR-046).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs/promises";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
    }),
  },
  Uri: {
    file: (f: string) => ({ fsPath: f }),
  },
}));

import {
  CatalogService,
  validateCatalogApiUrl,
} from "../../src/catalog/CatalogService.js";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import {
  CatalogClient,
  BundledSnapshotLoader,
} from "@token-optimizer/core";

describe("CatalogService Extension Tests (T034, FR-043-FR-046)", () => {
  describe("validateCatalogApiUrl guardrails", () => {
    it("defaults to official catalog endpoint when undefined or null", () => {
      const res = validateCatalogApiUrl(undefined);
      expect(res.isValid).toBe(true);
      expect(res.isOfflineMode).toBe(false);
      expect(res.validatedUrl).toBe("http://127.0.0.1:3000/v1");
    });

    it("declares air-gapped offline-only mode when configured as empty string", () => {
      const res = validateCatalogApiUrl("   ");
      expect(res.isValid).toBe(true);
      expect(res.isOfflineMode).toBe(true);
      expect(res.validatedUrl).toBeUndefined();
    });

    it("accepts valid https endpoint", () => {
      const res = validateCatalogApiUrl("https://mirror.internal.enterprise.com/v1");
      expect(res.isValid).toBe(true);
      expect(res.isOfflineMode).toBe(false);
      expect(res.validatedUrl).toBe("https://mirror.internal.enterprise.com/v1");
    });

    it("accepts http localhost or 127.0.0.1 for local development", () => {
      const res1 = validateCatalogApiUrl("http://localhost:3000/v1");
      expect(res1.isValid).toBe(true);
      expect(res1.isOfflineMode).toBe(false);

      const res2 = validateCatalogApiUrl("http://127.0.0.1:8080/api");
      expect(res2.isValid).toBe(true);
      expect(res2.isOfflineMode).toBe(false);
    });

    it("rejects non-https remote endpoints and falls back to offline mode", () => {
      const res = validateCatalogApiUrl("http://insecure.internal.com/catalog");
      expect(res.isValid).toBe(false);
      expect(res.isOfflineMode).toBe(true);
      expect(res.reason).toContain("must use https://");
    });

    it("rejects URLs containing embedded credentials/userinfo", () => {
      const res = validateCatalogApiUrl("https://admin:secret@catalog.example.com/v1");
      expect(res.isValid).toBe(false);
      expect(res.isOfflineMode).toBe(true);
      expect(res.reason).toContain("must not contain credentials");
    });
  });

  it("falls back to bundled snapshot and posts catalog/updated with isOffline=true on network failure", async () => {
    const postedMessages: unknown[] = [];
    const mockPostTarget = {
      postMessage: async (msg: unknown) => {
        postedMessages.push(msg);
        return true;
      },
    };

    const router = new MessageRouter(mockPostTarget);

    const mockGlobalState = new Map<string, unknown>();
    const mockContext = {
      globalState: {
        get: (key: string) => mockGlobalState.get(key),
        update: async (key: string, val: unknown) => {
          mockGlobalState.set(key, val);
        },
      },
      extensionPath: path.resolve(__dirname, "../.."),
      subscriptions: [],
    } as unknown as import("vscode").ExtensionContext;

    // Mock client that fails with network error
    const mockClient = {
      getCatalogSnapshot: vi.fn().mockRejectedValue(new Error("Network connection refused")),
    } as unknown as CatalogClient;

    const bundledPath = path.resolve(
      __dirname,
      "../../resources/catalog-snapshot.json"
    );

    const loader = new BundledSnapshotLoader(async (p: string) => {
      return await fs.readFile(p, "utf-8");
    });

    const service = new CatalogService(mockContext, router, {
      client: mockClient,
      loader,
      bundledSnapshotPath: bundledPath,
    });

    const snapshot = await service.initialize();

    expect(snapshot).toBeDefined();
    expect(snapshot.version).toBeGreaterThanOrEqual(1);
    expect(service.isOffline()).toBe(true);

    // Assert message posted to webview
    expect(postedMessages.length).toBe(1);
    const sentMsg = postedMessages[0] as {
      type: string;
      version: number;
      payload: { isOffline: boolean; version: number; publishedAt?: string };
    };

    expect(sentMsg.type).toBe("catalog/updated");
    expect(sentMsg.version).toBe(1);
    expect(sentMsg.payload.isOffline).toBe(true);
    expect(sentMsg.payload.version).toBe(snapshot.version);
    expect(sentMsg.payload.publishedAt).toBeDefined();

    service.dispose();
  });

  it("runs in air-gapped offline-only mode when catalogApiUrl is empty string (zero network calls)", async () => {
    const postedMessages: unknown[] = [];
    const mockPostTarget = {
      postMessage: async (msg: unknown) => {
        postedMessages.push(msg);
        return true;
      },
    };

    const router = new MessageRouter(mockPostTarget);

    const mockGlobalState = new Map<string, unknown>();
    const mockContext = {
      globalState: {
        get: (key: string) => mockGlobalState.get(key),
        update: async (key: string, val: unknown) => {
          mockGlobalState.set(key, val);
        },
      },
      extensionPath: path.resolve(__dirname, "../.."),
      subscriptions: [],
    } as unknown as import("vscode").ExtensionContext;

    const mockClient = {
      getCatalogSnapshot: vi.fn(),
    } as unknown as CatalogClient;

    const bundledPath = path.resolve(
      __dirname,
      "../../resources/catalog-snapshot.json"
    );

    const loader = new BundledSnapshotLoader(async (p: string) => {
      return await fs.readFile(p, "utf-8");
    });

    const service = new CatalogService(mockContext, router, {
      catalogApiUrl: "", // Air-gapped offline mode!
      client: mockClient,
      loader,
      bundledSnapshotPath: bundledPath,
    });

    const snapshot = await service.initialize();

    expect(snapshot).toBeDefined();
    expect(service.isOffline()).toBe(true);
    // Crucial check: client was NEVER invoked!
    expect(mockClient.getCatalogSnapshot).not.toHaveBeenCalled();

    expect(postedMessages.length).toBe(1);
    const sentMsg = postedMessages[0] as {
      type: string;
      payload: { isOffline: boolean; publishedAt?: string };
    };
    expect(sentMsg.payload.isOffline).toBe(true);
    expect(sentMsg.payload.publishedAt).toBeDefined();

    service.dispose();
  });

  it("re-sends catalog/updated on webview/ready and catalog/request (late-opened panel)", async () => {
    const posted: Array<{ type: string; payload: { isOffline: boolean } }> = [];
    // Router without a target: the activation-time push is lost, as when no panel is open yet.
    const router = new MessageRouter();
    const mockContext = {
      globalState: { get: () => undefined, update: async () => {} },
      extensionPath: path.resolve(__dirname, "../.."),
      subscriptions: [],
    } as unknown as import("vscode").ExtensionContext;
    const service = new CatalogService(mockContext, router, {
      client: {
        getCatalogSnapshot: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      } as unknown as CatalogClient,
      loader: new BundledSnapshotLoader(async (p: string) => await fs.readFile(p, "utf-8")),
      bundledSnapshotPath: path.resolve(__dirname, "../../resources/catalog-snapshot.json"),
    });
    await service.initialize();
    expect(posted).toHaveLength(0);

    router.setTarget({
      postMessage: async (m: unknown) => {
        posted.push(m as (typeof posted)[number]);
        return true;
      },
    });
    await router.handleInbound({ version: 1, type: "webview/ready", payload: {} });
    await router.handleInbound({ version: 1, type: "catalog/request", payload: {} });

    expect(posted.map((m) => m.type)).toEqual(["catalog/updated", "catalog/updated"]);
    expect(posted[0].payload.isOffline).toBe(true);
    service.dispose();
  });
});
