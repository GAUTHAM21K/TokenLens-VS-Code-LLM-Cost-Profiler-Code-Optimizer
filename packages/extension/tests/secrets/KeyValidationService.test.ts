/**
 * Tests: KeyValidationService Unit Tests (T050, T055, FR-003, FR-005).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect, vi } from "vitest";
import type * as vscode from "vscode";
import { KeyValidationService } from "../../src/secrets/KeyValidationService.js";
import { KeyService } from "../../src/secrets/KeyService.js";
import type { ProviderAdapter } from "@token-optimizer/core";

type PostedMessage = {
  version: number;
  type: string;
  payload: Record<string, unknown>;
};

describe("KeyValidationService Unit Tests (T050, T055, FR-003, FR-005)", () => {
  it("Scenario 1: valid key stores in KeyService and posts auth/keySaved", async () => {
    const mockStorage = {
      store: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const keyService = new KeyService(mockStorage as unknown as vscode.SecretStorage);

    const mockAdapter: ProviderAdapter = {
      providerId: "anthropic",
      validateKey: vi.fn().mockResolvedValue({ valid: true }),
      listModels: vi.fn(),
      complete: vi.fn(),
    };

    const posted: PostedMessage[] = [];
    const service = new KeyValidationService({
      keyService,
      adapters: new Map([["anthropic", mockAdapter]]),
      postMessage: async (msg) => {
        posted.push(msg as PostedMessage);
        return true;
      },
    });

    const success = await service.validateAndSaveKey("anthropic", 0, "sk-ant-valid12345");

    expect(success).toBe(true);
    expect(mockStorage.store).toHaveBeenCalledWith("provider:anthropic:0", "sk-ant-valid12345");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      version: 1,
      type: "auth/keySaved",
      payload: {
        providerId: "anthropic",
        keySlot: 0,
        maskedKey: "...2345",
      },
    });
  });

  it("Scenario 2: invalid key does NOT store and posts auth/keyError 'invalid'", async () => {
    const mockStorage = {
      store: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const keyService = new KeyService(mockStorage as unknown as vscode.SecretStorage);

    const mockAdapter: ProviderAdapter = {
      providerId: "openai",
      validateKey: vi.fn().mockResolvedValue({
        valid: false,
        reason: "invalid",
        message: "Incorrect API key provided.",
      }),
      listModels: vi.fn(),
      complete: vi.fn(),
    };

    const posted: PostedMessage[] = [];
    const service = new KeyValidationService({
      keyService,
      adapters: new Map([["openai", mockAdapter]]),
      postMessage: async (msg) => {
        posted.push(msg as PostedMessage);
        return true;
      },
    });

    const success = await service.validateAndSaveKey("openai", 0, "sk-bad-key");

    expect(success).toBe(false);
    expect(mockStorage.store).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      version: 1,
      type: "auth/keyError",
      payload: {
        providerId: "openai",
        keySlot: 0,
        error: "invalid",
        message: "Incorrect API key provided.",
      },
    });
  });

  it("Scenario 3: unreachable network error does NOT store and posts auth/keyError 'unreachable'", async () => {
    const mockStorage = {
      store: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    };
    const keyService = new KeyService(mockStorage as unknown as vscode.SecretStorage);

    const mockAdapter: ProviderAdapter = {
      providerId: "google",
      validateKey: vi.fn().mockResolvedValue({
        valid: false,
        reason: "unreachable",
        message: "Connection timed out.",
      }),
      listModels: vi.fn(),
      complete: vi.fn(),
    };

    const posted: PostedMessage[] = [];
    const service = new KeyValidationService({
      keyService,
      adapters: new Map([["google", mockAdapter]]),
      postMessage: async (msg) => {
        posted.push(msg as PostedMessage);
        return true;
      },
    });

    const success = await service.validateAndSaveKey("google", 0, "AIzaSyD-timeout");

    expect(success).toBe(false);
    expect(mockStorage.store).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({
      version: 1,
      type: "auth/keyError",
      payload: {
        providerId: "google",
        keySlot: 0,
        error: "unreachable",
        message: "Connection timed out.",
      },
    });
  });
});
