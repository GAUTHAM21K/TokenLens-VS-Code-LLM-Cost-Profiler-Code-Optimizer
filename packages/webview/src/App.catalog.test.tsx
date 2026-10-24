/**
 * Tests for catalog delivery in the webview shell: the offline badge starts as "unknown", the
 * shell asks for the catalog (`catalog/request`) when none arrived after mount, the badge follows
 * `isOffline`, and the default model comes from the catalog + configured keys (no hard-coding).
 *
 * Exports: none (test suite)
 * Feature: webview shell / catalog delivery
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, act } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";
import { App, pickDefaultModel } from "./App";
import { vscodeBridge } from "./protocol/vscode";

const snapshot = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../extension/resources/catalog-snapshot.json"), "utf-8")
);

function sendCatalog(isOffline: boolean) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          version: 1,
          type: "catalog/updated",
          payload: {
            version: snapshot.version,
            schemaVersion: snapshot.schemaVersion,
            providers: snapshot.providers,
            models: snapshot.models,
            pricing: snapshot.pricing,
            phases: snapshot.phases,
            strategies: snapshot.strategies,
            platforms: snapshot.platforms,
            promptTemplates: snapshot.promptTemplates,
            routerPresets: snapshot.routerPresets,
            isOffline,
            publishedAt: snapshot.publishedAt,
          },
        },
      })
    );
  });
}

describe("catalog delivery (webview)", () => {
  afterEach(() => vi.useRealTimers());

  it("shows 'checking' until the catalog arrives and requests it if it is late", () => {
    vi.useFakeTimers();
    const post = vi.spyOn(vscodeBridge, "postMessage");
    render(<App />);
    expect(screen.getByText(/Catalog: checking/)).toBeDefined();
    expect(post.mock.calls.map((c) => c[0].type)).toContain("webview/ready");

    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(post.mock.calls.map((c) => c[0].type)).toContain("catalog/request");

    sendCatalog(false);
    expect(screen.getByText(/Catalog Connected/)).toBeDefined();
    sendCatalog(true);
    expect(screen.getByText(/Snapshot from/)).toBeDefined();
    post.mockRestore();
  });

  it("picks the first active model of a keyed, enabled provider (Groq) and nothing without keys", () => {
    expect(pickDefaultModel(snapshot.providers, snapshot.models, [])).toBeUndefined();
    expect(pickDefaultModel(snapshot.providers, snapshot.models, ["groq"])).toEqual({
      providerId: "groq",
      modelId: "openai/gpt-oss-20b",
    });
  });
});
