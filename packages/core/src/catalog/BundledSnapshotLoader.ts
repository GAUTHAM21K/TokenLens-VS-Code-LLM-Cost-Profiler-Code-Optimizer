/**
 * Loads and validates the bundled offline catalog snapshot through an injected file reader.
 *
 * Exports: ReadFileFn, BundledSnapshotLoader
 * Feature: catalog
 */
import {
  CatalogSnapshotSchema,
  type CatalogSnapshot,
} from "./schemas.js";

export type ReadFileFn = (filePath: string) => Promise<string>;

/**
 * Loads, parses, and Zod-validates bundled catalog snapshots.
 * Principle X: Platform-agnostic, requires an injected readFile function.
 */
export class BundledSnapshotLoader {
  constructor(private readonly readFile: ReadFileFn) {}

  async load(filePath: string): Promise<CatalogSnapshot> {
    const rawContent = await this.readFile(filePath);
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(rawContent);
    } catch (err) {
      throw new Error(`Failed to parse bundled snapshot JSON at ${filePath}: ${String(err)}`);
    }

    try {
      return CatalogSnapshotSchema.parse(parsedJson);
    } catch (err) {
      throw new Error(`Bundled snapshot at ${filePath} failed schema validation: ${String(err)}`);
    }
  }
}
