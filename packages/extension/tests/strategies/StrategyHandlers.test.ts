/**
 * Tests: StrategyHandlers. strategy/evaluate and strategy/set answer schema-valid
 * strategy/selection + strategy/savingsUpdate (bundled catalog techniques, stored profile), keep the
 * user's selection per profile version, and answer strategy/error for bad input.
 *
 * Exports: none (test suite)
 * Feature: token cost estimator (techniques savings)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({}));

import {
  CatalogSnapshotSchema,
  HostToWebviewMsgSchema,
  ProjectProfileSchema,
  type HostToWebviewMsg,
} from "@token-optimizer/core";
import { MessageRouter } from "../../src/webview/MessageRouter.js";
import type { FeatureHandlerDeps } from "../../src/webview/handlers/FeatureHandlerDeps.js";
import type { ProfileHistoryStore } from "../../src/enhance/ProfileHistoryStore.js";
import { StrategyHandlers } from "../../src/strategies/StrategyHandlers.js";
import bundled from "../../resources/catalog-snapshot.json";
import profileFixture from "../../../fixtures/profiles/ts-rag-chatbot.json";

const snapshot = CatalogSnapshotSchema.parse(bundled);
const profile = ProjectProfileSchema.parse(profileFixture);
const entry = { version: 1, narrative: "n", profile, createdAt: profile.createdAt };

describe("StrategyHandlers", () => {
  let posted: HostToWebviewMsg[];
  let router: MessageRouter;

  beforeEach(() => {
    posted = [];
    router = new MessageRouter({
      postMessage: async (m: unknown) => {
        posted.push(HostToWebviewMsgSchema.parse(m));
        return true;
      },
    });
    const historyStore = {
      getVersion: (v: number) => (v === 1 ? entry : undefined),
      getLatest: () => entry,
    } as unknown as ProfileHistoryStore;
    const deps = { router, historyStore, getCatalogSnapshot: () => snapshot } as unknown as FeatureHandlerDeps;
    new StrategyHandlers(deps).register();
  });

  const send = (type: string, payload: unknown) => router.handleInbound({ version: 1, type, payload });
  const last = <T extends HostToWebviewMsg["type"]>(type: T) =>
    posted.filter((m) => m.type === type).pop() as Extract<HostToWebviewMsg, { type: T }>;

  it("evaluate pre-selects applicable techniques and sends savings", async () => {
    await send("strategy/evaluate", { profileVersion: 1 });
    expect(posted.map((m) => m.type)).toEqual(["strategy/selection", "strategy/savingsUpdate"]);
    const sel = last("strategy/selection").payload;
    expect(sel.selected.map((s) => s.strategyId)).toContain("cache-prefix-ordering");
    expect(sel.selected.every((s) => s.reason.length > 0)).toBe(true);
    expect(last("strategy/savingsUpdate").payload.runtime.maxPercent).toBeGreaterThan(0);
  });

  it("set applies the selection, and a later evaluate keeps it", async () => {
    await send("strategy/evaluate", { profileVersion: 1 });
    const all = last("strategy/savingsUpdate").payload.runtime.maxPercent;
    await send("strategy/set", { selectedIds: ["caveman-output"] });
    expect(last("strategy/selection").payload.selected.map((s) => s.strategyId)).toEqual(["caveman-output"]);
    const update = last("strategy/savingsUpdate").payload;
    const one = update.runtime;
    // caveman-output affects output only: 20–60% of output spend, nothing on input spend.
    const out = update.channels!.runtime.output;
    expect([out.minPercent, out.maxPercent]).toEqual([20, 60]);
    expect(update.channels!.runtime.input.maxPercent).toBe(0);
    expect(one.maxPercent).toBeGreaterThan(0);
    expect(one.maxPercent).toBeLessThan(60);
    expect(one.maxPercent).toBeLessThan(all);

    await send("strategy/evaluate", { profileVersion: 1 });
    expect(last("strategy/selection").payload.selected.map((s) => s.strategyId)).toEqual(["caveman-output"]);
  });

  it("errors on unknown profile versions and technique ids", async () => {
    await send("strategy/evaluate", { profileVersion: 7 });
    expect(last("strategy/error").payload.error).toBe("invalid-request");
    await send("strategy/set", { selectedIds: ["nope"] });
    expect(last("strategy/error").payload.message).toContain("nope");
  });
});
