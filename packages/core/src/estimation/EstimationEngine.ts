/**
 * Pure, deterministic cost estimation engine: profile + catalog -> per-phase tokens and cost
 * ranges.
 *
 * Exports: estimate, findActivePricing, pricingReferenceTime, EstimationEngine
 * Feature: token cost estimator
 */
import type {
  CostRange,
  EstimationResult,
  ExplainNode,
  Model,
  PhaseOverride,
  PhaseResult,
  Pricing,
  ProjectProfile,
  TokenBreakdown,
  TrackResult,
} from "../protocol/types.js";
import type { CatalogSnapshot } from "../catalog/schemas.js";
import { PhaseResolver, type ResolvedPhase } from "../phases/PhaseResolver.js";
import { ParamResolver, type ResolvedParams } from "./ParamResolver.js";
import { TokenizerLayer } from "./TokenizerLayer.js";

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * Deterministically finds the active pricing for a model at a reference timestamp.
 * (H12: Compares timestamps via Date.parse; does not fall back to future-dated prices;
 * uses catalog.publishedAt as referenceTime for determinism per Principle IV).
 */
/**
 * The single pricing reference time shared by the estimator, the prompt optimizer and Enhance:
 * the catalog's `publishedAt` (deterministic per catalog version), else `fallback`, else now.
 */
export function pricingReferenceTime(
  catalog: { publishedAt?: string } | null | undefined,
  fallback?: string
): string {
  return catalog?.publishedAt ?? fallback ?? new Date().toISOString();
}

export function findActivePricing(
  modelId: string,
  catalogPricing: Pricing[],
  referenceTime: string
): Pricing | null {
  const refMs = Date.parse(referenceTime);
  const matching = catalogPricing
    .filter((p) => p.modelId === modelId)
    .sort((a, b) => {
      // Sort effectiveFrom descending by epoch timestamp
      return Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom);
    });

  if (matching.length === 0) {
    return null;
  }

  // Find latest pricing where effectiveFrom <= referenceTime
  const active = matching.find((p) => Date.parse(p.effectiveFrom) <= refMs);
  // Do NOT fall back to a future-dated price if none is active at referenceTime
  return active ?? null;
}

interface PhaseComputation {
  phase: ResolvedPhase;
  params: ResolvedParams;
  tokensByModel: Record<string, TokenBreakdown>;
  costByModel: Record<string, CostRange>;
  explainTree: ExplainNode;
  explainTreesByModel: Record<string, ExplainNode>;
}

function computePhase(
  phase: ResolvedPhase,
  profile: ProjectProfile,
  models: Model[],
  catalogPricing: Pricing[],
  referenceTime: string,
  override?: PhaseOverride
): PhaseComputation {
  const params = ParamResolver.resolve(phase.defaultParams, override);

  const avgPrompt = Math.max(1, profile.llm?.avgPromptTokens ?? 1);
  const avgOutput = Math.max(1, profile.llm?.avgOutputTokens ?? 1);
  const ratioInput = avgPrompt / (avgPrompt + avgOutput);

  // Volume calculations
  const iterations = profile.buildAssumptions?.iterationsPerFeature ?? 1;
  const requestsPerDay = profile.scale?.requestsPerDay ?? 1;
  const monthlyDays = profile.scale?.monthlyDays ?? 22;
  const monthlyMultiplier = requestsPerDay * monthlyDays;

  const volumeExpected =
    phase.track === "build"
      ? params.calls.expected * (1 + params.retries.expected) * iterations
      : params.calls.expected *
        (1 + params.retries.expected) *
        params.volumeMultiplier.expected *
        monthlyMultiplier;

  const tokensByModel: Record<string, TokenBreakdown> = {};
  const costByModel: Record<string, CostRange> = {};
  const explainTreesByModel: Record<string, ExplainNode> = {};

  let primaryExplainTree: ExplainNode | null = null;

  for (const model of models) {
    const pricing = findActivePricing(model.id, catalogPricing, referenceTime);
    const inputPrice = pricing?.inputPerMTok ?? 0;
    const outputPrice = pricing?.outputPerMTok ?? 0;

    // H1 & H2: cacheablePrefix is numeric fraction (0 to 1); caching requires cachedInputPerMTok in pricing
    const cacheFraction =
      typeof phase.cacheablePrefix === "number" && phase.cacheablePrefix > 0
        ? Math.min(1, Math.max(0, phase.cacheablePrefix))
        : 0;

    const hasCachedPricing =
      pricing !== null &&
      pricing.cachedInputPerMTok !== undefined &&
      pricing.cachedInputPerMTok !== null;

    const canCache = Boolean(model.supportsCaching && cacheFraction > 0 && hasCachedPricing);
    const cachedPrice = canCache ? (pricing!.cachedInputPerMTok as number) : inputPrice;

    // Expected tokens per call breakdown
    const tpcExp = params.tokensPerCall.expected;
    const rawInputExp = Math.round(tpcExp * ratioInput);
    const rawOutputExp = tpcExp - rawInputExp;

    const cachedInputExp = canCache ? Math.round(rawInputExp * cacheFraction) : 0;
    const regularInputExp = rawInputExp - cachedInputExp;

    // Total phase tokens
    const totalInputTokens = Math.round(regularInputExp * volumeExpected);
    const totalCachedTokens =
      canCache && cachedInputExp > 0
        ? Math.round(cachedInputExp * volumeExpected)
        : undefined;
    const totalOutputTokens = Math.round(rawOutputExp * volumeExpected);
    const totalPhaseTokens =
      totalInputTokens + (totalCachedTokens ?? 0) + totalOutputTokens;

    const tokenizer = TokenizerLayer.getTokenizer(model);
    const countSample = tokenizer.count("test");
    const label = countSample.label;
    const approximationMargin = countSample.margin;

    tokensByModel[model.id] = {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cachedInputTokens: totalCachedTokens,
      totalTokens: totalPhaseTokens,
      label,
      approximationMargin,
    };

    // Calculate scenario costs
    const calcCost = (
      calls: number,
      retries: number,
      volMult: number,
      tpc: number
    ): { input: number; output: number } => {
      const vol =
        phase.track === "build"
          ? calls * (1 + retries) * iterations
          : calls * (1 + retries) * volMult * monthlyMultiplier;

      const rawIn = Math.round(tpc * ratioInput);
      const rawOut = tpc - rawIn;
      const cachedIn = canCache ? Math.round(rawIn * cacheFraction) : 0;
      const regIn = rawIn - cachedIn;

      const costIn = (regIn * vol * inputPrice) / 1_000_000;
      const costCached = canCache ? (cachedIn * vol * cachedPrice) / 1_000_000 : 0;
      const costOut = (rawOut * vol * outputPrice) / 1_000_000;

      return { input: costIn + costCached, output: costOut };
    };
    const total = (c: { input: number; output: number }) => round4(c.input + c.output);

    const lowCostSplit = calcCost(
      params.calls.low,
      params.retries.low,
      params.volumeMultiplier.low,
      params.tokensPerCall.low
    );
    const expCostSplit = calcCost(
      params.calls.expected,
      params.retries.expected,
      params.volumeMultiplier.expected,
      params.tokensPerCall.expected
    );
    const highCostSplit = calcCost(
      params.calls.high,
      params.retries.high,
      params.volumeMultiplier.high,
      params.tokensPerCall.high
    );

    const lowCost = total(lowCostSplit);
    const expCost = total(expCostSplit);
    const highCost = total(highCostSplit);
    costByModel[model.id] = {
      low: lowCost,
      expected: expCost,
      high: highCost,
      currency: "USD",
      pricingVerifiedAt: pricing?.verifiedAt,
      expectedInput: round4(expCostSplit.input),
      expectedOutput: round4(expCostSplit.output),
    };

    // H5: Build strictly additive Explain tree where children add up to total phase cost
    const regularCost = round4((totalInputTokens * inputPrice) / 1_000_000);
    const cachedCost = canCache && totalCachedTokens
      ? round4((totalCachedTokens * cachedPrice) / 1_000_000)
      : 0;
    const outputCost = round4((totalOutputTokens * outputPrice) / 1_000_000);

    const modelExplainTree: ExplainNode = {
      label: `Phase Cost: ${phase.name} (${model.label})`,
      formula: canCache && totalCachedTokens
        ? "regularInputCost + cachedInputCost + outputCost"
        : "regularInputCost + outputCost",
      inputs: {
        model: model.label,
        track: phase.track,
        callsExpected: params.calls.expected,
        tokensPerCallExpected: tpcExp,
        retriesExpected: params.retries.expected,
        volumeExpected,
        inputPerMTok: inputPrice,
        outputPerMTok: outputPrice,
        ...(canCache ? { cachedInputPerMTok: cachedPrice } : {}),
      },
      result: expCost,
      children: [
        {
          label: "Regular Input Cost",
          formula: "(regularInputTokens * inputPrice) / 1000000",
          inputs: {
            regularInputTokens: totalInputTokens,
            inputPrice,
          },
          result: regularCost,
        },
        ...(canCache && totalCachedTokens
          ? [
              {
                label: "Cached Input Cost",
                formula: "(cachedInputTokens * cachedPrice) / 1000000",
                inputs: {
                  cachedInputTokens: totalCachedTokens,
                  cachedPrice,
                },
                result: cachedCost,
              },
            ]
          : []),
        {
          label: "Output Cost",
          formula: "(outputTokens * outputPrice) / 1000000",
          inputs: {
            outputTokens: totalOutputTokens,
            outputPrice,
          },
          result: outputCost,
        },
      ],
    };

    explainTreesByModel[model.id] = modelExplainTree;
    if (!primaryExplainTree) {
      primaryExplainTree = modelExplainTree;
    }
  }

  const explainTree: ExplainNode = primaryExplainTree ?? {
    label: `Phase Cost: ${phase.name}`,
    formula: "0",
    inputs: {},
    result: 0,
  };

  return {
    phase,
    params,
    tokensByModel,
    costByModel,
    explainTree,
    explainTreesByModel,
  };
}

/**
 * Pure, deterministic estimation engine.
 * (FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, Principle IV, Principle XII)
 *
 * Guarantees:
 * - Deterministic: identical profile, catalog, and overrides produce byte-identical EstimationResult.
 * - Zero LLM or network calls.
 * - Validates all phases through PhaseResolver.
 * - Supports parameter overrides with low <= expected <= high validation.
 * - Computes BUILD and RUNTIME tracks with model cost ranges and explainability trees.
 */
export function estimate(
  profile: ProjectProfile,
  catalog: Pick<CatalogSnapshot, "phases" | "models" | "pricing" | "publishedAt"> & {
    version?: number;
  },
  overrides?: PhaseOverride[]
): EstimationResult {
  const resolvedPhases = PhaseResolver.resolve(profile.phases, catalog.phases);

  const referenceTime = pricingReferenceTime(
    catalog,
    profile.finalizedAt ?? profile.createdAt ?? "2026-10-09T00:00:00.000Z"
  );

  // H9 & H2: Active models with verified active pricing; exclude unpriced models
  const activeModels = (catalog.models as Model[]).filter((m: Model) => {
    if (m.status !== "active") return false;
    const pricing = findActivePricing(m.id, catalog.pricing, referenceTime);
    return pricing !== null;
  });

  const overrideMap = new Map<string, PhaseOverride>();
  if (Array.isArray(overrides)) {
    for (const ov of overrides) {
      overrideMap.set(ov.phaseId, ov);
    }
  }

  const buildPhasesResult: PhaseResult[] = [];
  const runtimePhasesResult: PhaseResult[] = [];

  for (const resolved of resolvedPhases) {
    const comp = computePhase(
      resolved,
      profile,
      activeModels,
      catalog.pricing,
      referenceTime,
      overrideMap.get(resolved.id)
    );

    const phaseResult: PhaseResult = {
      phaseId: resolved.id,
      phaseName: resolved.name,
      phaseTypeId: resolved.phaseTypeId ?? resolved.id,
      description: resolved.description,
      params: comp.params as unknown as Record<string, unknown>,
      tokensByModel: comp.tokensByModel,
      costByModel: comp.costByModel,
      explainTree: comp.explainTree,
      explainTreesByModel: comp.explainTreesByModel,
    };

    if (resolved.track === "build") {
      buildPhasesResult.push(phaseResult);
    } else {
      runtimePhasesResult.push(phaseResult);
    }
  }

  const computeTrackTotals = (phases: PhaseResult[]): Record<string, CostRange> => {
    const totals: Record<string, CostRange> = {};

    for (const model of activeModels) {
      let sumLow = 0;
      let sumExp = 0;
      let sumHigh = 0;
      let sumIn = 0;
      let sumOut = 0;
      let verifiedAt: string | undefined = undefined;

      for (const p of phases) {
        const cost = p.costByModel[model.id];
        if (cost) {
          sumLow += cost.low;
          sumExp += cost.expected;
          sumHigh += cost.high;
          sumIn += cost.expectedInput ?? 0;
          sumOut += cost.expectedOutput ?? 0;
          if (!verifiedAt && cost.pricingVerifiedAt) {
            verifiedAt = cost.pricingVerifiedAt;
          }
        }
      }

      totals[model.id] = {
        low: round4(sumLow),
        expected: round4(sumExp),
        high: round4(sumHigh),
        currency: "USD",
        pricingVerifiedAt: verifiedAt,
        expectedInput: round4(sumIn),
        expectedOutput: round4(sumOut),
      };
    }

    return totals;
  };

  const buildTotals = computeTrackTotals(buildPhasesResult);
  const runtimeTotals = computeTrackTotals(runtimePhasesResult);

  const buildTrack: TrackResult = {
    phases: buildPhasesResult,
    totalByModel: buildTotals,
  };

  const runtimeTrack: TrackResult = {
    phases: runtimePhasesResult,
    totalByModel: runtimeTotals,
  };

  // Primary model total for top-level totalExpectedCost
  const primaryModel = activeModels[0];
  const primaryBuild = primaryModel ? buildTotals[primaryModel.id]?.expected ?? 0 : 0;
  const primaryRuntime = primaryModel
    ? runtimeTotals[primaryModel.id]?.expected ?? 0
    : 0;
  const totalExpectedCost = round4(primaryBuild + primaryRuntime);

  // H4: Scale metrics computed inside engine with Explain nodes
  const requestsPerDay = profile.scale?.requestsPerDay ?? 1;
  const monthlyDays = profile.scale?.monthlyDays ?? 22;
  const usersPerDay = profile.scale?.usersPerDay;
  const monthlyRequests = requestsPerDay * monthlyDays;
  const costPerRequest =
    monthlyRequests > 0 ? round4(primaryRuntime / monthlyRequests) : 0;
  const costPerUserDay = usersPerDay
    ? round4(primaryRuntime / (usersPerDay * monthlyDays))
    : round4(primaryRuntime / monthlyDays);

  const scaleMetrics = {
    requestsPerDay,
    monthlyDays,
    usersPerDay,
    costPerRequest,
    costPerUserDay,
    monthlyCost: primaryRuntime,
    explainTrees: {
      perRequest: {
        label: "Cost Per Request",
        formula: "monthlyRuntimeCost / (requestsPerDay * monthlyDays)",
        inputs: {
          monthlyRuntimeCost: primaryRuntime,
          requestsPerDay,
          monthlyDays,
          monthlyRequests,
        },
        result: costPerRequest,
      },
      perUserDay: {
        label: "Cost Per User Day",
        formula: usersPerDay
          ? "monthlyRuntimeCost / (usersPerDay * monthlyDays)"
          : "monthlyRuntimeCost / monthlyDays",
        inputs: {
          monthlyRuntimeCost: primaryRuntime,
          ...(usersPerDay ? { usersPerDay } : {}),
          monthlyDays,
        },
        result: costPerUserDay,
      },
    },
  };

  // Deterministic generatedAt timestamp for byte-identical determinism
  const generatedAt =
    catalog.publishedAt ??
    profile.finalizedAt ??
    profile.createdAt ??
    "2026-10-09T00:00:00.000Z";

  const catalogVersion = (catalog as { version?: number }).version ?? 1;

  return {
    profileVersion: profile.profileVersion,
    catalogVersion,
    currency: "USD",
    build: buildTrack,
    runtime: runtimeTrack,
    scaleMetrics,
    totalExpectedCost,
    generatedAt,
  };
}

export const EstimationEngine = {
  estimate,
};
