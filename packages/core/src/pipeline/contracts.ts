/**
 * Interfaces of the estimation/optimization pipeline stages.
 *
 * Exports: CatalogContext, ProviderUsage, ProviderCompletionResult, HostModelAdapter,
 *   EnhanceStageInput, EnhanceStageOutput, EstimateStageInput, OptimizeStageInput,
 *   OptimizeStageOutput, InstallPlan, IdeAgentRun, ImplementStageOutput, ImplementStageInput,
 *   ApplicabilityContext, EnhanceStage, EstimateStage, OptimizeStage, ImplementStage
 * Feature: token cost estimator
 */
import type {
  ProjectProfile,
  EstimationResult,
  Strategy,
  Platform,
  StrategyId,
  SavingsRange,
  PhaseOverride,
  Provider,
  Model,
  Pricing,
  Phase,
  PromptTemplate,
} from "../protocol/types.js";
import type { ProviderAdapter } from "../providers/ProviderAdapter.js";

export type { ProviderAdapter };

export interface CatalogContext {
  providers: Provider[];
  models: Model[];
  pricing: Pricing[];
  phases: Phase[];
  strategies: Strategy[];
  platforms: Platform[];
  promptTemplates: PromptTemplate[];
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderCompletionResult {
  text: string;
  usage?: ProviderUsage;
}


export interface HostModelAdapter {
  sendRequest(
    prompt: string,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
}

export interface EnhanceStageInput {
  description: string;
  previousProfile?: ProjectProfile;
}

export interface EnhanceStageOutput {
  narrative: string;
  profile: ProjectProfile;
  usage?: ProviderUsage;
}

export interface EstimateStageInput {
  profile: ProjectProfile;
  catalog: CatalogContext;
  overrides?: PhaseOverride[];
  clock?: () => string;
}

export interface OptimizeStageInput {
  profile: ProjectProfile;
  estimation: EstimationResult;
  strategies: Strategy[];
}

export interface OptimizeStageOutput {
  preselected: Array<{ strategyId: StrategyId; reason: string }>;
  notPreselected: Array<{ strategyId: StrategyId; reason: string }>;
  conflicts: Array<{ a: StrategyId; b: StrategyId; explanation: string }>;
  savings: {
    build: SavingsRange;
    runtime: SavingsRange;
  };
}

export interface InstallPlan {
  kind: "install";
  targetFiles: Array<{ path: string; content: string }>;
}

export interface IdeAgentRun {
  kind: "ide-agent";
  mechanism: "lm-edit" | "chat-handoff" | "clipboard";
  instructions?: string;
}

export type ImplementStageOutput = InstallPlan | IdeAgentRun;

export interface ImplementStageInput {
  selectedStrategyIds: StrategyId[];
  platform: Platform;
  profile: ProjectProfile;
}

export interface ApplicabilityContext {
  profile: ProjectProfile;
  phaseTypes: string[];
  tokenShareByPhaseType: Record<string, number>;
}

// ─── Stage Function Signatures ──────────────────────────────────────────────
// Principle XII: Only Enhance and Implement take an adapter parameter.
// Estimate and Optimize are pure functions taking NO adapter.

export type EnhanceStage = (
  input: EnhanceStageInput,
  adapter: ProviderAdapter,
  options?: { signal?: AbortSignal }
) => Promise<EnhanceStageOutput>;

export type EstimateStage = (input: EstimateStageInput) => EstimationResult;

export type OptimizeStage = (input: OptimizeStageInput) => OptimizeStageOutput;

export type ImplementStage = (
  input: ImplementStageInput,
  adapter?: HostModelAdapter,
  options?: { signal?: AbortSignal }
) => Promise<ImplementStageOutput>;
