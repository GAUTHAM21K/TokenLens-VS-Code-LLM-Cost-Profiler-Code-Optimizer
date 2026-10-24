/**
 * Vitest (jsdom) configuration for the webview.
 *
 * Exports: default
 * Feature: tooling (build config)
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
});
