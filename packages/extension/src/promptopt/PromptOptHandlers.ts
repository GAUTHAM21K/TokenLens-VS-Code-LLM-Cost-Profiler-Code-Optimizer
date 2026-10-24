/**
 * Host handler for the Prompt Optimizer tab: `promptopt/run` runs the selected catalog techniques
 * in catalog order (rule techniques locally via core `runPromptOptimization`, `llm` techniques
 * through the selected model's adapter + KeyService) and answers `promptopt/result`. An `llm`
 * failure answers `promptopt/error` and still sends the rule-only result when rules were selected.
 *
 * Exports: PromptOptHandlers
 * Feature: prompt optimizer
 */
import {
  getTokenizer,
  pricingReferenceTime,
  runPromptOptimization,
  type PromptOptRunMsg,
} from "@token-optimizer/core";
import type { FeatureHandler, FeatureHandlerDeps } from "../webview/handlers/FeatureHandlerDeps.js";

type ErrorCode = "invalid-request" | "no-model" | "no-key" | "llm-failed" | "internal";

export class PromptOptHandlers implements FeatureHandler {
  constructor(private readonly deps: FeatureHandlerDeps) {}

  register(): void {
    this.deps.router.register("promptopt/run", (msg) => {
      // Not awaited: an llm technique can outlast the router's 10 s handler timeout.
      void this.run(msg).catch((e) =>
        this.sendError(msg.payload.operationId, "internal", e instanceof Error ? e.message : String(e))
      );
    });
  }

  /** Runs one optimization; resolves after every reply has been sent. */
  async run(msg: PromptOptRunMsg): Promise<void> {
    const p = msg.payload;
    const snapshot = this.deps.getCatalogSnapshot();
    if (!snapshot) {
      await this.sendError(p.operationId, "invalid-request", "The catalog is not loaded yet.");
      return;
    }
    const model = snapshot.models.find((m) => m.id === p.modelId && m.providerId === p.providerId);
    if (!model) {
      await this.sendError(p.operationId, "no-model", `Model ${p.providerId}/${p.modelId} is not in the catalog.`);
      return;
    }

    const adapter = this.deps.adapters.get(p.providerId);
    const getKey = this.deps.keyService.getKeyGetter(p.providerId, p.keySlot ?? 0);
    const outcome = await runPromptOptimization(
      {
        messages: p.messages,
        params: p.params,
        techniqueIds: p.techniqueIds,
        providerId: p.providerId,
        modelId: p.modelId,
        expectedOutputTokens: p.expectedOutputTokens,
        strategies: snapshot.strategies,
        pricing: snapshot.pricing,
        promptTemplates: snapshot.promptTemplates,
        at: pricingReferenceTime(snapshot),
      },
      {
        tokenizer: getTokenizer(model),
        complete: adapter
          ? (messages) => adapter.complete(messages, getKey, { model: p.modelId, temperature: 0 })
          : undefined,
      }
    );

    if (outcome.result) {
      await this.deps.router.send({
        version: 1,
        type: "promptopt/result",
        payload: { ...(p.operationId ? { operationId: p.operationId } : {}), ...outcome.result },
      });
    }
    if (outcome.error) {
      const code: ErrorCode = /no key configured/i.test(outcome.error.message) ? "no-key" : outcome.error.error;
      const suffix = outcome.result ? " Rule techniques were still applied." : "";
      await this.sendError(p.operationId, code, `${outcome.error.message}${suffix}`);
    }
  }

  private async sendError(operationId: string | undefined, error: ErrorCode, message: string): Promise<void> {
    await this.deps.router.send({
      version: 1,
      type: "promptopt/error",
      payload: { ...(operationId ? { operationId } : {}), error, message: message.slice(0, 500) },
    });
  }
}
