/**
 * Extension-host catalog service: loads the catalog (Catalog API -> cache -> bundled snapshot),
 * refreshes it every 24 h, and delivers it to the webview. Delivery is pull-safe: the current
 * snapshot + offline flag are re-sent on `webview/ready` and `catalog/request`, so a panel opened
 * after activation still gets the catalog (fixes the activation-time push race).
 *
 * Exports: CatalogService, validateCatalogApiUrl, DEFAULT_CATALOG_API_URL, CatalogUrlValidation,
 *   CatalogServiceOptions
 * Feature: catalog
 */
import * as vscode from "vscode";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import {
  CatalogClient,
  BundledSnapshotLoader,
  type CatalogSnapshot,
  type CatalogStorage,
} from "@token-optimizer/core";
import type { MessageRouter } from "../webview/MessageRouter.js";

/** Demo default: the local Catalog API started by `pnpm catalog:dev`. */
export const DEFAULT_CATALOG_API_URL = "http://127.0.0.1:3000/v1";

export interface CatalogUrlValidation {
  isValid: boolean;
  isOfflineMode: boolean;
  validatedUrl?: string;
  reason?: string;
}

export function validateCatalogApiUrl(rawUrl: string | undefined | null): CatalogUrlValidation {
  // If undefined/null, use the official default endpoint
  if (rawUrl === undefined || rawUrl === null) {
    return {
      isValid: true,
      isOfflineMode: false,
      validatedUrl: DEFAULT_CATALOG_API_URL,
    };
  }

  const trimmed = rawUrl.trim();
  // Empty value declares air-gapped offline-only mode
  if (trimmed === "") {
    return {
      isValid: true,
      isOfflineMode: true,
      reason: "Empty catalogApiUrl configured: running in air-gapped offline-only mode.",
    };
  }

  try {
    const parsed = new URL(trimmed);
    // Credentials check (Principle I & III guardrails: never allow credentials in catalog URL)
    if (parsed.username || parsed.password) {
      return {
        isValid: false,
        isOfflineMode: true,
        reason: "Catalog API URL must not contain credentials/userinfo.",
      };
    }

    // Protocol check: https:// only, except http:// allowed solely on localhost or 127.0.0.1 for local dev
    if (parsed.protocol === "https:") {
      return {
        isValid: true,
        isOfflineMode: false,
        validatedUrl: trimmed.replace(/\/+$/, ""),
      };
    }

    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return {
        isValid: true,
        isOfflineMode: false,
        validatedUrl: trimmed.replace(/\/+$/, ""),
      };
    }

    return {
      isValid: false,
      isOfflineMode: true,
      reason: "Catalog API URL must use https:// (http:// is only allowed for localhost / 127.0.0.1).",
    };
  } catch {
    return {
      isValid: false,
      isOfflineMode: true,
      reason: `Malformed catalog API URL: '${trimmed}'.`,
    };
  }
}

export interface CatalogServiceOptions {
  client?: CatalogClient;
  loader?: BundledSnapshotLoader;
  bundledSnapshotPath?: string;
  refreshIntervalMs?: number;
  catalogApiUrl?: string;
}

export class CatalogService implements vscode.Disposable {
  private currentSnapshot: CatalogSnapshot | null = null;
  private offline = false;
  private isAirGapped = false;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private client: CatalogClient;
  private loader: BundledSnapshotLoader;
  private bundledSnapshotPath: string;
  private refreshIntervalMs: number;
  private listeners: Array<(snapshot: CatalogSnapshot, isOffline: boolean) => void> = [];
  private unregisterHandlers: Array<() => void> = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly router?: MessageRouter,
    options: CatalogServiceOptions = {}
  ) {
    const globalStateStorage: CatalogStorage = {
      get: async <T>(key: string) => this.context.globalState.get<T>(key),
      set: async <T>(key: string, val: T) => {
        await this.context.globalState.update(key, val);
      },
    };

    const config =
      typeof vscode !== "undefined" &&
      vscode.workspace?.getConfiguration?.("tokenOptimizer");
    const rawUrl =
      options.catalogApiUrl !== undefined
        ? options.catalogApiUrl
        : config
          ? config.get<string>("catalogApiUrl")
          : undefined;

    const validation = validateCatalogApiUrl(rawUrl);
    if (!validation.isValid) {
      console.warn(`[CatalogService] ${validation.reason} Falling back to bundled snapshot.`);
    }

    this.isAirGapped = validation.isOfflineMode;
    const baseUrl = validation.validatedUrl || DEFAULT_CATALOG_API_URL;

    this.client =
      options.client ??
      new CatalogClient({
        baseUrl,
        storage: globalStateStorage,
      });

    this.loader =
      options.loader ??
      new BundledSnapshotLoader(async (filePath: string) => {
        return await fs.readFile(filePath, "utf-8");
      });

    const extPath =
      this.context.extensionPath ||
      this.context.extensionUri?.fsPath ||
      process.cwd();

    this.bundledSnapshotPath =
      options.bundledSnapshotPath ??
      path.join(extPath, "resources", "catalog-snapshot.json");

    // Default 24 hours
    this.refreshIntervalMs = options.refreshIntervalMs ?? 24 * 60 * 60 * 1000;

    // Pull-based delivery: a webview that mounts (or asks) after activation gets the current state.
    if (this.router) {
      const resend = async () => {
        await this.sendToWebview();
      };
      this.unregisterHandlers.push(
        this.router.register("webview/ready", resend),
        this.router.register("catalog/request", resend)
      );
    }
  }

  public async initialize(): Promise<CatalogSnapshot> {
    if (this.isAirGapped) {
      console.info("[CatalogService] Operating in air-gapped offline snapshot mode (zero network calls).");
      this.currentSnapshot = await this.loader.load(this.bundledSnapshotPath);
      this.offline = true;
    } else {
      try {
        const res = await this.client.getCatalogSnapshot();
        this.currentSnapshot = res.snapshot;
        this.offline = res.isOffline;
      } catch (err) {
        console.warn(
          "[CatalogService] Failed to fetch catalog from remote/cache; falling back to bundled snapshot:",
          err
        );
        try {
          this.currentSnapshot = await this.loader.load(this.bundledSnapshotPath);
          this.offline = true;
        } catch (loadErr) {
          console.error(
            "[CatalogService] Critical: Failed to load bundled catalog snapshot:",
            loadErr
          );
          throw loadErr;
        }
      }
    }

    await this.notifyCatalogUpdated();
    if (!this.isAirGapped) {
      this.scheduleRefresh();
    }
    return this.currentSnapshot;
  }

  public getCatalogSnapshot(): CatalogSnapshot | null {
    return this.currentSnapshot;
  }

  public isOffline(): boolean {
    return this.offline;
  }

  public onDidUpdateCatalog(
    listener: (snapshot: CatalogSnapshot, isOffline: boolean) => void
  ): vscode.Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  }

  public async notifyCatalogUpdated(): Promise<void> {
    if (!this.currentSnapshot) return;

    for (const listener of this.listeners) {
      try {
        listener(this.currentSnapshot, this.offline);
      } catch (err) {
        console.error("[CatalogService] Listener threw error:", err);
      }
    }

    await this.sendToWebview();
  }

  /** Posts `catalog/updated` with the current snapshot and offline flag (no-op until loaded). */
  public async sendToWebview(): Promise<void> {
    if (!this.currentSnapshot) return;
    if (this.router) {
      await this.router.send({
        type: "catalog/updated",
        version: 1,
        payload: {
          version: this.currentSnapshot.version,
          schemaVersion: this.currentSnapshot.schemaVersion,
          providers: this.currentSnapshot.providers,
          models: this.currentSnapshot.models,
          pricing: this.currentSnapshot.pricing,
          phases: this.currentSnapshot.phases,
          strategies: this.currentSnapshot.strategies,
          platforms: this.currentSnapshot.platforms,
          promptTemplates: this.currentSnapshot.promptTemplates,
          routerPresets: this.currentSnapshot.routerPresets ?? [],
          isOffline: this.offline,
          publishedAt: this.currentSnapshot.publishedAt,
        },
      });
    }
  }

  private scheduleRefresh(): void {
    if (this.isAirGapped) {
      return;
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(async () => {
      if (this.isAirGapped) return;
      try {
        const res = await this.client.getCatalogSnapshot();
        if (
          !this.currentSnapshot ||
          res.snapshot.version !== this.currentSnapshot.version ||
          res.isOffline !== this.offline
        ) {
          this.currentSnapshot = res.snapshot;
          this.offline = res.isOffline;
          await this.notifyCatalogUpdated();
        }
      } catch (err) {
        console.debug("[CatalogService] Background 24h refresh failed:", err);
      }
    }, this.refreshIntervalMs);
  }

  public dispose(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.listeners = [];
    for (const unregister of this.unregisterHandlers) unregister();
    this.unregisterHandlers = [];
  }
}
