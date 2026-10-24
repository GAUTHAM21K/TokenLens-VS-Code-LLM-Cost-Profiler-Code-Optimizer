/**
 * Layout helpers for the narrow sidebar: `useNarrowLayout` is true while the webview is narrower
 * than NARROW_MAX_WIDTH (VS Code opens the sidebar at ~300 px and extensions can't widen it), and
 * `hostView` reads which surface the host rendered us in (sidebar view or editor-area panel).
 *
 * Exports: NARROW_MAX_WIDTH, isNarrowWidth, useNarrowLayout, HostView, hostView
 * Feature: webview shell (responsive layout)
 */
import { useEffect, useState } from "react";

/** Below this width tabs collapse to icons (same as Tailwind's `sm` breakpoint). */
export const NARROW_MAX_WIDTH = 640;

export const isNarrowWidth = (width: number): boolean => width < NARROW_MAX_WIDTH;

export function useNarrowLayout(): boolean {
  const [narrow, setNarrow] = useState(() => isNarrowWidth(window.innerWidth));
  useEffect(() => {
    const onResize = () => setNarrow(isNarrowWidth(window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

export type HostView = "sidebar" | "panel" | "unknown";

/** Set by the extension host as `<meta name="token-optimizer-host" content="sidebar|panel">`. */
export function hostView(): HostView {
  const v = document.querySelector('meta[name="token-optimizer-host"]')?.getAttribute("content");
  return v === "sidebar" || v === "panel" ? v : "unknown";
}
