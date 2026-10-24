/**
 * Host handlers for the Router tab: `router/getConfig` -> `router/config` (saved workspace config
 * or the catalog default preset), `router/preview` -> `router/previewResult` (core RouterRules on
 * a sample prompt, using the unsaved UI config when given), `router/saveConfig` ->
 * `router/configSaved` (workspaceState). Errors reply `router/error`.
 *
 * Exports: RouterHandlers
 * Feature: model router
 */
import { routePrompt, type FeatureErrorPayload } from "@token-optimizer/core";
import type { FeatureHandler, FeatureHandlerDeps } from "../webview/handlers/FeatureHandlerDeps.js";
import { sanitizeLogText } from "../webview/MessageRouter.js";
import { resolveRouterConfig, saveRouterConfig } from "./routerConfigStore.js";

const NO_PRESET = "The catalog has no router preset; refresh the catalog or save a router config.";

export class RouterHandlers implements FeatureHandler {
  constructor(private readonly deps: FeatureHandlerDeps) {}

  private async fail(
    error: FeatureErrorPayload["error"],
    message: string,
    operationId?: string
  ): Promise<void> {
    await this.deps.router.send({
      version: 1,
      type: "router/error",
      payload: { ...(operationId ? { operationId } : {}), error, message: sanitizeLogText(message).slice(0, 500) },
    });
  }

  register(): void {
    const { router, context, getCatalogSnapshot } = this.deps;

    router.register("router/getConfig", async () => {
      const resolved = resolveRouterConfig(context.workspaceState, getCatalogSnapshot());
      if (!resolved) return this.fail("invalid-request", NO_PRESET);
      await router.send({ version: 1, type: "router/config", payload: resolved });
    });

    router.register("router/preview", async (msg) => {
      const { operationId, text, needsTools, config } = msg.payload;
      const effective = config ?? resolveRouterConfig(context.workspaceState, getCatalogSnapshot())?.config;
      if (!effective) return this.fail("invalid-request", NO_PRESET, operationId);
      try {
        const decision = routePrompt(text, effective, needsTools ?? false);
        await router.send({
          version: 1,
          type: "router/previewResult",
          payload: { ...(operationId ? { operationId } : {}), decision },
        });
      } catch (err) {
        await this.fail("invalid-request", err instanceof Error ? err.message : String(err), operationId);
      }
    });

    router.register("router/saveConfig", async (msg) => {
      try {
        const stored = await saveRouterConfig(context.workspaceState, msg.payload.config);
        await router.send({ version: 1, type: "router/configSaved", payload: stored });
      } catch (err) {
        await this.fail("io-failed", err instanceof Error ? err.message : String(err));
      }
    });
  }
}
