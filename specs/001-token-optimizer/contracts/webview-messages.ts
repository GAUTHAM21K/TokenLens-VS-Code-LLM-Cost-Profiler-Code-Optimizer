/**
 * Webview ↔ Extension Host Message Protocol
 *
 * All messages are validated with Zod schemas on both sides.
 * The discriminated union key is `type`. Every envelope carries `version`.
 *
 * Direction tags:
 *   H→W  = extension host sends to webview
 *   W→H  = webview sends to extension host
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

type ISO8601 = string;
type ModelId = string;
type ProviderId = string;
type StrategyId = string;
type PhaseId = string;

interface Envelope<T extends string, P> {
  version: 1;
  type: T;
  payload: P;
}

// ─── Catalog messages ─────────────────────────────────────────────────────────

/** H→W: full catalog snapshot delivered after load or refresh */
export type CatalogUpdatedMsg = Envelope<"catalog/updated", {
  version: number;
  schemaVersion: string;
  providers: Provider[];
  models: Model[];
  pricing: Pricing[];
  phases: Phase[];
  strategies: Strategy[];       // only approved
  platforms: Platform[];
  promptTemplates: PromptTemplate[];
  isOffline: boolean;
}>;

// ─── Auth / Key messages ──────────────────────────────────────────────────────

/** W→H: user submits a new API key */
export type SaveKeyMsg = Envelope<"auth/saveKey", {
  providerId: ProviderId;
  keySlot: number;    // index (0-based) for providers that allow multiple keys
  key: string;        // CLEARED immediately in extension host after storage
}>;

/** H→W: key validated and stored (key string NOT echoed back) */
export type KeySavedMsg = Envelope<"auth/keySaved", {
  providerId: ProviderId;
  keySlot: number;
  maskedKey: string;  // last 4 chars only, e.g. "...a1b2"
}>;

/** H→W: key validation failed */
export type KeyErrorMsg = Envelope<"auth/keyError", {
  providerId: ProviderId;
  keySlot: number;
  error: "invalid" | "unreachable" | "rate-limited";
  message: string;
}>;

/** W→H: user removes a stored key */
export type RemoveKeyMsg = Envelope<"auth/removeKey", {
  providerId: ProviderId;
  keySlot: number;
}>;

/** H→W: key removed confirmation */
export type KeyRemovedMsg = Envelope<"auth/keyRemoved", {
  providerId: ProviderId;
  keySlot: number;
}>;

/** H→W: list of configured providers + masked keys (sent on panel open) */
export type AuthStateMsg = Envelope<"auth/state", {
  platform: string;                     // detected platform id
  configuredKeys: Array<{
    providerId: ProviderId;
    keySlot: number;
    maskedKey: string;
    enabledModels: ModelId[];
  }>;
  copilotAvailable: boolean;
  platformOverridden: boolean;
  enhanceModel?: { providerId: ProviderId; modelId: ModelId };
}>;

/** W→H: user overrides the auto-detected platform (FR-001, FR-050) */
export type SetPlatformMsg = Envelope<"auth/setPlatform", {
  platformId: string;
}>;

/** W→H: user picks the provider/model Enhance will use (FR-050) */
export type SetEnhanceModelMsg = Envelope<"auth/setEnhanceModel", {
  providerId: ProviderId;
  modelId: ModelId;
}>;

/** W→H: user enables/disables a model for a provider */
export type SetEnabledModelsMsg = Envelope<"auth/setEnabledModels", {
  providerId: ProviderId;
  enabledModels: ModelId[];
}>;

// ─── Enhance messages ─────────────────────────────────────────────────────────

/** W→H: run Enhance on the given description */
export type EnhanceRunMsg = Envelope<"enhance/run", {
  description: string;
  providerId: ProviderId;
  modelId: ModelId;
  previousProfileVersion?: number;  // if refining an existing profile
}>;

/** H→W: streaming token of the narrative (for live preview) */
export type EnhanceStreamMsg = Envelope<"enhance/stream", {
  delta: string;
}>;

/** H→W: Enhance completed successfully */
export type EnhanceResultMsg = Envelope<"enhance/result", {
  narrative: string;
  profile: ProjectProfile;
  profileVersion: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  taxonomyBudgetLevel?: "full" | "short" | "compact";
}>;

/** H→W: Enhance failed */
export type EnhanceErrorMsg = Envelope<"enhance/error", {
  error: "llm-failed" | "repair-failed" | "schema-invalid";
  message: string;
}>;

/** W→H: user finalises a profile version */
export type FinalizeProfileMsg = Envelope<"enhance/finalize", {
  profileVersion: number;
}>;

/** W→H: user edits phases on the Enhance screen; no LLM call (FR-052) */
export type EditPhasesMsg = Envelope<"enhance/editPhases", {
  profileVersion: number;
  phases: ConfirmedPhase[];
}>;

/** H→W: phases validated against the catalog; a new draft version was created */
export type PhasesUpdatedMsg = Envelope<"enhance/phasesUpdated", {
  profileVersion: number;
  phases: ConfirmedPhase[];
  problems: Array<{ phaseId: string; problem: "unknown-type" | "track-mismatch" | "unconfirmed" }>;
}>;

/** H→W: profile finalized; estimation now available */
export type ProfileFinalizedMsg = Envelope<"enhance/profileFinalized", {
  profileVersion: number;
}>;

export interface ProfileHistorySummary {
  version: number;
  createdAt: string;
  finalizedAt?: string;
  phaseCount: number;
  costUsd?: number;
}

/** W→H: request profile version history summaries */
export type EnhanceGetHistoryMsg = Envelope<"enhance/getHistory", Record<string, never>>;

/** W→H: request specific full profile version entry */
export type EnhanceGetVersionMsg = Envelope<"enhance/getVersion", {
  version: number;
}>;

/** W→H: clear profile version history */
export type EnhanceClearHistoryMsg = Envelope<"enhance/clearHistory", Record<string, never>>;

/** H→W: version history summaries loaded */
export type EnhanceHistoryLoadedMsg = Envelope<"enhance/historyLoaded", {
  summaries: ProfileHistorySummary[];
}>;

/** H→W: specific full profile version loaded */
export type EnhanceVersionLoadedMsg = Envelope<"enhance/versionLoaded", {
  entry: ProfileHistoryEntry;
}>;

/** H→W: profile history successfully cleared */
export type EnhanceHistoryClearedMsg = Envelope<"enhance/historyCleared", Record<string, never>>;

// ─── Estimation messages ──────────────────────────────────────────────────────

/** W→H: request estimation (initial or after assumption edit) */
export type EstimateRequestMsg = Envelope<"estimate/request", {
  profileVersion: number;
  overrides?: PhaseOverride[];   // user-edited assumption values
}>;

/** H→W: estimation result */
export type EstimateResultMsg = Envelope<"estimate/result", {
  result: EstimationResult;
}>;

interface PhaseOverride {
  phaseId: PhaseId;
  callsExpected?: number;
  tokensPerCallExpected?: number;
  retriesExpected?: number;
  volumeMultiplierExpected?: number;
  // low/high overrides also supported:
  callsLow?: number; callsHigh?: number;
  tokensPerCallLow?: number; tokensPerCallHigh?: number;
}

// ─── Strategy messages ────────────────────────────────────────────────────────

/** H→W: pre-selected strategies for the current profile */
export type StrategySelectionMsg = Envelope<"strategy/selection", {
  selected: Array<{ strategyId: StrategyId; reason: string }>;
  conflicts: Array<{ a: StrategyId; b: StrategyId; explanation: string }>;
  notPreselected: Array<{ strategyId: StrategyId; reason: string }>;  // FR-051: selectable, with why not pre-selected
}>;

/** W→H: user changed strategy selection */
export type StrategySetMsg = Envelope<"strategy/set", {
  selectedIds: StrategyId[];
}>;

/** H→W: updated savings estimate for current strategy set */
export type SavingsUpdateMsg = Envelope<"strategy/savingsUpdate", {
  build: SavingsRange;
  runtime: SavingsRange;
  conflicts: Array<{ a: StrategyId; b: StrategyId; explanation: string }>;
}>;

interface SavingsRange {
  minPercent: number;
  maxPercent: number;
  basis: string;
}

// ─── Optimize: Generate files ─────────────────────────────────────────────────

/** W→H: generate .ai-optimizer/ workspace */
export type OptimizeGenerateMsg = Envelope<"optimize/generate", {
  selectedStrategyIds: StrategyId[];
  profileVersion: number;
}>;

/** H→W: generation progress */
export type GenerateProgressMsg = Envelope<"optimize/generateProgress", {
  step: string;
  filesWritten: string[];
  conflicts: Array<{ path: string; diffToken: string }>;
}>;

/** H→W: generation complete */
export type GenerateCompleteMsg = Envelope<"optimize/generateComplete", {
  filesWritten: string[];
}>;

// ─── Optimize: Apply now ──────────────────────────────────────────────────────

/** W→H: user chose Implement. route "install" -> optimize/generate flow; "ide-agent" -> mechanism from catalog */
export type ImplementStartMsg = Envelope<"optimize/implement/start", {
  route: "install" | "ide-agent";
  selectedStrategyIds: StrategyId[];
  profileVersion: number;
  modelRef?: { vendor: string; modelId: string };   // host model chosen by the user for lm-edit; values come from the host's own list
}>;

/** H→W: which mechanism the host will use for route "ide-agent" (from the catalog, first one available) */
export type ImplementPlanMsg = Envelope<"optimize/implement/plan", {
  mechanism: "lm-edit" | "chat-handoff" | "clipboard";
  reason: string;
}>;

/** H→W: scanner progress */
export type ApplyProgressMsg = Envelope<"optimize/apply/progress", {
  stage: "scanning" | "planning" | "validating" | "ready";
  filesScanned?: number;
  proposalsReady?: number;
  message?: string;
}>;

/** H→W: edit proposals ready for review */
export type ApplyProposalsMsg = Envelope<"optimize/apply/proposals", {
  proposals: EditProposal[];
  staleCount: number;     // proposals skipped (anchor mismatch)
}>;

/** W→H: user accepted a subset of proposals */
export type ApplyAcceptMsg = Envelope<"optimize/apply/accept", {
  acceptedProposalIds: string[];
}>;

/** H→W: apply complete */
export type ApplyCompleteMsg = Envelope<"optimize/apply/complete", {
  appliedCount: number;
  checkpointId: string;
}>;

// ─── Optimize: Hand off to IDE agent ──────────────────────────────────────────

/** H→W: rendered, redacted prompt for review (chat-handoff and clipboard mechanisms). Nothing is dispatched yet. */
export type HandoffPreviewMsg = Envelope<"optimize/handoff/preview", {
  promptText: string;
  redactionCount: number;
  agentWritesOutsideReview: true;   // UI MUST show the FR-058 notice
  hostCommandAvailable: boolean;    // false -> clipboard fallback (FR-057)
}>;

/** W→H: user confirms or cancels the previewed prompt */
export type HandoffConfirmMsg = Envelope<"optimize/handoff/confirm", {
  confirmed: boolean;
}>;

/** H→W: outcome of the hand-off */
export type HandoffResultMsg = Envelope<"optimize/handoff/result", {
  status: "opened" | "copied" | "cancelled" | "failed";
  checkpointId?: string;     // absent when cancelled
  message?: string;
}>;

/** H→W or W→H: cancel any in-progress operation */
export type CancelMsg = Envelope<"operation/cancel", {
  operationId: string;
}>;

// ─── Union type (all messages) ────────────────────────────────────────────────

export type HostToWebviewMsg =
  | CatalogUpdatedMsg
  | KeySavedMsg
  | KeyErrorMsg
  | KeyRemovedMsg
  | AuthStateMsg
  | EnhanceStreamMsg
  | EnhanceResultMsg
  | EnhanceErrorMsg
  | ProfileFinalizedMsg
  | EstimateResultMsg
  | StrategySelectionMsg
  | SavingsUpdateMsg
  | GenerateProgressMsg
  | GenerateCompleteMsg
  | ApplyProgressMsg
  | ApplyProposalsMsg
  | ApplyCompleteMsg
  | ImplementPlanMsg
  | PhasesUpdatedMsg
  | EnhanceHistoryLoadedMsg
  | EnhanceVersionLoadedMsg
  | EnhanceHistoryClearedMsg
  | HandoffPreviewMsg
  | HandoffResultMsg;

export type WebviewToHostMsg =
  | SaveKeyMsg
  | RemoveKeyMsg
  | SetEnabledModelsMsg
  | SetPlatformMsg
  | SetEnhanceModelMsg
  | EnhanceRunMsg
  | FinalizeProfileMsg
  | EnhanceGetHistoryMsg
  | EnhanceGetVersionMsg
  | EnhanceClearHistoryMsg
  | EstimateRequestMsg
  | StrategySetMsg
  | OptimizeGenerateMsg
  | ImplementStartMsg
  | EditPhasesMsg
  | ApplyAcceptMsg
  | HandoffConfirmMsg
  | CancelMsg;

// ─── Re-exported data types (from core) ───────────────────────────────────────
// These types are defined in packages/core/src/protocol/types.ts and re-exported here
// for documentation purposes only. The actual imports come from @token-optimizer/core.

export type {
  ProjectProfile,
  ConfirmedPhase,
  EstimationResult,
  EditProposal,
  Provider,
  Model,
  Pricing,
  Phase,
  Strategy,
  Platform,
  PromptTemplate,
} from "@token-optimizer/core";
