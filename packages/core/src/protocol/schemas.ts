/**
 * Webview <-> extension-host message protocol and catalog entity schemas (Zod). FROZEN CONTRACT:
 * Phase 1 tracks implement against these and must not edit them; changes go through the integrator.
 *
 * Exports: catalog entities (ProviderSchema, ModelSchema, StrategySchema incl. technique fields,
 *   RouterPresetSchema, RouterConfigSchema, ...), feature payloads (PromptMessageSchema,
 *   ImplementEditProposalSchema, RouteDecisionSchema, FeatureErrorPayloadSchema), every message
 *   envelope, and the HostToWebviewMsgSchema / WebviewToHostMsgSchema unions.
 * Feature: shared protocol (all features)
 */
import { z } from "zod";
import { ProjectProfileSchema } from "../profile/schema.js";

// ─── Primitive / Helper Schemas ─────────────────────────────────────────────

export const ISO8601Schema = z.string().datetime();
export const ModelIdSchema = z.string().min(1).max(100);
export const ProviderIdSchema = z.string().min(1).max(100);
export const StrategyIdSchema = z.string().min(1).max(100);
export const PhaseIdSchema = z.string().min(1).max(100);

export const MaskedKeySchema = z
  .string()
  .regex(/^\.{3}[A-Za-z0-9_-]{0,4}$/, {
    message: "Masked key must begin with '...' followed by up to 4 characters",
  });

export const HttpsUrlSchema = z
  .string()
  .url()
  .refine((val) => /^https:\/\//i.test(val), {
    message: "Must be a secure HTTPS URL",
  });

export const OptionalHttpsUrlSchema = z
  .string()
  .refine((val) => val === "" || /^https:\/\//i.test(val), {
    message: "Must be an HTTPS URL or empty string",
  });

export const WorkspaceRelativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.startsWith("\\") &&
      !/^[a-zA-Z]:/.test(p) &&
      !p.startsWith("~") &&
      !p.includes(".."),
    {
      message:
        "Path must be workspace-relative and cannot contain drive letters, ~, or '..' traversal",
    }
  );

// ─── Domain Entity Schemas ──────────────────────────────────────────────────

export const ConfirmedPhaseSchema = z
  .object({
    id: z.string().min(1).max(100),
    phaseTypeId: z.string().min(1).max(100),
    track: z.enum(["build", "runtime"]),
    name: z.string().min(1).max(200),
    source: z.enum(["llm", "user", "taxonomy-suggestion"]),
    confirmed: z.boolean(),
  })
  .strict();

export const TechStackEntrySchema = z
  .object({
    language: z.string().min(1).max(100),
    framework: z.string().max(100).optional(),
    version: z.string().max(50).optional(),
  })
  .strict();

export const ComponentEntrySchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000),
    llmRole: z.string().max(200).optional(),
  })
  .strict();

// ProjectProfileSchema is canonically defined in and exported from ../profile/schema.js (T057)

export const ProviderSchema = z
  .object({
    id: ProviderIdSchema,
    label: z.string().min(1).max(100),
    adapterType: z.enum([
      "anthropic",
      "openai",
      "google",
      "mistral",
      "openai-compatible",
      "host-lm",
    ]),
    baseUrl: OptionalHttpsUrlSchema,
    hostLm: z
      .object({
        vendor: z.string().min(1).max(100),
        family: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
    listModelsEndpoint: z.string().max(200).optional(),
    keyFormatHint: z.string().max(100),
    enabled: z.boolean(),
  })
  .strict();

export const ModelSchema = z
  .object({
    id: ModelIdSchema,
    providerId: ProviderIdSchema,
    label: z.string().min(1).max(100),
    contextWindow: z.number().int().positive(),
    maxOutput: z.number().int().positive(),
    tier: z.enum(["economy", "standard", "advanced", "frontier"]),
    supportsCaching: z.boolean(),
    supportsBatch: z.boolean(),
    supportsStructuredOutput: z.boolean(),
    tokenizer: z
      .object({
        kind: z.enum([
          "tiktoken",
          "anthropic-endpoint",
          "google-endpoint",
          "char-approx",
        ]),
        name: z.string().max(100).optional(),
      })
      .strict(),
    status: z.enum(["active", "deprecated"]),
    addedAt: z.string(),
  })
  .strict();

export const PricingSchema = z
  .object({
    modelId: ModelIdSchema,
    currency: z.literal("USD"),
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    cachedInputPerMTok: z.number().nonnegative().optional(),
    cacheWriteMultiplier: z.number().nonnegative().optional(),
    batchDiscount: z.number().min(0).max(1).optional(),
    effectiveFrom: z.string(),
    sourceUrl: HttpsUrlSchema,
    verifiedAt: z.string(),
  })
  .strict();

export const PhaseSchema = z
  .object({
    id: PhaseIdSchema,
    name: z.string().min(1).max(200),
    track: z.enum(["build", "runtime"]),
    sortOrder: z.number().int().nonnegative(),
    description: z.string().max(1000),
    shortDescription: z.string().max(300).optional(),
    archetypes: z.array(z.string().max(100)),
    defaultParams: z
      .object({
        callsLow: z.number().nonnegative(),
        callsExpected: z.number().nonnegative(),
        callsHigh: z.number().nonnegative(),
        tokensPerCallLow: z.number().nonnegative(),
        tokensPerCallExpected: z.number().nonnegative(),
        tokensPerCallHigh: z.number().nonnegative(),
        retriesLow: z.number().nonnegative(),
        retriesExpected: z.number().nonnegative(),
        retriesHigh: z.number().nonnegative(),
        volumeMultiplierLow: z.number().nonnegative().optional(),
        volumeMultiplierExpected: z.number().nonnegative().optional(),
        volumeMultiplierHigh: z.number().nonnegative().optional(),
      })
      .strict(),
    paramHints: z.record(z.string()).optional(),
    cacheablePrefix: z
      .union([
        z.number().min(0).max(1),
        z.boolean().transform((b) => (b ? 0.5 : 0)),
      ])
      .optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const SavingsRangeSchema = z
  .object({
    minPercent: z.number().min(0).max(100),
    maxPercent: z.number().min(0).max(100),
    basis: z.string().min(1).max(500),
    unit: z.literal("percent").optional(),
    appliesTo: z.enum(["input", "output", "total"]).optional(),
    sourceUrl: HttpsUrlSchema.optional(),
  })
  .strict();

/**
 * How a technique runs inside the prompt optimizer (TS core and Python `ai_optimizer`).
 * `rule` techniques are deterministic and must give byte-identical results in TS and Python
 * (golden fixtures in packages/fixtures/optimizer). `llm` techniques call the user's model with
 * the catalog prompt template `promptTemplateId`. Techniques run in ascending `order`.
 * `params` carries rule data (e.g. filler phrase list, output cap) so both runtimes share it.
 */
export const TechniqueOptimizerSchema = z
  .object({
    mode: z.enum(["rule", "llm"]),
    ruleId: z.string().min(1).max(100).optional(),
    promptTemplateId: z.string().min(1).max(100).optional(),
    order: z.number().int().nonnegative(),
    affects: z.enum(["input", "output", "both"]),
    params: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((o) => (o.mode === "rule" ? !!o.ruleId : !!o.promptTemplateId), {
    message: "rule techniques need ruleId; llm techniques need promptTemplateId",
  });

/** How the Implement flow wires a technique into user Python code (symbol in `ai_optimizer`). */
export const TechniqueImplementationSchema = z
  .object({
    language: z.literal("python"),
    symbol: z.string().min(1).max(100),
    integrations: z.array(z.enum(["agent-middleware", "invoke-wrap"])).min(1),
  })
  .strict();

export const StrategySchema = z
  .object({
    id: StrategyIdSchema,
    name: z.string().min(1).max(200),
    group: z.string().min(1).max(100),
    targets: z.array(z.enum(["build", "runtime"])),
    summary: z.string().max(1000),
    applicability: z.record(z.unknown()).optional(),
    reasonTemplate: z.string().max(500).optional(),
    preconditions: z.array(z.string().max(500)).optional(),
    savings: SavingsRangeSchema,
    conflicts: z.array(StrategyIdSchema).optional(),
    requires: z.array(StrategyIdSchema).optional(),
    preview: z.record(z.unknown()).optional(),
    optimizer: TechniqueOptimizerSchema.optional(),
    implementation: TechniqueImplementationSchema.optional(),
    reviewStatus: z.enum(["draft", "pending", "approved"]),
    reviewedBy: z.string().max(100).optional(),
    reviewedAt: z.string().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (s) => {
      if (s.reviewStatus === "approved") {
        return (
          typeof s.reviewedBy === "string" &&
          s.reviewedBy.trim().length > 0 &&
          typeof s.reviewedAt === "string" &&
          s.reviewedAt.trim().length > 0
        );
      }
      return true;
    },
    {
      message:
        "Principle VIII: Approved strategies must record a named human reviewer in 'reviewedBy' and timestamp in 'reviewedAt'",
      path: ["reviewedBy"],
    }
  );

export const PlatformSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(100),
    detect: z
      .object({
        appNames: z.array(z.string()).optional(),
        uriSchemes: z.array(z.string()).optional(),
        markerFiles: z.array(z.string()).optional(),
      })
      .strict(),
    artifactTargets: z.array(
      z
        .object({
          kind: z.string(),
          layout: z.enum(["file", "directory"]).optional(),
          defaultEnabled: z.boolean().optional(),
          pathTemplate: WorkspaceRelativePathSchema,
          format: z.string(),
          frontmatterTemplate: z.string().optional(),
        })
        .strict()
    ),
    docsUrl: HttpsUrlSchema.optional(),
    verifiedAt: z.string().optional(),
    isDefault: z.boolean().optional(),
    agentInvocation: z
      .object({
        mechanisms: z.array(z.enum(["lm-edit", "chat-handoff", "clipboard"])),
      })
      .strict()
      .optional(),
  })
  .strict();

export const PromptTemplateSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive(),
    purpose: z.enum([
      "enhance",
      "profile-extract",
      "apply-edit",
      "preview",
      "handoff",
      "compress",
    ]),
    template: z.string(),
    outputSchemaRef: z.string().nullable().optional(),
    active: z.boolean(),
  })
  .strict();

// ─── Model router (rule-based tiers) ────────────────────────────────────────

export const RouterTierSchema = z.enum(["economy", "standard", "advanced"]);

export const RouterCandidateSchema = z
  .object({
    modelId: ModelIdSchema,
    providerId: ProviderIdSchema,
    contextWindow: z.number().int().positive().optional(),
  })
  .strict();

/**
 * Deterministic routing rules, evaluated identically by TS `RouterRules` and Python `router.route`
 * (golden fixtures in packages/fixtures/router):
 *   1. advanced keywords or high lexical complexity -> "advanced"
 *   2. else if short, or long/repetitive with enough economy context -> "economy"
 *   3. else -> `defaultTier`
 *   4. needsTools raises the result to at least `needsToolsMinTier`
 * The routed model is the first candidate of the chosen tier; an empty tier falls back upward
 * (economy -> standard -> advanced), then downward.
 */
export const RouterRulesSchema = z
  .object({
    maxCharsForEconomy: z.number().int().nonnegative(),
    advancedKeywords: z.array(z.string().min(1).max(100)),
    needsToolsMinTier: RouterTierSchema,
    defaultTier: RouterTierSchema,
  })
  .strict();

export const RouterConfigSchema = z
  .object({
    presetId: z.string().min(1).max(100).optional(),
    tiers: z
      .object({
        economy: z.array(RouterCandidateSchema),
        standard: z.array(RouterCandidateSchema),
        advanced: z.array(RouterCandidateSchema),
      })
      .strict(),
    rules: RouterRulesSchema,
  })
  .strict();

/** Catalog collection `router_presets`. */
export const RouterPresetSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    isDefault: z.boolean(),
    version: z.number().int().positive(),
    tiers: RouterConfigSchema.shape.tiers,
    rules: RouterRulesSchema,
  })
  .strict();

export const RouteDecisionSchema = z
  .object({
    model: ModelIdSchema,
    provider: ProviderIdSchema,
    tier: RouterTierSchema,
    reason: z.string().max(500),
  })
  .strict();

// ─── Prompt optimizer ───────────────────────────────────────────────────────

export const PromptMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().max(200000),
  })
  .strict();

/** Request parameters a technique may set (e.g. `max-output-cap`). Snake case mirrors Python. */
export const PromptParamsSchema = z
  .object({
    max_tokens: z.number().int().positive().optional(),
  })
  .strict();

export const PromptOptStepSchema = z
  .object({
    techniqueId: StrategyIdSchema,
    mode: z.enum(["rule", "llm"]),
    applied: z.boolean(),
    messagesAfter: z.array(PromptMessageSchema),
    paramsAfter: PromptParamsSchema,
    inputTokensBefore: z.number().int().nonnegative(),
    inputTokensAfter: z.number().int().nonnegative(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const PromptOptCostSchema = z
  .object({
    providerId: ProviderIdSchema,
    modelId: ModelIdSchema,
    inputPerMTok: z.number().nonnegative(),
    outputPerMTok: z.number().nonnegative(),
    /** Assumed output tokens per call before/after (output-affecting techniques change "after"). */
    outputTokensBefore: z.number().int().nonnegative(),
    outputTokensAfter: z.number().int().nonnegative(),
    usdPer1kCallsBefore: z.number().nonnegative(),
    usdPer1kCallsAfter: z.number().nonnegative(),
  })
  .strict();

// ─── Implement (Python call-site edits) ─────────────────────────────────────

/** 0-based, end-exclusive range in a workspace file. */
export const SourceRangeSchema = z
  .object({
    startLine: z.number().int().nonnegative(),
    startCol: z.number().int().nonnegative(),
    endLine: z.number().int().nonnegative(),
    endCol: z.number().int().nonnegative(),
  })
  .strict();

/**
 * One per-block edit produced by core `pyEditPlanner`. `modified` replaces exactly `original`
 * at `range`; `importsToAdd` are full import lines added once at the top of the file if missing.
 * `fileHash` is the host-computed sha256 of the file at scan time (stale check before apply).
 */
export const ImplementEditProposalSchema = z
  .object({
    id: z.string().min(1).max(200),
    file: WorkspaceRelativePathSchema,
    range: SourceRangeSchema,
    original: z.string(),
    modified: z.string(),
    importsToAdd: z.array(z.string().max(500)),
    feature: z.enum(["optimizer", "router"]),
    pattern: z.enum(["agent", "invoke", "construction"]),
    fileHash: z.string().length(64),
    description: z.string().max(500).optional(),
  })
  .strict();

// ─── Feature errors ─────────────────────────────────────────────────────────

/** Shared payload for every `<feature>/error` message (Phase 0 stubs reply "not-implemented"). */
export const FeatureErrorPayloadSchema = z
  .object({
    operationId: z.string().optional(),
    error: z.enum([
      "not-implemented",
      "invalid-request",
      "no-model",
      "no-key",
      "llm-failed",
      "io-failed",
      "stale",
      "internal",
    ]),
    message: z.string().max(500),
  })
  .strict();

export interface ExplainNodeData {
  label: string;
  formula: string;
  inputs: Record<string, number | string>;
  result: number;
  children?: ExplainNodeData[];
}

export const ExplainNodeSchema: z.ZodType<ExplainNodeData> = z.lazy(() =>
  z
    .object({
      label: z.string(),
      formula: z.string(),
      inputs: z.record(z.union([z.number(), z.string()])),
      result: z.number(),
      children: z.array(ExplainNodeSchema).optional(),
    })
    .strict()
);

export const TokenBreakdownSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative(),
    label: z.enum(["exact", "approximate"]),
    approximationMargin: z.string().optional(),
  })
  .strict();

export const CostRangeSchema = z
  .object({
    low: z.number().nonnegative(),
    expected: z.number().nonnegative(),
    high: z.number().nonnegative(),
    currency: z.literal("USD"),
    pricingVerifiedAt: z.string().optional(),
    /** Expected-scenario cost split: input (incl. cached) and output, summing to `expected`. */
    expectedInput: z.number().nonnegative().optional(),
    expectedOutput: z.number().nonnegative().optional(),
  })
  .strict();

export const PhaseResultSchema = z
  .object({
    phaseId: z.string(),
    phaseName: z.string(),
    phaseTypeId: z.string().optional(),
    description: z.string().optional(),
    params: z.record(z.unknown()),
    tokensByModel: z.record(TokenBreakdownSchema),
    costByModel: z.record(CostRangeSchema),
    explainTree: ExplainNodeSchema,
    explainTreesByModel: z.record(ExplainNodeSchema).optional(),
  })
  .strict();

export const TrackResultSchema = z
  .object({
    phases: z.array(PhaseResultSchema),
    totalByModel: z.record(CostRangeSchema),
  })
  .strict();

export const ScaleMetricsSchema = z
  .object({
    requestsPerDay: z.number().nonnegative(),
    monthlyDays: z.number().nonnegative(),
    usersPerDay: z.number().nonnegative().optional(),
    costPerRequest: z.number().nonnegative(),
    costPerUserDay: z.number().nonnegative(),
    monthlyCost: z.number().nonnegative(),
    explainTrees: z.record(ExplainNodeSchema).optional(),
  })
  .strict();

export const EstimationResultSchema = z
  .object({
    profileVersion: z.number().int().positive(),
    catalogVersion: z.number().int().positive().optional(),
    currency: z.literal("USD"),
    build: TrackResultSchema,
    runtime: TrackResultSchema,
    scaleMetrics: ScaleMetricsSchema.optional(),
    totalExpectedCost: z.number().nonnegative(),
    generatedAt: z.string(),
  })
  .strict();

export const EditProposalSchema = z
  .object({
    strategyId: z.string(),
    file: WorkspaceRelativePathSchema,
    anchorHash: z.string().length(64),
    originalSnippet: z.string(),
    replacement: z.string(),
    rationale: z.string(),
    syntaxValid: z.boolean(),
    anchorMatched: z.boolean(),
  })
  .strict();

export const PhaseOverrideSchema = z
  .object({
    phaseId: PhaseIdSchema,
    callsExpected: z.number().nonnegative().optional(),
    tokensPerCallExpected: z.number().nonnegative().optional(),
    retriesExpected: z.number().nonnegative().optional(),
    volumeMultiplierExpected: z.number().nonnegative().optional(),
    callsLow: z.number().nonnegative().optional(),
    callsHigh: z.number().nonnegative().optional(),
    tokensPerCallLow: z.number().nonnegative().optional(),
    tokensPerCallHigh: z.number().nonnegative().optional(),
  })
  .strict();

// ─── Envelope Generator ─────────────────────────────────────────────────────

function createEnvelope<T extends string, P extends z.ZodTypeAny>(
  type: T,
  payloadSchema: P
) {
  return z
    .object({
      version: z.literal(1).default(1),
      type: z.literal(type),
      payload: payloadSchema,
    })
    .strict();
}

// ─── Host -> Webview Message Schemas ────────────────────────────────────────

export const CatalogUpdatedMsgSchema = createEnvelope(
  "catalog/updated",
  z
    .object({
      version: z.number().int().positive(),
      schemaVersion: z.string(),
      providers: z.array(ProviderSchema),
      models: z.array(ModelSchema),
      pricing: z.array(PricingSchema),
      phases: z.array(PhaseSchema),
      strategies: z.array(StrategySchema),
      platforms: z.array(PlatformSchema),
      promptTemplates: z.array(PromptTemplateSchema),
      routerPresets: z.array(RouterPresetSchema).optional(),
      isOffline: z.boolean(),
      publishedAt: z.string().optional(),
    })
    .strict()
);

export const KeySavedMsgSchema = createEnvelope(
  "auth/keySaved",
  z
    .object({
      providerId: ProviderIdSchema,
      keySlot: z.number().int().min(0).max(10),
      maskedKey: MaskedKeySchema,
    })
    .strict()
);

export const KeyErrorMsgSchema = createEnvelope(
  "auth/keyError",
  z
    .object({
      providerId: ProviderIdSchema,
      keySlot: z.number().int().min(0).max(10),
      error: z.enum(["invalid", "unreachable", "rate-limited"]),
      message: z.string().max(500),
    })
    .strict()
);

export const KeyRemovedMsgSchema = createEnvelope(
  "auth/keyRemoved",
  z
    .object({
      providerId: ProviderIdSchema,
      keySlot: z.number().int().min(0).max(10),
    })
    .strict()
);

export const AuthStateMsgSchema = createEnvelope(
  "auth/state",
  z
    .object({
      platform: z.string(),
      configuredKeys: z.array(
        z
          .object({
            providerId: ProviderIdSchema,
            keySlot: z.number().int().min(0).max(10),
            maskedKey: MaskedKeySchema,
            enabledModels: z.array(ModelIdSchema),
          })
          .strict()
      ),
      copilotAvailable: z.boolean(),
      copilotOnly: z.boolean().default(false),
      platformOverridden: z.boolean(),
      enhanceModel: z
        .object({
          providerId: ProviderIdSchema,
          modelId: ModelIdSchema,
          keySlot: z.number().int().min(0).max(10).optional(),
        })
        .strict()
        .optional(),
    })
    .strict()
);

export const EnhanceStreamMsgSchema = createEnvelope(
  "enhance/stream",
  z
    .object({
      operationId: z.string().optional(),
      delta: z.string(),
    })
    .strict()
);

export const EnhanceResultMsgSchema = createEnvelope(
  "enhance/result",
  z
    .object({
      operationId: z.string().optional(),
      narrative: z.string(),
      profile: ProjectProfileSchema,
      profileVersion: z.number().int().positive(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
      taxonomyBudgetLevel: z.enum(["full", "short", "compact"]).optional(),
    })
    .strict()
);

export const EnhanceErrorMsgSchema = createEnvelope(
  "enhance/error",
  z
    .object({
      operationId: z.string().optional(),
      error: z.enum(["llm-failed", "repair-failed", "schema-invalid"]),
      message: z.string().max(500),
    })
    .strict()
);

export const ProfileFinalizedMsgSchema = createEnvelope(
  "enhance/profileFinalized",
  z
    .object({
      profileVersion: z.number().int().positive(),
    })
    .strict()
);

export const PhasesUpdatedMsgSchema = createEnvelope(
  "enhance/phasesUpdated",
  z
    .object({
      profileVersion: z.number().int().positive(),
      phases: z.array(ConfirmedPhaseSchema),
      problems: z.array(
        z
          .object({
            phaseId: z.string(),
            problem: z.enum(["unknown-type", "track-mismatch", "unconfirmed"]),
          })
          .strict()
      ),
    })
    .strict()
);

export const ProfileHistorySummarySchema = z
  .object({
    version: z.number().int().positive(),
    createdAt: z.string(),
    finalizedAt: z.string().optional(),
    phaseCount: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().optional(),
  })
  .strict();

export const EnhanceGetHistoryMsgSchema = createEnvelope(
  "enhance/getHistory",
  z.object({}).strict()
);

export const EnhanceGetVersionMsgSchema = createEnvelope(
  "enhance/getVersion",
  z
    .object({
      version: z.number().int().positive(),
    })
    .strict()
);

export const EnhanceClearHistoryMsgSchema = createEnvelope(
  "enhance/clearHistory",
  z.object({}).strict()
);

export const EnhanceHistoryLoadedMsgSchema = createEnvelope(
  "enhance/historyLoaded",
  z
    .object({
      summaries: z.array(ProfileHistorySummarySchema),
    })
    .strict()
);

export const EnhanceVersionLoadedMsgSchema = createEnvelope(
  "enhance/versionLoaded",
  z
    .object({
      entry: z
        .object({
          version: z.number().int().positive(),
          narrative: z.string(),
          profile: ProjectProfileSchema,
          createdAt: z.string(),
          finalizedAt: z.string().optional(),
          costUsd: z.number().nonnegative().optional(),
          tokens: z
            .object({
              inputTokens: z.number().int().nonnegative(),
              outputTokens: z.number().int().nonnegative(),
            })
            .optional(),
        })
        .strict(),
    })
    .strict()
);

export const EnhanceHistoryClearedMsgSchema = createEnvelope(
  "enhance/historyCleared",
  z.object({}).strict()
);

export const EstimateResultMsgSchema = createEnvelope(
  "estimate/result",
  z
    .object({
      operationId: z.string().optional(),
      result: EstimationResultSchema,
    })
    .strict()
);

export const EstimateErrorMsgSchema = createEnvelope(
  "estimate/error",
  z
    .object({
      operationId: z.string().optional(),
      error: z.string(),
      message: z.string(),
    })
    .strict()
);

export const StrategySelectionMsgSchema = createEnvelope(
  "strategy/selection",
  z
    .object({
      selected: z.array(
        z
          .object({
            strategyId: StrategyIdSchema,
            reason: z.string(),
          })
          .strict()
      ),
      conflicts: z.array(
        z
          .object({
            a: StrategyIdSchema,
            b: StrategyIdSchema,
            explanation: z.string(),
          })
          .strict()
      ),
      notPreselected: z.array(
        z
          .object({
            strategyId: StrategyIdSchema,
            reason: z.string(),
          })
          .strict()
      ),
    })
    .strict()
);

export const SavingsUpdateMsgSchema = createEnvelope(
  "strategy/savingsUpdate",
  z
    .object({
      build: SavingsRangeSchema,
      runtime: SavingsRangeSchema,
      /** Per-channel savings: input techniques apply to input cost, output techniques to output cost. */
      channels: z
        .object({
          build: z.object({ input: SavingsRangeSchema, output: SavingsRangeSchema }).strict(),
          runtime: z.object({ input: SavingsRangeSchema, output: SavingsRangeSchema }).strict(),
        })
        .strict()
        .optional(),
      conflicts: z.array(
        z
          .object({
            a: StrategyIdSchema,
            b: StrategyIdSchema,
            explanation: z.string(),
          })
          .strict()
      ),
    })
    .strict()
);

export const GenerateProgressMsgSchema = createEnvelope(
  "optimize/generateProgress",
  z
    .object({
      operationId: z.string().optional(),
      step: z.string(),
      filesWritten: z.array(z.string()),
      conflicts: z.array(
        z
          .object({
            path: z.string(),
            diffToken: z.string(),
          })
          .strict()
      ),
    })
    .strict()
);

export const GenerateCompleteMsgSchema = createEnvelope(
  "optimize/generateComplete",
  z
    .object({
      operationId: z.string().optional(),
      filesWritten: z.array(z.string()),
    })
    .strict()
);

export const ImplementPlanMsgSchema = createEnvelope(
  "optimize/implement/plan",
  z
    .object({
      operationId: z.string().optional(),
      mechanism: z.enum(["lm-edit", "chat-handoff", "clipboard"]),
      reason: z.string(),
    })
    .strict()
);

export const ApplyProgressMsgSchema = createEnvelope(
  "optimize/apply/progress",
  z
    .object({
      operationId: z.string().optional(),
      stage: z.enum(["scanning", "planning", "validating", "ready"]),
      filesScanned: z.number().int().nonnegative().optional(),
      proposalsReady: z.number().int().nonnegative().optional(),
      message: z.string().optional(),
    })
    .strict()
);

export const ApplyProposalsMsgSchema = createEnvelope(
  "optimize/apply/proposals",
  z
    .object({
      operationId: z.string().optional(),
      proposals: z.array(EditProposalSchema),
      staleCount: z.number().int().nonnegative(),
    })
    .strict()
);

export const ApplyCompleteMsgSchema = createEnvelope(
  "optimize/apply/complete",
  z
    .object({
      operationId: z.string().optional(),
      appliedCount: z.number().int().nonnegative(),
      checkpointId: z.string(),
    })
    .strict()
);

export const HandoffPreviewMsgSchema = createEnvelope(
  "optimize/handoff/preview",
  z
    .object({
      operationId: z.string().optional(),
      promptText: z.string(),
      redactionCount: z.number().int().nonnegative(),
      agentWritesOutsideReview: z.literal(true),
      hostCommandAvailable: z.boolean(),
    })
    .strict()
);

export const HandoffResultMsgSchema = createEnvelope(
  "optimize/handoff/result",
  z
    .object({
      operationId: z.string().optional(),
      status: z.enum(["opened", "copied", "cancelled", "failed"]),
      checkpointId: z.string().optional(),
      message: z.string().optional(),
    })
    .strict()
);

export const HostCancelledMsgSchema = createEnvelope(
  "operation/cancelled",
  z
    .object({
      operationId: z.string().min(1),
      reason: z.string().optional(),
    })
    .strict()
);

// ─── v2 feature messages: Host -> Webview ───────────────────────────────────

export const EnhancePrefillResultMsgSchema = createEnvelope(
  "enhance/prefillResult",
  z
    .object({
      operationId: z.string().optional(),
      /** Draft project description built from the workspace scan. */
      description: z.string().max(20000),
      /** Human-readable facts that drove the draft (e.g. "langchain in requirements.txt"). */
      signals: z.array(z.string().max(300)),
    })
    .strict()
);

export const EnhancePrefillErrorMsgSchema = createEnvelope(
  "enhance/prefillError",
  FeatureErrorPayloadSchema
);

export const StrategyErrorMsgSchema = createEnvelope("strategy/error", FeatureErrorPayloadSchema);

export const PromptOptResultMsgSchema = createEnvelope(
  "promptopt/result",
  z
    .object({
      operationId: z.string().optional(),
      original: z
        .object({
          messages: z.array(PromptMessageSchema),
          params: PromptParamsSchema,
          inputTokens: z.number().int().nonnegative(),
        })
        .strict(),
      optimized: z
        .object({
          messages: z.array(PromptMessageSchema),
          params: PromptParamsSchema,
          inputTokens: z.number().int().nonnegative(),
        })
        .strict(),
      steps: z.array(PromptOptStepSchema),
      tokenLabel: z.enum(["exact", "approximate"]),
      cost: PromptOptCostSchema.optional(),
      llmUsage: z
        .object({
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          costUsd: z.number().nonnegative(),
        })
        .strict()
        .optional(),
    })
    .strict()
);

export const PromptOptErrorMsgSchema = createEnvelope("promptopt/error", FeatureErrorPayloadSchema);

export const ImplementExportedMsgSchema = createEnvelope(
  "implement/exported",
  z
    .object({
      operationId: z.string().optional(),
      targetDir: WorkspaceRelativePathSchema,
      filesWritten: z.array(WorkspaceRelativePathSchema),
    })
    .strict()
);

export const ImplementProposalsMsgSchema = createEnvelope(
  "implement/proposals",
  z
    .object({
      operationId: z.string().optional(),
      filesScanned: z.number().int().nonnegative(),
      proposals: z.array(ImplementEditProposalSchema),
    })
    .strict()
);

export const ImplementBlockResultMsgSchema = createEnvelope(
  "implement/blockResult",
  z
    .object({
      proposalId: z.string().min(1).max(200),
      status: z.enum(["applied", "skipped", "stale", "failed", "diff-opened"]),
      message: z.string().max(500).optional(),
      /** After an apply: the new ranges of the same file's other pending blocks (rebased). */
      rebased: z
        .array(z.object({ proposalId: z.string().min(1).max(200), range: SourceRangeSchema }).strict())
        .max(1000)
        .optional(),
    })
    .strict()
);

export const ImplementErrorMsgSchema = createEnvelope("implement/error", FeatureErrorPayloadSchema);

export const RouterPreviewResultMsgSchema = createEnvelope(
  "router/previewResult",
  z
    .object({
      operationId: z.string().optional(),
      decision: RouteDecisionSchema,
    })
    .strict()
);

export const RouterConfigMsgSchema = createEnvelope(
  "router/config",
  z
    .object({
      /** Saved workspace config, or the default catalog preset when nothing is saved. */
      config: RouterConfigSchema,
      source: z.enum(["saved", "catalog-default"]),
    })
    .strict()
);

export const RouterConfigSavedMsgSchema = createEnvelope(
  "router/configSaved",
  z
    .object({
      config: RouterConfigSchema,
      savedAt: z.string(),
    })
    .strict()
);

export const RouterErrorMsgSchema = createEnvelope("router/error", FeatureErrorPayloadSchema);

export const HostToWebviewMsgSchema = z.discriminatedUnion("type", [
  EnhancePrefillResultMsgSchema,
  EnhancePrefillErrorMsgSchema,
  StrategyErrorMsgSchema,
  PromptOptResultMsgSchema,
  PromptOptErrorMsgSchema,
  ImplementExportedMsgSchema,
  ImplementProposalsMsgSchema,
  ImplementBlockResultMsgSchema,
  ImplementErrorMsgSchema,
  RouterPreviewResultMsgSchema,
  RouterConfigMsgSchema,
  RouterConfigSavedMsgSchema,
  RouterErrorMsgSchema,
  CatalogUpdatedMsgSchema,
  KeySavedMsgSchema,
  KeyErrorMsgSchema,
  KeyRemovedMsgSchema,
  AuthStateMsgSchema,
  EnhanceStreamMsgSchema,
  EnhanceResultMsgSchema,
  EnhanceErrorMsgSchema,
  ProfileFinalizedMsgSchema,
  PhasesUpdatedMsgSchema,
  EnhanceHistoryLoadedMsgSchema,
  EnhanceVersionLoadedMsgSchema,
  EnhanceHistoryClearedMsgSchema,
  EstimateResultMsgSchema,
  EstimateErrorMsgSchema,
  StrategySelectionMsgSchema,
  SavingsUpdateMsgSchema,
  GenerateProgressMsgSchema,
  GenerateCompleteMsgSchema,
  ImplementPlanMsgSchema,
  ApplyProgressMsgSchema,
  ApplyProposalsMsgSchema,
  ApplyCompleteMsgSchema,
  HandoffPreviewMsgSchema,
  HandoffResultMsgSchema,
  HostCancelledMsgSchema,
]);

// ─── Webview -> Host Message Schemas ────────────────────────────────────────

export const WebviewReadyMsgSchema = createEnvelope(
  "webview/ready",
  z.object({}).strict()
);

export const SaveKeyMsgSchema = createEnvelope(
  "auth/saveKey",
  z
    .object({
      providerId: ProviderIdSchema,
      keySlot: z.number().int().min(0).max(10),
      key: z.string().min(1).max(500),
    })
    .strict()
);

export const RemoveKeyMsgSchema = createEnvelope(
  "auth/removeKey",
  z
    .object({
      providerId: ProviderIdSchema,
      keySlot: z.number().int().min(0).max(10),
    })
    .strict()
);

export const SetEnabledModelsMsgSchema = createEnvelope(
  "auth/setEnabledModels",
  z
    .object({
      providerId: ProviderIdSchema,
      enabledModels: z.array(ModelIdSchema),
    })
    .strict()
);

export const SetPlatformMsgSchema = createEnvelope(
  "auth/setPlatform",
  z
    .object({
      platformId: z.string().min(1).max(100),
    })
    .strict()
);

export const SetEnhanceModelMsgSchema = createEnvelope(
  "auth/setEnhanceModel",
  z
    .object({
      providerId: ProviderIdSchema,
      modelId: ModelIdSchema,
      keySlot: z.number().int().min(0).max(10).optional(),
    })
    .strict()
);

export const SetCopilotOnlyMsgSchema = createEnvelope(
  "auth/setCopilotOnly",
  z
    .object({
      copilotOnly: z.boolean(),
    })
    .strict()
);

export const EnhanceRunMsgSchema = createEnvelope(
  "enhance/run",
  z
    .object({
      operationId: z.string().min(1).optional(),
      description: z.string().min(1).max(20000),
      providerId: ProviderIdSchema,
      modelId: ModelIdSchema,
      keySlot: z.number().int().min(0).max(10).optional(),
      previousProfileVersion: z.number().int().positive().optional(),
    })
    .strict()
);

export const FinalizeProfileMsgSchema = createEnvelope(
  "enhance/finalize",
  z
    .object({
      profileVersion: z.number().int().positive(),
    })
    .strict()
);

export const EditPhasesMsgSchema = createEnvelope(
  "enhance/editPhases",
  z
    .object({
      profileVersion: z.number().int().positive(),
      phases: z.array(ConfirmedPhaseSchema),
    })
    .strict()
);

export const EstimateRequestMsgSchema = createEnvelope(
  "estimate/request",
  z
    .object({
      operationId: z.string().min(1).optional(),
      profileVersion: z.number().int().positive(),
      overrides: z.array(PhaseOverrideSchema).optional(),
    })
    .strict()
);

export const StrategySetMsgSchema = createEnvelope(
  "strategy/set",
  z
    .object({
      selectedIds: z.array(StrategyIdSchema),
    })
    .strict()
);

export const OptimizeGenerateMsgSchema = createEnvelope(
  "optimize/generate",
  z
    .object({
      operationId: z.string().min(1).optional(),
      selectedStrategyIds: z.array(StrategyIdSchema),
      profileVersion: z.number().int().positive(),
    })
    .strict()
);

export const ImplementStartMsgSchema = createEnvelope(
  "optimize/implement/start",
  z
    .object({
      operationId: z.string().min(1).optional(),
      route: z.enum(["install", "ide-agent"]),
      selectedStrategyIds: z.array(StrategyIdSchema),
      profileVersion: z.number().int().positive(),
      modelRef: z
        .object({
          vendor: z.string().min(1).max(100),
          modelId: z.string().min(1).max(100),
        })
        .strict()
        .optional(),
    })
    .strict()
);

export const ApplyAcceptMsgSchema = createEnvelope(
  "optimize/apply/accept",
  z
    .object({
      operationId: z.string().min(1).optional(),
      acceptedProposalIds: z.array(z.string().min(1)),
    })
    .strict()
);

export const HandoffConfirmMsgSchema = createEnvelope(
  "optimize/handoff/confirm",
  z
    .object({
      operationId: z.string().min(1).optional(),
      confirmed: z.boolean(),
    })
    .strict()
);

export const WebviewCancelMsgSchema = createEnvelope(
  "operation/cancel",
  z
    .object({
      operationId: z.string().min(1),
    })
    .strict()
);

// ─── v2 feature messages: Webview -> Host ───────────────────────────────────

/** Ask the host to (re)send `catalog/updated` with the current snapshot and offline flag. */
export const CatalogRequestMsgSchema = createEnvelope("catalog/request", z.object({}).strict());

/** Scan the workspace and draft an Enhance description -> `enhance/prefillResult`. */
export const EnhancePrefillMsgSchema = createEnvelope(
  "enhance/prefill",
  z.object({ operationId: z.string().min(1).optional() }).strict()
);

/** Evaluate technique applicability for a profile -> `strategy/selection` + `strategy/savingsUpdate`. */
export const StrategyEvaluateMsgSchema = createEnvelope(
  "strategy/evaluate",
  z.object({ profileVersion: z.number().int().positive() }).strict()
);

export const PromptOptRunMsgSchema = createEnvelope(
  "promptopt/run",
  z
    .object({
      operationId: z.string().min(1).optional(),
      messages: z.array(PromptMessageSchema).min(1),
      params: PromptParamsSchema.optional(),
      techniqueIds: z.array(StrategyIdSchema).min(1),
      /** Model used for pricing and by `llm` techniques. */
      providerId: ProviderIdSchema,
      modelId: ModelIdSchema,
      keySlot: z.number().int().min(0).max(10).optional(),
      /** Assumed output tokens per call for the $ impact (default chosen by the host). */
      expectedOutputTokens: z.number().int().nonnegative().optional(),
    })
    .strict()
);

export const ImplementExportMsgSchema = createEnvelope(
  "implement/export",
  z
    .object({
      operationId: z.string().min(1).optional(),
      /** Workspace-relative package dir; default "ai_optimizer". */
      targetDir: WorkspaceRelativePathSchema.optional(),
      techniqueIds: z.array(StrategyIdSchema),
      routerConfig: RouterConfigSchema.optional(),
    })
    .strict()
);

export const ImplementScanMsgSchema = createEnvelope(
  "implement/scan",
  z
    .object({
      operationId: z.string().min(1).optional(),
      features: z.array(z.enum(["optimizer", "router"])).min(1),
      techniqueIds: z.array(StrategyIdSchema),
    })
    .strict()
);

const ProposalRefSchema = z.object({ proposalId: z.string().min(1).max(200) }).strict();

export const ImplementApplyBlockMsgSchema = createEnvelope("implement/applyBlock", ProposalRefSchema);
export const ImplementSkipBlockMsgSchema = createEnvelope("implement/skipBlock", ProposalRefSchema);
export const ImplementOpenDiffMsgSchema = createEnvelope("implement/openDiff", ProposalRefSchema);

export const RouterPreviewMsgSchema = createEnvelope(
  "router/preview",
  z
    .object({
      operationId: z.string().min(1).optional(),
      text: z.string().max(200000),
      needsTools: z.boolean().optional(),
      /** Unsaved config being edited in the UI; host uses the saved/default config when absent. */
      config: RouterConfigSchema.optional(),
    })
    .strict()
);

export const RouterGetConfigMsgSchema = createEnvelope("router/getConfig", z.object({}).strict());

export const RouterSaveConfigMsgSchema = createEnvelope(
  "router/saveConfig",
  z.object({ config: RouterConfigSchema }).strict()
);

/** Ask the host to open the UI as an editor-area panel (full width), e.g. from the narrow sidebar. */
export const ViewOpenInEditorMsgSchema = createEnvelope("view/openInEditor", z.object({}).strict());

export const WebviewToHostMsgSchema = z.discriminatedUnion("type", [
  ViewOpenInEditorMsgSchema,
  CatalogRequestMsgSchema,
  EnhancePrefillMsgSchema,
  StrategyEvaluateMsgSchema,
  PromptOptRunMsgSchema,
  ImplementExportMsgSchema,
  ImplementScanMsgSchema,
  ImplementApplyBlockMsgSchema,
  ImplementSkipBlockMsgSchema,
  ImplementOpenDiffMsgSchema,
  RouterPreviewMsgSchema,
  RouterGetConfigMsgSchema,
  RouterSaveConfigMsgSchema,
  WebviewReadyMsgSchema,
  SaveKeyMsgSchema,
  RemoveKeyMsgSchema,
  SetEnabledModelsMsgSchema,
  SetPlatformMsgSchema,
  SetEnhanceModelMsgSchema,
  SetCopilotOnlyMsgSchema,
  EnhanceRunMsgSchema,
  FinalizeProfileMsgSchema,
  EnhanceGetHistoryMsgSchema,
  EnhanceGetVersionMsgSchema,
  EnhanceClearHistoryMsgSchema,
  EditPhasesMsgSchema,
  EstimateRequestMsgSchema,
  StrategySetMsgSchema,
  OptimizeGenerateMsgSchema,
  ImplementStartMsgSchema,
  ApplyAcceptMsgSchema,
  HandoffConfirmMsgSchema,
  WebviewCancelMsgSchema,
]);
