/**
 * Tests: UserSetupStore (T131, FR-050, Principle I).
 *
 * Exports: none (test suite)
 * Feature: settings / API keys
 */
import { describe, it, expect } from "vitest";
import {
  UserSetupStore,
  type SetupStorageBackend,
  type UserSetup,
} from "../../src/setup/UserSetupStore.js";

class InMemorySetupBackend implements SetupStorageBackend {
  private data = new Map<string, unknown>();

  public get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  public set<T>(key: string, value: T): void {
    this.data.set(key, value);
  }

  public getAll(): Record<string, unknown> {
    return Object.fromEntries(this.data.entries());
  }
}

describe("UserSetupStore (T131, FR-050, Principle I)", () => {
  it("saves and reloads identical non-secret UserSetup", async () => {
    const backend = new InMemorySetupBackend();
    const store = new UserSetupStore(backend);

    const initial = await store.getSetup();
    expect(initial.copilotOnly).toBe(false);
    expect(initial.enabledModelsByProvider).toEqual({});

    const setupToSave: UserSetup = {
      platformId: "cursor",
      enabledModelsByProvider: {
        anthropic: ["claude-3-5-sonnet"],
        openai: ["gpt-4o"],
      },
      enhanceModel: {
        providerId: "anthropic",
        modelId: "claude-3-5-sonnet",
        keySlot: 0,
      },
      copilotOnly: false,
    };

    await store.saveSetup(setupToSave);

    const reloadedStore = new UserSetupStore(backend);
    const loaded = await reloadedStore.getSetup();

    expect(loaded).toEqual(setupToSave);
  });

  it("stored JSON representation contains zero raw secrets or key-shaped strings (Principle I)", async () => {
    const backend = new InMemorySetupBackend();
    const store = new UserSetupStore(backend);

    await store.saveSetup({
      platformId: "vscode",
      enabledModelsByProvider: {
        anthropic: ["claude-3-5-sonnet"],
      },
      enhanceModel: {
        providerId: "anthropic",
        modelId: "claude-3-5-sonnet",
      },
      copilotOnly: true,
    });

    const rawJson = JSON.stringify(backend.getAll());

    // Never contain API key prefixes or secrets
    expect(rawJson).not.toMatch(/sk-ant-/);
    expect(rawJson).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(rawJson).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
    expect(rawJson).not.toContain("password");
    expect(rawJson).not.toContain("secret");
  });
});
