/**
 * Vitest configuration for @token-optimizer/core.
 *
 * Exports: default
 * Feature: tooling (build config)
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        statements: 80,
      },
    },
  },
});
