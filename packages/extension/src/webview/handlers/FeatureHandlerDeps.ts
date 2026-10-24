/**
 * Shared dependency bag and helpers for the v2 feature handlers (strategy, promptopt, implement,
 * router, enhance prefill). FROZEN CONTRACT: extension.ts constructs every feature handler with
 * this bag, so Phase 1 tracks implement their handler without touching extension.ts.
 *
 * Exports: FeatureHandlerDeps, FeatureHandler, replyNotImplemented
 * Feature: extension host wiring (all v2 features)
 */
import type * as vscode from "vscode";
import type {
  CatalogSnapshot,
  FeatureErrorMsgType,
  ProviderAdapter,
} from "@token-optimizer/core";
import type { MessageRouter } from "../MessageRouter.js";
import type { KeyService } from "../../secrets/KeyService.js";
import type { ProfileHistoryStore } from "../../enhance/ProfileHistoryStore.js";

export interface FeatureHandlerDeps {
  context: vscode.ExtensionContext;
  router: MessageRouter;
  keyService: KeyService;
  /** Catalog-driven adapter map (kept in sync by extension.ts; read it at call time). */
  adapters: Map<string, ProviderAdapter>;
  historyStore: ProfileHistoryStore;
  getCatalogSnapshot: () => CatalogSnapshot | null;
}

export interface FeatureHandler {
  /** Registers this feature's webview -> host message handlers on deps.router. */
  register(): void;
}

/** Phase 0 stub reply: `<feature>/error` with error "not-implemented". */
export async function replyNotImplemented(
  router: MessageRouter,
  type: FeatureErrorMsgType,
  requestType: string,
  operationId?: string
): Promise<void> {
  await router.send({
    version: 1,
    type,
    payload: {
      ...(operationId ? { operationId } : {}),
      error: "not-implemented",
      message: `${requestType} is not implemented yet.`,
    },
  });
}
