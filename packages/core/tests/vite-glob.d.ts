// Ambient type for Vite's import.meta.glob as used by Vitest tests in packages/core.
interface ImportMeta {
  glob(pattern: string, options: { eager: true; import: "default" }): Record<string, unknown>;
}
