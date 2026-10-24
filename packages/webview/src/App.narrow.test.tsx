/**
 * Tests: the webview shell at VS Code's default narrow sidebar width (300 px). Every tab must be
 * reachable (icon-only buttons with accessible names in a horizontally scrollable bar), the
 * active tab keeps its label, and "Open in editor" asks the host for the full-width panel
 * (hidden when we already are that panel).
 *
 * Exports: none (test suite)
 * Feature: webview shell (responsive layout)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { App } from "./App";
import { vscodeBridge } from "./protocol/vscode";
import { isNarrowWidth } from "./utils/layout";

const TABS = ["Enhance", "Estimate", "Optimize", "Prompt Optimizer", "Implement", "Router", "Settings"];
const originalWidth = window.innerWidth;

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  window.dispatchEvent(new Event("resize"));
};

describe("narrow sidebar layout (300 px)", () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    postSpy = vi.spyOn(vscodeBridge, "postMessage").mockImplementation(() => {});
    setWidth(300);
  });
  afterEach(() => {
    postSpy.mockRestore();
    setWidth(originalWidth);
    document.querySelector('meta[name="token-optimizer-host"]')?.remove();
  });

  it("every tab is reachable: icon-only buttons with names, scrollable bar, active label shown", () => {
    expect(isNarrowWidth(300)).toBe(true);
    render(<App />);
    const bar = screen.getByTestId("tab-bar");
    expect(bar.className).toContain("overflow-x-auto");
    expect(bar.className).not.toContain("overflow-hidden");

    for (const name of TABS) {
      const tab = within(bar).getByRole("button", { name });
      expect(tab.getAttribute("title")).toBe(name);
      expect(tab.className).toContain("shrink-0");
      fireEvent.click(tab);
      expect(tab.getAttribute("aria-current")).toBe("page");
      // the active tab shows its label; every other tab is icon-only
      expect(tab.textContent).toContain(name);
      const others = within(bar).getAllByRole("button").filter((b) => b !== tab);
      expect(others).toHaveLength(TABS.length - 1);
      for (const o of others) expect(o.textContent).toBe("");
    }
  });

  it("shows labels again when the pane is widened", () => {
    render(<App />);
    act(() => setWidth(1000));
    const bar = screen.getByTestId("tab-bar");
    for (const name of TABS) expect(within(bar).getByRole("button", { name }).textContent).toContain(name);
  });

  it("'Open in editor' asks the host for the editor panel, and is hidden inside that panel", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    expect(postSpy).toHaveBeenCalledWith({ version: 1, type: "view/openInEditor", payload: {} });
    unmount();

    const meta = document.createElement("meta");
    meta.name = "token-optimizer-host";
    meta.content = "panel";
    document.head.appendChild(meta);
    render(<App />);
    expect(screen.queryByRole("button", { name: "Open in editor" })).toBeNull();
  });
});
