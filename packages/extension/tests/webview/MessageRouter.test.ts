/**
 * Tests: MessageRouter (T014, Principle II).
 *
 * Exports: none (test suite)
 * Feature: shared protocol / webview shell
 */
import { describe, it, expect } from "vitest";
import { MessageRouter } from "../../src/webview/MessageRouter.js";

describe("MessageRouter (T014, Principle II)", () => {
  it("dispatches valid WebviewToHost message to registered handler", async () => {
    const router = new MessageRouter();
    let handled = false;
    let receivedPayload: { providerId: string; keySlot: number; key: string } | null = null;

    router.register("auth/saveKey", (msg) => {
      handled = true;
      receivedPayload = msg.payload;
    });

    const validMsg = {
      version: 1,
      type: "auth/saveKey",
      payload: {
        providerId: "anthropic",
        keySlot: 0,
        key: "sk-ant-test-key",
      },
    };

    const result = await router.handleInbound(validMsg);

    expect(result).toBe(true);
    expect(handled).toBe(true);
    expect(receivedPayload.providerId).toBe("anthropic");
    expect(receivedPayload.keySlot).toBe(0);
  });

  it("silently drops invalid or unknown messages without throwing", async () => {
    const router = new MessageRouter();
    let handled = false;

    router.register("auth/saveKey", () => {
      handled = true;
    });

    const unknownMsg = {
      version: 1,
      type: "malicious/hack",
      payload: { attack: true },
    };

    const invalidSchemaMsg = {
      version: 1,
      type: "auth/saveKey",
      payload: {
        // missing providerId, keySlot, key
      },
    };

    const unknownResult = await router.handleInbound(unknownMsg);
    const invalidResult = await router.handleInbound(invalidSchemaMsg);

    expect(unknownResult).toBe(false);
    expect(invalidResult).toBe(false);
    expect(handled).toBe(false);
  });

  it("validates outbound HostToWebview message before sending", async () => {
    const posted: unknown[] = [];
    const mockTarget = {
      postMessage: async (msg: unknown) => {
        posted.push(msg);
        return true;
      },
    };

    const router = new MessageRouter(mockTarget);

    const validOutbound = {
      version: 1 as const,
      type: "auth/keySaved" as const,
      payload: {
        providerId: "anthropic",
        keySlot: 0,
        maskedKey: "...1234",
      },
    };

    const sendSuccess = await router.send(validOutbound);
    expect(sendSuccess).toBe(true);
    expect(posted.length).toBe(1);
    const sentMsg = posted[0] as typeof validOutbound;
    expect(sentMsg.payload.maskedKey).toBe("...1234");

    const invalidOutbound = {
      version: 1,
      type: "auth/keySaved",
      payload: {
        // missing maskedKey and keySlot
        providerId: "anthropic",
      },
    } as unknown as typeof validOutbound;

    const sendFailed = await router.send(invalidOutbound);
    expect(sendFailed).toBe(false);
    expect(posted.length).toBe(1);
  });

  it("keeps handlers across a detached and re-attached target (view re-resolve)", async () => {
    const saved = {
      version: 1 as const,
      type: "auth/keySaved" as const,
      payload: { providerId: "groq", keySlot: 0, maskedKey: "...1234" },
    };
    const ready = { version: 1, type: "webview/ready", payload: {} };
    const first: unknown[] = [];
    const second: unknown[] = [];
    const router = new MessageRouter({ postMessage: async (m) => (first.push(m), true) });
    router.register("webview/ready", async () => {
      await router.send(saved);
    });

    await router.handleInbound(ready);
    router.detachTarget();
    expect(await router.send(saved)).toBe(false);
    router.setTarget({ postMessage: async (m) => (second.push(m), true) });
    await router.handleInbound(ready);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
  });

  it("sends to every attached webview (sidebar + editor panel) and detaches one at a time", async () => {
    const sidebar: unknown[] = [];
    const panel: unknown[] = [];
    const sidebarTarget = { postMessage: async (m: unknown) => (sidebar.push(m), true) };
    const panelTarget = { postMessage: async (m: unknown) => (panel.push(m), true) };
    const router = new MessageRouter(sidebarTarget);
    router.setTarget(panelTarget);
    const saved = {
      version: 1 as const,
      type: "auth/keySaved" as const,
      payload: { providerId: "groq", keySlot: 0, maskedKey: "...1234" },
    };

    expect(await router.send(saved)).toBe(true);
    router.detachTarget(panelTarget);
    expect(await router.send(saved)).toBe(true);
    router.detachTarget(sidebarTarget);
    expect(await router.send(saved)).toBe(false);

    expect(sidebar).toHaveLength(2);
    expect(panel).toHaveLength(1);
  });
});

