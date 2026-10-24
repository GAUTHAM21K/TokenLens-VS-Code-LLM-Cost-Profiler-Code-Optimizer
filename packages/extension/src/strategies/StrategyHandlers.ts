/**
 * Host handlers for the estimator's technique selection. `strategy/evaluate` runs the core
 * StrategyEngine on a stored profile version (applicability -> pre-selected techniques with
 * reasons; the user's selection for that version is kept if one exists) and `strategy/set` applies
 * the user's selection. Both answer `strategy/selection` + `strategy/savingsUpdate`; failures
 * answer `strategy/error`.
 *
 * Exports: StrategyHandlers
 * Feature: token cost estimator (techniques savings)
 */
import {
  evaluateStrategies,
  selectStrategies,
  type FeatureErrorPayload,
  type ProjectProfile,
  type StrategyEvaluation,
} from "@token-optimizer/core";
import type { FeatureHandler, FeatureHandlerDeps } from "../webview/handlers/FeatureHandlerDeps.js";

export class StrategyHandlers implements FeatureHandler {
  /** User selection per profile version (in memory; re-evaluation pre-selects again after reload). */
  private readonly selections = new Map<number, string[]>();
  private currentVersion: number | undefined;

  constructor(private readonly deps: FeatureHandlerDeps) {}

  register(): void {
    const { router } = this.deps;

    router.register("strategy/evaluate", async (msg) => {
      const strategies = this.deps.getCatalogSnapshot()?.strategies;
      const pricing = this.deps.getCatalogSnapshot()?.pricing ?? [];
      if (!strategies) return this.fail("internal", "The catalog is not loaded yet.");
      const version = msg.payload.profileVersion;
      const entry = this.deps.historyStore.getVersion(version);
      if (!entry) return this.fail("invalid-request", `Profile version ${version} not found.`);

      this.currentVersion = version;
      const saved = this.selections.get(version);
      let result: StrategyEvaluation;
      try {
        result = saved
          ? selectStrategies(strategies, entry.profile, saved.filter((id) => strategies.some((s) => s.id === id && s.reviewStatus === "approved")), pricing)
          : evaluateStrategies(strategies, entry.profile, pricing);
      } catch (err) {
        return this.fail("internal", err instanceof Error ? err.message : String(err));
      }
      this.selections.set(version, result.selected.map((s) => s.strategyId));
      await this.reply(result);
    });

    router.register("strategy/set", async (msg) => {
      const strategies = this.deps.getCatalogSnapshot()?.strategies;
      if (!strategies) return this.fail("internal", "The catalog is not loaded yet.");
      const store = this.deps.historyStore;
      const entry =
        (this.currentVersion !== undefined ? store.getVersion(this.currentVersion) : undefined) ??
        store.getLatest();
      const profile: ProjectProfile | null = entry?.profile ?? null;

      let result: StrategyEvaluation;
      try {
        const pricing = this.deps.getCatalogSnapshot()?.pricing ?? [];
        result = selectStrategies(strategies, profile, [...new Set(msg.payload.selectedIds)], pricing);
      } catch (err) {
        return this.fail("invalid-request", err instanceof Error ? err.message : String(err));
      }
      if (entry) {
        this.currentVersion = entry.version;
        this.selections.set(entry.version, result.selected.map((s) => s.strategyId));
      }
      await this.reply(result);
    });
  }

  private async reply(result: StrategyEvaluation): Promise<void> {
    const { router } = this.deps;
    await router.send({
      version: 1,
      type: "strategy/selection",
      payload: {
        selected: result.selected,
        conflicts: result.conflicts,
        notPreselected: result.notPreselected,
      },
    });
    await router.send({
      version: 1,
      type: "strategy/savingsUpdate",
      payload: {
        build: result.savings.build,
        runtime: result.savings.runtime,
        channels: result.channels,
        conflicts: result.conflicts,
      },
    });
  }

  private async fail(error: FeatureErrorPayload["error"], message: string): Promise<void> {
    await this.deps.router.send({
      version: 1,
      type: "strategy/error",
      payload: { error, message: message.slice(0, 500) },
    });
  }
}
