/**
 * HTTP client for the Catalog API with ETag caching and offline fallback to cached data.
 *
 * Exports: CatalogStorage, MemoryCatalogStorage, CatalogClientOptions, FetchCatalogResult,
 *   CatalogClient
 * Feature: catalog
 */
import {
  CatalogSnapshotSchema,
  type CatalogSnapshot,
} from "./schemas.js";

export interface CatalogStorage {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  set<T>(key: string, value: T): Promise<void> | void;
}

export class MemoryCatalogStorage implements CatalogStorage {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value);
  }
}

export interface CatalogClientOptions {
  baseUrl?: string;
  storage?: CatalogStorage;
  fetchFn?: typeof fetch;
}

export interface FetchCatalogResult {
  snapshot: CatalogSnapshot;
  fromCache: boolean;
  isOffline: boolean;
  etag?: string;
}

/**
 * Client for fetching and caching the Token Optimizer catalog snapshot.
 * Respects ETags and 304 Not Modified responses.
 * Zod-validates all snapshots before saving to cache or returning.
 * Strictly platform-agnostic (Principle X) with zero VS Code dependencies.
 */
export class CatalogClient {
  private baseUrl: string;
  private storage: CatalogStorage;
  private fetchFn: typeof fetch;

  constructor(options: CatalogClientOptions = {}) {
    this.baseUrl = (options.baseUrl || "https://catalog.token-optimizer.dev/v1").replace(
      /\/+$/,
      ""
    );
    this.storage = options.storage ?? new MemoryCatalogStorage();
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async getCatalogSnapshot(): Promise<FetchCatalogResult> {
    const cachedETag = await this.storage.get<string>("catalog:etag");
    const cachedSnapshot = await this.storage.get<CatalogSnapshot>("catalog:snapshot");

    const url = `${this.baseUrl}/catalog`;
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (cachedETag) {
      headers["If-None-Match"] = cachedETag;
    }

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers,
      });

      // 304 Not Modified
      if (response.status === 304) {
        if (cachedSnapshot) {
          return {
            snapshot: cachedSnapshot,
            fromCache: true,
            isOffline: false,
            etag: cachedETag,
          };
        }
      }

      // 200 OK
      if (response.status === 200) {
        const rawData = await response.json();
        // Zod validation throws if schema is invalid
        const validSnapshot = CatalogSnapshotSchema.parse(rawData);
        const newETag = response.headers.get("etag") || undefined;

        await this.storage.set("catalog:snapshot", validSnapshot);
        if (newETag) {
          await this.storage.set("catalog:etag", newETag);
        }

        return {
          snapshot: validSnapshot,
          fromCache: false,
          isOffline: false,
          etag: newETag,
        };
      }

      // Non-200/304 status (e.g. 503)
      if (cachedSnapshot) {
        return {
          snapshot: cachedSnapshot,
          fromCache: true,
          isOffline: true,
          etag: cachedETag,
        };
      }

      throw new Error(`Catalog API responded with status ${response.status}`);
    } catch (err) {
      // Network failure / connection refused
      if (cachedSnapshot) {
        return {
          snapshot: cachedSnapshot,
          fromCache: true,
          isOffline: true,
          etag: cachedETag,
        };
      }

      throw err;
    }
  }
}
