/**
 * Estimate tab: per-phase cost table, model comparison (with a "with selected techniques" cost
 * per track and model, from the host's compounded savings range) and explain popovers.
 *
 * Exports: EstimateProps, Estimate
 * Feature: token cost estimator
 */
import React, { useState } from "react";
import {
  Calculator,
  RefreshCw,
  BarChart3,
  HelpCircle,
  Layers,
  Zap,
  Lock,
} from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import { formatCost } from "../utils/format";
import { ExplainPopover } from "../components/ExplainPopover";
import {
  WithTechniquesCost,
  useTechniqueSavings,
} from "../components/estimate/WithTechniquesCost";
import type {
  EstimationResult,
  CostRange,
  PhaseResult,
  ExplainNode,
  PhaseOverride,
  Phase as CatalogPhase,
  Model,
  Pricing,
  ProjectProfile,
} from "@token-optimizer/core";

export interface EstimateProps {
  estimation: EstimationResult | null;
  isLoading: boolean;
  profileVersion?: number;
  profile?: ProjectProfile | null;
  catalogPhases?: CatalogPhase[];
  models?: Model[];
  pricing?: Pricing[];
}

export const Estimate: React.FC<EstimateProps> = ({
  estimation,
  isLoading,
  profileVersion = 1,
  profile,
  catalogPhases = [],
  models = [],
  pricing = [],
}) => {
  const [activeTrack, setActiveTrack] = useState<"build" | "runtime">("runtime");
  const [selectedExplainNode, setSelectedExplainNode] = useState<ExplainNode | null>(null);
  const [explainTitle, setExplainTitle] = useState<string>("Calculation Explanation");
  const [overrides, setOverrides] = useState<Record<string, Partial<PhaseOverride>>>({});

  const currentVersion = estimation?.profileVersion ?? profileVersion;
  const techniqueSavings = useTechniqueSavings(profile?.profileVersion ?? estimation?.profileVersion);

  const cacheSavingsFor = (track: "build" | "runtime", modelId: string, modelPricing?: Pricing) => {
    const cachedTokens = (estimation?.[track].phases ?? []).reduce(
      (total, phase) => total + (phase.tokensByModel[modelId]?.cachedInputTokens ?? 0),
      0
    );
    const regularRate = modelPricing?.inputPerMTok ?? 0;
    const cachedRate = modelPricing?.cachedInputPerMTok ?? regularRate;
    const usd = (cachedTokens * Math.max(0, regularRate - cachedRate)) / 1_000_000;
    const baseCost = (cachedTokens * regularRate) / 1_000_000;
    return { usd, percent: baseCost > 0 ? (usd / baseCost) * 100 : 0 };
  };

  // Find description for a phase
  const getPhaseDescription = (phaseId: string, phaseName: string): string => {
    const found = catalogPhases.find(
      (cp) =>
        cp.id === phaseId ||
        phaseId.includes(cp.id) ||
        cp.name.toLowerCase() === phaseName.toLowerCase()
    );
    return (
      found?.description ??
      `Deterministic processing phase covering ${phaseName} token execution.`
    );
  };

  const handleAssumptionChange = (
    phaseId: string,
    field: keyof PhaseOverride,
    value: number
  ) => {
    const updated = {
      ...overrides,
      [phaseId]: {
        ...overrides[phaseId],
        phaseId,
        [field]: value,
      },
    };
    setOverrides(updated);

    // Immediate recompute without manual reload (FR-020)
    const overrideList: PhaseOverride[] = Object.values(updated)
      .filter((o): o is PhaseOverride => typeof o.phaseId === "string");

    vscodeBridge.postMessage({
      version: 1,
      type: "estimate/request",
      payload: {
        profileVersion: currentVersion,
        overrides: overrideList,
      },
    });
  };

  const handleRecompute = () => {
    const overrideList: PhaseOverride[] = Object.values(overrides)
      .filter((o): o is PhaseOverride => typeof o.phaseId === "string");

    vscodeBridge.postMessage({
      version: 1,
      type: "estimate/request",
      payload: {
        profileVersion: currentVersion,
        overrides: overrideList.length > 0 ? overrideList : undefined,
      },
    });
  };

  const openExplain = (node: ExplainNode, title: string) => {
    setSelectedExplainNode(node);
    setExplainTitle(title);
  };

  // Active track phases
  const trackPhases: PhaseResult[] = estimation
    ? estimation[activeTrack].phases
    : [];

  // Available models from estimation
  const modelIds = estimation
    ? Object.keys(estimation[activeTrack].totalByModel)
    : [];
  const primaryModelId = modelIds[0] ?? "";

  // Scale metrics for RUNTIME track (FR-021, H4)
  const requestsPerDay = profile?.scale?.requestsPerDay ?? 1000;
  const monthlyDays = profile?.scale?.monthlyDays ?? 22;
  const runtimeMonthlyExpected = estimation
    ? primaryModelId && estimation.runtime.totalByModel[primaryModelId]
      ? estimation.runtime.totalByModel[primaryModelId].expected
      : estimation.totalExpectedCost
    : 0;

  // Use engine scaleMetrics with fallback to UI calculation
  const costPerRequest =
    estimation?.scaleMetrics?.costPerRequest ??
    (requestsPerDay * monthlyDays > 0
      ? runtimeMonthlyExpected / (requestsPerDay * monthlyDays)
      : 0);
  const costPerUserDay =
    estimation?.scaleMetrics?.costPerUserDay ??
    (monthlyDays > 0 ? runtimeMonthlyExpected / monthlyDays : 0);

  // Pricing verification date for display (H8)
  const activePricingVerifiedAt =
    estimation?.[activeTrack]?.totalByModel[primaryModelId]?.pricingVerifiedAt ??
    pricing.find((p) => p.modelId === primaryModelId)?.verifiedAt ??
    (estimation ? estimation.generatedAt.slice(0, 10) : "");

  // H11 Gating: if profile exists but is not finalized, lock the estimation view
  if (profile && !profile.finalizedAt) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-y-2 glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Deterministic Estimation Locked
              </h2>
              <p className="text-xs text-slate-400">
                Project Profile v{profile.profileVersion} must be finalized before estimation
              </p>
            </div>
          </div>
        </div>

        <div className="glass-panel p-12 rounded-xl border border-amber-900/40 bg-amber-950/10 text-center space-y-3">
          <Lock className="w-8 h-8 text-amber-500 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-200">
            Profile Finalization Required (FR-015 / Principle X)
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Deterministic token and cost estimation requires a finalized project profile.
            Please review and confirm your pipeline phases in the Enhance tab and click Finalize Profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Track Selector */}
      <div className="flex items-center justify-between flex-wrap gap-y-2 glass-panel p-4 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">
              Deterministic Estimation
            </h2>
            <p className="text-xs text-slate-400">
              Zero LLM inference • Mathematical catalog formulas • Principle IV
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTrack("runtime")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeTrack === "runtime"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Runtime Track
            </button>
            <button
              onClick={() => setActiveTrack("build")}
              className={`px-3 py-1 rounded-md font-medium transition-colors ${
                activeTrack === "build"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Build Track
            </button>
          </div>

          <button
            onClick={handleRecompute}
            disabled={isLoading}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title="Recompute Estimate"
            aria-label="Recompute estimate"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {estimation ? (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="glass-panel p-4 rounded-xl border border-slate-800 relative">
              <span className="text-[11px] text-slate-400 block mb-1">
                Total Expected Cost (Dual-Track)
              </span>
              <div className="text-2xl font-bold text-indigo-400 flex items-center gap-2">
                <span>{formatCost(estimation.totalExpectedCost)}</span>
                <span className="text-xs font-normal text-slate-500 font-sans">
                  {estimation.currency}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                Primary model monthly projection
              </span>
            </div>

            <div className="glass-panel p-4 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-1">
                Active Track ({activeTrack.toUpperCase()})
              </span>
              <div className="text-2xl font-bold text-slate-200">
                {formatCost(
                  estimation[activeTrack].totalByModel[primaryModelId]?.expected ?? 0
                )}
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                Range: [
                {formatCost(
                  estimation[activeTrack].totalByModel[primaryModelId]?.low ?? 0
                )}
                {" - "}
                {formatCost(
                  estimation[activeTrack].totalByModel[primaryModelId]?.high ?? 0
                )}
                ]
              </span>
            </div>

            <div className="glass-panel p-4 rounded-xl border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-1">
                Profile Version & Date
              </span>
              <div className="text-2xl font-bold text-slate-200">
                v{estimation.profileVersion}
              </div>
              <span className="text-[10px] text-slate-500 block mt-1 truncate">
                pricing verified {activePricingVerifiedAt ? activePricingVerifiedAt.slice(0, 10) : "verified"}
              </span>
            </div>
          </div>

          {/* RUNTIME Track Scale Assumptions Panel (FR-021, H4) */}
          {activeTrack === "runtime" && (
            <div className="glass-panel p-4 rounded-xl border border-indigo-500/30 bg-indigo-950/10 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-y-2">
                <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  Runtime Scale Breakdowns (FR-021)
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {requestsPerDay} req/day • {monthlyDays} active days/mo
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center pt-1 font-mono">
                <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-400 block">Per Request</span>
                    {estimation.scaleMetrics?.explainTrees?.costPerRequest && (
                      <button
                        onClick={() =>
                          openExplain(
                            estimation.scaleMetrics!.explainTrees!.costPerRequest,
                            "Explain: Cost Per Request"
                          )
                        }
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-sans"
                        aria-label="Explain cost per request"
                      >
                        Explain
                      </button>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-200 block mt-0.5">
                    {formatCost(costPerRequest)}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] text-slate-400 block">Per User Day</span>
                    {estimation.scaleMetrics?.explainTrees?.costPerUserDay && (
                      <button
                        onClick={() =>
                          openExplain(
                            estimation.scaleMetrics!.explainTrees!.costPerUserDay,
                            "Explain: Cost Per User Day"
                          )
                        }
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 underline font-sans"
                        aria-label="Explain cost per user day"
                      >
                        Explain
                      </button>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-200 block mt-0.5">
                    {formatCost(costPerUserDay)}
                  </span>
                </div>
                <div className="bg-slate-900/60 p-2 rounded border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">Per Month</span>
                  <span className="text-xs font-bold text-indigo-300 block mt-0.5">
                    {formatCost(runtimeMonthlyExpected)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Phase List with Editable Assumptions & Descriptions (FR-017, FR-018, FR-020, T134, H6, H7) */}
          <div className="glass-panel p-5 rounded-xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {activeTrack === "build" ? "Build" : "Runtime"} Phases ({trackPhases.length})
                </span>
              </h3>
              <span className="text-[11px] text-slate-500">
                Edit assumptions to trigger immediate recomputation (FR-020)
              </span>
            </div>

            <div className="space-y-4">
              {trackPhases.map((phase) => {
                const params = phase.params as {
                  calls?: { expected: number };
                  tokensPerCall?: { expected: number };
                  retries?: { expected: number };
                  volumeMultiplier?: { expected: number };
                };
                // H6: Direct description from PhaseResult
                const description =
                  phase.description ??
                  getPhaseDescription(phase.phaseTypeId ?? phase.phaseId, phase.phaseName);

                return (
                  <div
                    key={phase.phaseId}
                    className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-3"
                  >
                    {/* Phase Header */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-slate-100">
                            {phase.phaseName}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-mono bg-slate-800 text-slate-300 border border-slate-700">
                            {phase.phaseId}
                          </span>
                        </div>
                        {/* Phase Description (T134, FR-018, H6) */}
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          {description}
                        </p>
                      </div>

                      {/* Primary Explain Button */}
                      <button
                        onClick={() =>
                          openExplain(phase.explainTree, `Explain: ${phase.phaseName}`)
                        }
                        className="self-start md:self-auto px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-indigo-200 text-xs font-medium flex items-center gap-1 transition-colors border border-slate-700"
                        title="Explain formula and inputs for this phase"
                        aria-label={`Explain ${phase.phaseName}`}
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Explain</span>
                      </button>
                    </div>

                    {/* Per-Model Columns & Cost Breakdown Table (T073, H7) */}
                    <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-slate-950/60 p-2">
                      <table className="w-full text-left text-xs font-mono">
                        <thead>
                          <tr className="text-[10px] text-slate-500 border-b border-slate-800 font-sans">
                            <th className="pb-1.5 font-medium">Model</th>
                            <th className="pb-1.5 font-medium">Input Tok</th>
                            <th className="pb-1.5 font-medium">Output Tok</th>
                            <th className="pb-1.5 font-medium">Cached Tok</th>
                            <th className="pb-1.5 font-medium">Low Cost</th>
                            <th className="pb-1.5 font-medium">Expected</th>
                            <th className="pb-1.5 font-medium">High Cost</th>
                            <th className="pb-1.5 font-medium text-right font-sans">Explain</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/40">
                          {modelIds.map((mId) => {
                            const mTokens = phase.tokensByModel[mId];
                            const mCost = phase.costByModel[mId];
                            const matchedModel = models.find((m) => m.id === mId);
                            const modelLabel = matchedModel?.label ?? mId;
                            const mExplain =
                              phase.explainTreesByModel?.[mId] ?? phase.explainTree;

                            if (!mCost && !mTokens) return null;

                            return (
                              <tr key={mId} className="hover:bg-slate-900/30">
                                <td className="py-2 font-sans font-medium text-slate-300">
                                  {modelLabel}
                                </td>
                                <td className="py-2 text-slate-300">
                                  {mTokens ? mTokens.inputTokens.toLocaleString() : "-"}
                                </td>
                                <td className="py-2 text-slate-300">
                                  {mTokens ? mTokens.outputTokens.toLocaleString() : "-"}
                                </td>
                                <td className="py-2 text-emerald-400">
                                  {mTokens?.cachedInputTokens !== undefined
                                    ? mTokens.cachedInputTokens.toLocaleString()
                                    : "n/a"}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {mCost ? formatCost(mCost.low) : "-"}
                                </td>
                                <td className="py-2 text-indigo-300 font-semibold">
                                  {mCost ? formatCost(mCost.expected) : "-"}
                                </td>
                                <td className="py-2 text-slate-400">
                                  {mCost ? formatCost(mCost.high) : "-"}
                                </td>
                                <td className="py-2 text-right font-sans">
                                  <button
                                    onClick={() =>
                                      openExplain(
                                        mExplain,
                                        `Explain: ${phase.phaseName} (${modelLabel})`
                                      )
                                    }
                                    className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                                    aria-label={`Explain ${phase.phaseName} for ${mId}`}
                                  >
                                    Explain
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Editable Assumptions Row (FR-020) */}
                    <div className="pt-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 block mb-1.5">
                        Volume & Size Assumptions (Editable)
                      </span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            Calls
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={
                              overrides[phase.phaseId]?.callsExpected ??
                              params.calls?.expected ??
                              1
                            }
                            onChange={(e) =>
                              handleAssumptionChange(
                                phase.phaseId,
                                "callsExpected",
                                Number(e.target.value)
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                            aria-label={`${phase.phaseName} calls`}
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            Tokens / Call
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={
                              overrides[phase.phaseId]?.tokensPerCallExpected ??
                              params.tokensPerCall?.expected ??
                              1000
                            }
                            onChange={(e) =>
                              handleAssumptionChange(
                                phase.phaseId,
                                "tokensPerCallExpected",
                                Number(e.target.value)
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                            aria-label={`${phase.phaseName} tokens per call`}
                          />
                        </div>

                        <div>
                          <label className="text-[11px] text-slate-400 block mb-1">
                            Retries
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={
                              overrides[phase.phaseId]?.retriesExpected ??
                              params.retries?.expected ??
                              0
                            }
                            onChange={(e) =>
                              handleAssumptionChange(
                                phase.phaseId,
                                "retriesExpected",
                                Number(e.target.value)
                              )
                            }
                            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                            aria-label={`${phase.phaseName} retries`}
                          />
                        </div>

                        {activeTrack === "runtime" && (
                          <div>
                            <label className="text-[11px] text-slate-400 block mb-1">
                              Vol Multiplier
                            </label>
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              value={
                                overrides[phase.phaseId]?.volumeMultiplierExpected ??
                                params.volumeMultiplier?.expected ??
                                1.0
                              }
                              onChange={(e) =>
                                handleAssumptionChange(
                                  phase.phaseId,
                                  "volumeMultiplierExpected",
                                  Number(e.target.value)
                                )
                              }
                              className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-100 font-mono focus:border-indigo-500 focus:outline-none"
                              aria-label={`${phase.phaseName} volume multiplier`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {trackPhases.length === 0 && (
                <div className="py-8 text-center text-slate-500">
                  No confirmed phases found in the active track.
                </div>
              )}
            </div>
          </div>

          {/* Extended Model-Comparison Table (T135, FR-024, H2) */}
          <div className="glass-panel p-5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-y-2">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-indigo-400" />
                <span>Multi-Model Comparison & Active Pricing (FR-024, T135)</span>
              </h3>
              <span className="text-[11px] text-slate-500">
                Verified rate per 1M tokens
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="pb-2 font-medium">Model</th>
                    <th className="pb-2 font-medium">Input $/M</th>
                    <th className="pb-2 font-medium">Output $/M</th>
                    <th className="pb-2 font-medium">Cached Rate</th>
                    <th className="pb-2 font-medium">Pricing Date</th>
                    <th className="pb-2 font-medium">Build Total</th>
                    <th className="pb-2 font-medium">Runtime Total</th>
                    <th className="pb-2 font-medium">Build w/ selected techniques</th>
                    <th className="pb-2 font-medium">Runtime w/ selected techniques</th>
                    <th className="pb-2 font-medium text-right">Explain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {modelIds.map((mId) => {
                    const buildCost = estimation.build.totalByModel[mId] as CostRange | undefined;
                    const runtimeCost = estimation.runtime.totalByModel[mId] as CostRange | undefined;
                    const matchedPricing = pricing.find((p) => p.modelId === mId);
                    const matchedModel = models.find((m) => m.id === mId);

                    const inputPerMTok = matchedPricing?.inputPerMTok ?? 0;
                    const outputPerMTok = matchedPricing?.outputPerMTok ?? 0;
                    const cachedRate =
                      matchedPricing?.cachedInputPerMTok !== undefined
                        ? `$${matchedPricing.cachedInputPerMTok.toFixed(3)}/M`
                        : "no cached pricing data";

                    const verifiedDate =
                      buildCost?.pricingVerifiedAt ??
                      matchedPricing?.verifiedAt ??
                      estimation.generatedAt.slice(0, 10);

                    const rootExplainNode: ExplainNode = {
                      label: `Model Total: ${matchedModel?.label ?? mId}`,
                      formula: "buildExpected + runtimeExpected",
                      inputs: {
                        modelId: mId,
                        buildExpected: buildCost?.expected ?? 0,
                        runtimeExpected: runtimeCost?.expected ?? 0,
                      },
                      result: (buildCost?.expected ?? 0) + (runtimeCost?.expected ?? 0),
                    };

                    return (
                      <tr key={mId} className="hover:bg-slate-900/40">
                        <td className="py-2.5 font-sans font-medium text-slate-200">
                          {matchedModel?.label ?? mId}
                        </td>
                        <td className="py-2.5 text-slate-300">
                          {matchedPricing ? (
                            `$${inputPerMTok.toFixed(2)}`
                          ) : (
                            <span className="text-amber-400 text-[10px]">Unpriced</span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-300">
                          {matchedPricing ? (
                            `$${outputPerMTok.toFixed(2)}`
                          ) : (
                            <span className="text-amber-400 text-[10px]">Unpriced</span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-400">
                          {cachedRate === "no cached pricing data" ? (
                            <span className="text-slate-500 text-[10px] italic">
                              no cached pricing data
                            </span>
                          ) : (
                            <span className="text-emerald-400">{cachedRate}</span>
                          )}
                        </td>
                        <td className="py-2.5 text-slate-400 font-sans text-[11px]">
                          {verifiedDate ? verifiedDate.slice(0, 10) : "verified"}
                        </td>
                        <td className="py-2.5 text-slate-300">
                          {formatCost(buildCost?.expected ?? 0)}
                        </td>
                        <td className="py-2.5 text-indigo-300 font-semibold">
                          {formatCost(runtimeCost?.expected ?? 0)}
                        </td>
                        <td className="py-2.5">
                          <WithTechniquesCost
                            cost={buildCost?.expected ?? 0}
                            range={techniqueSavings?.build}
                            split={{ input: buildCost?.expectedInput, output: buildCost?.expectedOutput }}
                            channels={techniqueSavings?.channels?.build}
                            cacheSavings={cacheSavingsFor("build", mId, matchedPricing)}
                            label={`Build with selected techniques for ${mId}`}
                          />
                        </td>
                        <td className="py-2.5">
                          <WithTechniquesCost
                            cost={runtimeCost?.expected ?? 0}
                            range={techniqueSavings?.runtime}
                            split={{ input: runtimeCost?.expectedInput, output: runtimeCost?.expectedOutput }}
                            channels={techniqueSavings?.channels?.runtime}
                            cacheSavings={cacheSavingsFor("runtime", mId, matchedPricing)}
                            label={`Runtime with selected techniques for ${mId}`}
                          />
                        </td>
                        <td className="py-2.5 text-right font-sans">
                          <button
                            onClick={() =>
                              openExplain(rootExplainNode, `Model Total: ${mId}`)
                            }
                            className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium"
                            aria-label={`Explain total for ${mId}`}
                          >
                            Explain
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-panel p-12 rounded-xl border border-slate-800 text-center space-y-3">
          <Calculator className="w-8 h-8 text-slate-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-300">
            No Estimation Computed Yet
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Confirm pipeline phases in Enhance, then request a deterministic estimation.
          </p>
          <button
            onClick={handleRecompute}
            disabled={isLoading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            Compute Estimate
          </button>
        </div>
      )}

      {/* Explain Popover Modal */}
      <ExplainPopover
        isOpen={Boolean(selectedExplainNode)}
        node={selectedExplainNode}
        title={explainTitle}
        onClose={() => setSelectedExplainNode(null)}
      />
    </div>
  );
};

