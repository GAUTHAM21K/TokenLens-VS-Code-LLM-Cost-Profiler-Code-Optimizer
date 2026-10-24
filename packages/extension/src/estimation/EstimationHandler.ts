/**
 * Host handler for estimate/request: runs the core estimation engine on the finalized profile.
 *
 * Exports: EstimationHandlerOptions, EstimationHandler
 * Feature: token cost estimator
 */
import * as vscode from "vscode";
import {
  type CatalogSnapshot,
  type HostToWebviewMsg,
  estimate,
} from "@token-optimizer/core";
import type { MessageRouter } from "../webview/MessageRouter.js";
import type { ProfileHistoryStore } from "../enhance/ProfileHistoryStore.js";

export interface EstimationHandlerOptions {
  context: vscode.ExtensionContext;
  router: MessageRouter;
  historyStore: ProfileHistoryStore;
  getCatalogSnapshot: () => CatalogSnapshot | null;
  postMessage?: (msg: HostToWebviewMsg) => Promise<boolean>;
}

/**
 * Message handler for estimate/request messages.
 * (T072, FR-019, SC-003)
 */
export class EstimationHandler {
  private router: MessageRouter;
  private historyStore: ProfileHistoryStore;
  private getCatalogSnapshot: () => CatalogSnapshot | null;
  private postMessage: (msg: HostToWebviewMsg) => Promise<boolean>;

  constructor(options: EstimationHandlerOptions) {
    this.router = options.router;
    this.historyStore = options.historyStore;
    this.getCatalogSnapshot = options.getCatalogSnapshot;
    this.postMessage = options.postMessage ?? ((msg) => this.router.send(msg));
  }

  public register(): void {
    this.router.register("estimate/request", async (msg) => {
      const { operationId, profileVersion, overrides } = msg.payload;

      try {
        const catalog = this.getCatalogSnapshot();
        if (!catalog) {
          console.warn("[EstimationHandler] No catalog snapshot available for estimation.");
          await this.postMessage({
            version: 1,
            type: "estimate/error",
            payload: {
              operationId,
              error: "catalog-unavailable",
              message: "No catalog snapshot available for estimation.",
            },
          });
          return;
        }

        const entry = this.historyStore.getVersion(profileVersion);
        if (!entry || !entry.profile) {
          console.warn(
            `[EstimationHandler] Profile version ${profileVersion} not found in history store.`
          );
          await this.postMessage({
            version: 1,
            type: "estimate/error",
            payload: {
              operationId,
              error: "profile-not-found",
              message: `Profile version ${profileVersion} not found in history store.`,
            },
          });
          return;
        }

        // H11: Gated: profile must be finalized before estimation
        if (!entry.profile.finalizedAt) {
          await this.postMessage({
            version: 1,
            type: "estimate/error",
            payload: {
              operationId,
              error: "profile-not-finalized",
              message: `Profile version ${profileVersion} is not finalized yet. Please confirm and finalize phases in Enhance first.`,
            },
          });
          return;
        }

        const startTime = performance.now();
        const result = estimate(entry.profile, catalog, overrides);
        const durationMs = performance.now() - startTime;

        if (durationMs > 50) {
          console.warn(
            `[EstimationHandler] Estimation computation exceeded 50ms threshold: ${durationMs.toFixed(2)}ms (SC-003)`
          );
        }

        await this.postMessage({
          version: 1,
          type: "estimate/result",
          payload: {
            operationId,
            result,
          },
        });
      } catch (err) {
        console.error("[EstimationHandler] Error running estimation:", err);
        await this.postMessage({
          version: 1,
          type: "estimate/error",
          payload: {
            operationId,
            error: "estimation-failed",
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
    });
  }
}
