/**
 * Tests: KeyService Unit Tests (T042, T054, Principle I).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect } from "vitest";
import { KeyService } from "../../src/secrets/KeyService.js";
import type * as vscode from "vscode";

class MockSecretStorage implements vscode.SecretStorage {
  private storeMap = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.storeMap.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.storeMap.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.storeMap.delete(key);
  }

  onDidChange = (() => ({
    dispose: () => {},
  })) as unknown as vscode.Event<vscode.SecretStorageChangeEvent>;
}

describe("KeyService Unit Tests (T042, T054, Principle I)", () => {
  it("stores keys under namespaced format provider:{id}:{slot}", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    await service.storeKey("anthropic", 0, "sk-ant-testkey12345");

    const raw = await storage.get("provider:anthropic:0");
    expect(raw).toBe("sk-ant-testkey12345");
  });

  it("getKeyGetter returns a closure, never raw string (Principle I)", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    await service.storeKey("openai", 1, "sk-proj-supersecret999");

    const getter = service.getKeyGetter("openai", 1);
    expect(typeof getter).toBe("function");

    // Resolving getter retrieves secret
    const secret = await getter();
    expect(secret).toBe("sk-proj-supersecret999");
  });

  it("getter throws clear error if key does not exist", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    const getter = service.getKeyGetter("google", 0);
    await expect(getter()).rejects.toThrow(/No key configured for provider 'google'/);
  });

  it("masks keys safely according to MaskedKeySchema", () => {
    expect(KeyService.maskKey("sk-ant-12345678abcd")).toBe("...abcd");
    expect(KeyService.maskKey("1234")).toBe("...1234");
    expect(KeyService.maskKey("ab")).toBe("...ab");
    expect(KeyService.maskKey("")).toBe("...");
  });

  it("listConfigured returns masked keys only and omits raw values", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    await service.storeKey("anthropic", 0, "sk-ant-verysecret1234");
    await service.storeKey("openai", 0, "sk-proj-mock5678");

    const configured = await service.listConfigured([
      { id: "anthropic" },
      { id: "openai" },
      { id: "mistral" },
    ]);

    expect(configured.length).toBe(2);
    expect(configured).toEqual([
      { providerId: "anthropic", keySlot: 0, maskedKey: "...1234" },
      { providerId: "openai", keySlot: 0, maskedKey: "...5678" },
    ]);

    // Ensure raw secrets do not appear anywhere in configured list
    const jsonStr = JSON.stringify(configured);
    expect(jsonStr).not.toContain("verysecret");
    expect(jsonStr).not.toContain("mock5678");
  });

  it("deleteKey removes the key from SecretStorage", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    await service.storeKey("anthropic", 0, "sk-ant-key");
    await service.deleteKey("anthropic", 0);

    const raw = await storage.get("provider:anthropic:0");
    expect(raw).toBeUndefined();
  });

  it("rejects invalid slot numbers outside 0-10 or non-integers", async () => {
    const storage = new MockSecretStorage();
    const service = new KeyService(storage);

    await expect(service.storeKey("anthropic", -1, "sk-ant-key")).rejects.toThrow(
      /Invalid key slot '-1'/
    );
    await expect(service.storeKey("anthropic", 11, "sk-ant-key")).rejects.toThrow(
      /Invalid key slot '11'/
    );
    await expect(service.storeKey("anthropic", 1.5, "sk-ant-key")).rejects.toThrow(
      /Invalid key slot '1.5'/
    );
  });
});
