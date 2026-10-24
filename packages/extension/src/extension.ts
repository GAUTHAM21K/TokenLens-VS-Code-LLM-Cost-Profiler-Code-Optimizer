/**
 * VS Code extension entry point: registers the sidebar webview and the editor-area panel command
 * (both share one message router), builds the catalog-driven
 * provider adapter map, and wires every feature's host handlers onto the message router.
 * Phase 1 tracks implement their handler classes; the wiring here is frozen.
 *
 * Exports: activate, deactivate
 * Feature: extension host wiring (all features)
 */
import * as vscode from "vscode";
import { WebviewProvider } from "./webview/WebviewProvider.js";
import { OptimizerPanel } from "./webview/OptimizerPanel.js";
import { CatalogService } from "./catalog/CatalogService.js";
import { KeyService } from "./secrets/KeyService.js";
import { KeyValidationService } from "./secrets/KeyValidationService.js";
import { AuthHandlers } from "./webview/handlers/AuthHandlers.js";
import { EnhanceHandlers } from "./webview/handlers/EnhanceHandlers.js";
import { EnhanceService } from "./enhance/EnhanceService.js";
import { ProfileHistoryStore } from "./enhance/ProfileHistoryStore.js";
import { EstimationHandler } from "./estimation/EstimationHandler.js";
import { syncAdaptersFromCatalog } from "./providers/AdapterRegistry.js";
import { StrategyHandlers } from "./strategies/StrategyHandlers.js";
import { PromptOptHandlers } from "./promptopt/PromptOptHandlers.js";
import { ImplementHandlers } from "./implement/ImplementHandlers.js";
import { RouterHandlers } from "./router/RouterHandlers.js";
import { PrefillHandlers } from "./enhance/PrefillHandlers.js";
import type { FeatureHandlerDeps } from "./webview/handlers/FeatureHandlerDeps.js";
import type { ProviderAdapter } from "@token-optimizer/core";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WebviewProvider(context.extensionUri);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(
      WebviewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }
    )
  );

  const router = provider.getRouter();

  // Full-width editor-area panel sharing the sidebar's router and handlers.
  const openCommand = vscode.commands.registerCommand("tokenOptimizer.openPanel", () =>
    OptimizerPanel.createOrShow(context.extensionUri, router)
  );
  context.subscriptions.push(openCommand);
  router.register("view/openInEditor", async () => {
    await vscode.commands.executeCommand("tokenOptimizer.openPanel");
  });

  const catalogService = new CatalogService(context, router);
  context.subscriptions.push(catalogService);

  // Initialize adapters and auth services (Slice 2, Principle I, II, VII)
  const keyService = new KeyService(context.secrets);
  // Adapter map is built from the catalog providers (adapterType + baseUrl), e.g. Groq.
  // Services hold this Map by reference; it is refreshed on every catalog update.
  const adapters = new Map<string, ProviderAdapter>();
  context.subscriptions.push(
    catalogService.onDidUpdateCatalog((snapshot) => syncAdaptersFromCatalog(adapters, snapshot))
  );

  const validationService = new KeyValidationService({
    keyService,
    adapters,
    router,
  });

  const authHandlers = new AuthHandlers({
    context,
    router,
    keyService,
    validationService,
    getCatalogSnapshot: () => catalogService.getCatalogSnapshot(),
  });
  authHandlers.register();

  // Initialize enhance services and handlers (Slice 3, Principle I, II, IV, IX)
  const historyStore = new ProfileHistoryStore(context.workspaceState);
  const enhanceService = new EnhanceService({
    keyService,
    adapters,
    getCatalogSnapshot: () => catalogService.getCatalogSnapshot(),
    postMessage: async (msg) => {
      await router.send(msg);
    },
    historyStore,
  });

  const enhanceHandlers = new EnhanceHandlers({
    context,
    router,
    enhanceService,
    historyStore,
    getCatalogSnapshot: () => catalogService.getCatalogSnapshot(),
  });
  enhanceHandlers.register();

  // Initialize estimation handlers (Slice 4, Principle IV, XII, FR-019, SC-003)
  const estimationHandler = new EstimationHandler({
    context,
    router,
    historyStore,
    getCatalogSnapshot: () => catalogService.getCatalogSnapshot(),
  });
  estimationHandler.register();

  // v2 feature handlers (Phase 0 stubs reply "<feature>/error: not-implemented")
  const featureDeps: FeatureHandlerDeps = {
    context,
    router,
    keyService,
    adapters,
    historyStore,
    getCatalogSnapshot: () => catalogService.getCatalogSnapshot(),
  };
  for (const handler of [
    new PrefillHandlers(featureDeps),
    new StrategyHandlers(featureDeps),
    new PromptOptHandlers(featureDeps),
    new ImplementHandlers(featureDeps),
    new RouterHandlers(featureDeps),
  ]) {
    handler.register();
  }

  // Initialize catalog in background on activation
  catalogService.initialize().catch((err) => {
    console.error("[TokenOptimizer] Failed to initialize CatalogService:", err);
  });
}

export function deactivate(): void {
  // Cleanup
}
