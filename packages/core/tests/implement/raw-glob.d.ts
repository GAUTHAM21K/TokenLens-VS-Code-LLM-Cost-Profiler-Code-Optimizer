/**
 * Ambient type for Vite's `import.meta.glob` with `?raw` (file text), used by the Implement
 * planner golden tests to read examples/demo-langchain-app without node:fs.
 *
 * Exports: none (ambient declaration)
 * Feature: implement optimization (tests)
 */
interface ImportMeta {
  glob(
    pattern: string,
    options: { eager: true; query: "?raw"; import: "default" }
  ): Record<string, string>;
}
