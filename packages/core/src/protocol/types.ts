/**
 * TypeScript types inferred from the protocol and catalog Zod schemas.
 *
 * Exports: ISO8601, ModelId, ProviderId, StrategyId, PhaseId, ConfirmedPhase, TechStackEntry,
 *   ComponentEntry, Provider, Model, Pricing, Phase, SavingsRange, Strategy, Platform,
 *   PromptTemplate, ExplainNode, TokenBreakdown, CostRange, PhaseResult, TrackResult, ScaleMetrics,
 *   EstimationResult, EditProposal, PhaseOverride, CatalogUpdatedMsg, KeySavedMsg, KeyErrorMsg,
 *   KeyRemovedMsg, AuthStateMsg, EnhanceStreamMsg, EnhanceResultMsg, EnhanceErrorMsg,
 *   ProfileFinalizedMsg, PhasesUpdatedMsg, ProfileHistorySummary, EnhanceHistoryLoadedMsg,
 *   EnhanceVersionLoadedMsg, EnhanceHistoryClearedMsg, EstimateResultMsg, EstimateErrorMsg,
 *   StrategySelectionMsg, SavingsUpdateMsg, GenerateProgressMsg, GenerateCompleteMsg,
 *   ImplementPlanMsg, ApplyProgressMsg, ApplyProposalsMsg, ApplyCompleteMsg, HandoffPreviewMsg,
 *   HandoffResultMsg, HostCancelledMsg, HostToWebviewMsg, WebviewReadyMsg, SaveKeyMsg, RemoveKeyMsg,
 *   SetEnabledModelsMsg, SetPlatformMsg, SetEnhanceModelMsg, SetCopilotOnlyMsg, EnhanceRunMsg,
 *   FinalizeProfileMsg, EnhanceGetHistoryMsg, EnhanceGetVersionMsg, EnhanceClearHistoryMsg,
 *   EditPhasesMsg, EstimateRequestMsg, StrategySetMsg, OptimizeGenerateMsg, ImplementStartMsg,
 *   ApplyAcceptMsg, HandoffConfirmMsg, WebviewCancelMsg, WebviewToHostMsg, TechniqueOptimizer,
 *   TechniqueImplementation, RouterTier, RouterCandidate, RouterRules, RouterConfig, RouterPreset,
 *   RouteDecision, PromptMessage, PromptParams, PromptOptStep, PromptOptCost, SourceRange,
 *   ImplementEditProposal, FeatureErrorPayload, FeatureErrorCode, CatalogRequestMsg,
 *   EnhancePrefillMsg, StrategyEvaluateMsg, PromptOptRunMsg, ImplementExportMsg, ImplementScanMsg,
 *   ImplementApplyBlockMsg, ImplementSkipBlockMsg, ImplementOpenDiffMsg, RouterPreviewMsg,
 *   RouterGetConfigMsg, RouterSaveConfigMsg, EnhancePrefillResultMsg, PromptOptResultMsg,
 *   ImplementExportedMsg, ImplementProposalsMsg, ImplementBlockResultMsg, RouterPreviewResultMsg,
 *   RouterConfigMsg, RouterConfigSavedMsg, FeatureErrorMsgType
 * Feature: shared protocol / webview shell
 */
import { z } from "zod";
import * as schemas from "./schemas.js";

// ─── Primitive / Helper Types ───────────────────────────────────────────────

export type ISO8601 = z.infer<typeof schemas.ISO8601Schema>;
export type ModelId = z.infer<typeof schemas.ModelIdSchema>;
export type ProviderId = z.infer<typeof schemas.ProviderIdSchema>;
export type StrategyId = z.infer<typeof schemas.StrategyIdSchema>;
export type PhaseId = z.infer<typeof schemas.PhaseIdSchema>;

// ─── Domain Entity Types ───────────────────────────────────────────────────

export type ConfirmedPhase = z.infer<typeof schemas.ConfirmedPhaseSchema>;
export type TechStackEntry = z.infer<typeof schemas.TechStackEntrySchema>;
export type ComponentEntry = z.infer<typeof schemas.ComponentEntrySchema>;
export type { ProjectProfile } from "../profile/schema.js";
export type Provider = z.infer<typeof schemas.ProviderSchema>;
export type Model = z.infer<typeof schemas.ModelSchema>;
export type Pricing = z.infer<typeof schemas.PricingSchema>;
export type Phase = z.infer<typeof schemas.PhaseSchema>;
export type SavingsRange = z.infer<typeof schemas.SavingsRangeSchema>;
export type Strategy = z.infer<typeof schemas.StrategySchema>;
export type Platform = z.infer<typeof schemas.PlatformSchema>;
export type PromptTemplate = z.infer<typeof schemas.PromptTemplateSchema>;
export type ExplainNode = schemas.ExplainNodeData;
export type TokenBreakdown = z.infer<typeof schemas.TokenBreakdownSchema>;
export type CostRange = z.infer<typeof schemas.CostRangeSchema>;
export type PhaseResult = z.infer<typeof schemas.PhaseResultSchema>;
export type TrackResult = z.infer<typeof schemas.TrackResultSchema>;
export type ScaleMetrics = z.infer<typeof schemas.ScaleMetricsSchema>;
export type EstimationResult = z.infer<typeof schemas.EstimationResultSchema>;
export type EditProposal = z.infer<typeof schemas.EditProposalSchema>;
export type PhaseOverride = z.infer<typeof schemas.PhaseOverrideSchema>;

// ─── Host -> Webview Messages ───────────────────────────────────────────────

export type CatalogUpdatedMsg = z.infer<typeof schemas.CatalogUpdatedMsgSchema>;
export type KeySavedMsg = z.infer<typeof schemas.KeySavedMsgSchema>;
export type KeyErrorMsg = z.infer<typeof schemas.KeyErrorMsgSchema>;
export type KeyRemovedMsg = z.infer<typeof schemas.KeyRemovedMsgSchema>;
export type AuthStateMsg = z.infer<typeof schemas.AuthStateMsgSchema>;
export type EnhanceStreamMsg = z.infer<typeof schemas.EnhanceStreamMsgSchema>;
export type EnhanceResultMsg = z.infer<typeof schemas.EnhanceResultMsgSchema>;
export type EnhanceErrorMsg = z.infer<typeof schemas.EnhanceErrorMsgSchema>;
export type ProfileFinalizedMsg = z.infer<typeof schemas.ProfileFinalizedMsgSchema>;
export type PhasesUpdatedMsg = z.infer<typeof schemas.PhasesUpdatedMsgSchema>;
export type ProfileHistorySummary = z.infer<typeof schemas.ProfileHistorySummarySchema>;
export type EnhanceHistoryLoadedMsg = z.infer<typeof schemas.EnhanceHistoryLoadedMsgSchema>;
export type EnhanceVersionLoadedMsg = z.infer<typeof schemas.EnhanceVersionLoadedMsgSchema>;
export type EnhanceHistoryClearedMsg = z.infer<typeof schemas.EnhanceHistoryClearedMsgSchema>;
export type EstimateResultMsg = z.infer<typeof schemas.EstimateResultMsgSchema>;
export type EstimateErrorMsg = z.infer<typeof schemas.EstimateErrorMsgSchema>;
export type StrategySelectionMsg = z.infer<typeof schemas.StrategySelectionMsgSchema>;
export type SavingsUpdateMsg = z.infer<typeof schemas.SavingsUpdateMsgSchema>;
export type GenerateProgressMsg = z.infer<typeof schemas.GenerateProgressMsgSchema>;
export type GenerateCompleteMsg = z.infer<typeof schemas.GenerateCompleteMsgSchema>;
export type ImplementPlanMsg = z.infer<typeof schemas.ImplementPlanMsgSchema>;
export type ApplyProgressMsg = z.infer<typeof schemas.ApplyProgressMsgSchema>;
export type ApplyProposalsMsg = z.infer<typeof schemas.ApplyProposalsMsgSchema>;
export type ApplyCompleteMsg = z.infer<typeof schemas.ApplyCompleteMsgSchema>;
export type HandoffPreviewMsg = z.infer<typeof schemas.HandoffPreviewMsgSchema>;
export type HandoffResultMsg = z.infer<typeof schemas.HandoffResultMsgSchema>;
export type HostCancelledMsg = z.infer<typeof schemas.HostCancelledMsgSchema>;

export type HostToWebviewMsg = z.infer<typeof schemas.HostToWebviewMsgSchema>;

// ─── Webview -> Host Messages ───────────────────────────────────────────────

export type WebviewReadyMsg = z.infer<typeof schemas.WebviewReadyMsgSchema>;
export type SaveKeyMsg = z.infer<typeof schemas.SaveKeyMsgSchema>;
export type RemoveKeyMsg = z.infer<typeof schemas.RemoveKeyMsgSchema>;
export type SetEnabledModelsMsg = z.infer<typeof schemas.SetEnabledModelsMsgSchema>;
export type SetPlatformMsg = z.infer<typeof schemas.SetPlatformMsgSchema>;
export type SetEnhanceModelMsg = z.infer<typeof schemas.SetEnhanceModelMsgSchema>;
export type SetCopilotOnlyMsg = z.infer<typeof schemas.SetCopilotOnlyMsgSchema>;
export type EnhanceRunMsg = z.infer<typeof schemas.EnhanceRunMsgSchema>;
export type FinalizeProfileMsg = z.infer<typeof schemas.FinalizeProfileMsgSchema>;
export type EnhanceGetHistoryMsg = z.infer<typeof schemas.EnhanceGetHistoryMsgSchema>;
export type EnhanceGetVersionMsg = z.infer<typeof schemas.EnhanceGetVersionMsgSchema>;
export type EnhanceClearHistoryMsg = z.infer<typeof schemas.EnhanceClearHistoryMsgSchema>;
export type EditPhasesMsg = z.infer<typeof schemas.EditPhasesMsgSchema>;
export type EstimateRequestMsg = z.infer<typeof schemas.EstimateRequestMsgSchema>;
export type StrategySetMsg = z.infer<typeof schemas.StrategySetMsgSchema>;
export type OptimizeGenerateMsg = z.infer<typeof schemas.OptimizeGenerateMsgSchema>;
export type ImplementStartMsg = z.infer<typeof schemas.ImplementStartMsgSchema>;
export type ApplyAcceptMsg = z.infer<typeof schemas.ApplyAcceptMsgSchema>;
export type HandoffConfirmMsg = z.infer<typeof schemas.HandoffConfirmMsgSchema>;
export type WebviewCancelMsg = z.infer<typeof schemas.WebviewCancelMsgSchema>;

export type WebviewToHostMsg = z.infer<typeof schemas.WebviewToHostMsgSchema>;

// ─── v2 feature types (frozen contract) ────────────────────────────────────

export type TechniqueOptimizer = z.infer<typeof schemas.TechniqueOptimizerSchema>;
export type TechniqueImplementation = z.infer<typeof schemas.TechniqueImplementationSchema>;
export type RouterTier = z.infer<typeof schemas.RouterTierSchema>;
export type RouterCandidate = z.infer<typeof schemas.RouterCandidateSchema>;
export type RouterRules = z.infer<typeof schemas.RouterRulesSchema>;
export type RouterConfig = z.infer<typeof schemas.RouterConfigSchema>;
export type RouterPreset = z.infer<typeof schemas.RouterPresetSchema>;
export type RouteDecision = z.infer<typeof schemas.RouteDecisionSchema>;
export type PromptMessage = z.infer<typeof schemas.PromptMessageSchema>;
export type PromptParams = z.infer<typeof schemas.PromptParamsSchema>;
export type PromptOptStep = z.infer<typeof schemas.PromptOptStepSchema>;
export type PromptOptCost = z.infer<typeof schemas.PromptOptCostSchema>;
export type SourceRange = z.infer<typeof schemas.SourceRangeSchema>;
export type ImplementEditProposal = z.infer<typeof schemas.ImplementEditProposalSchema>;
export type FeatureErrorPayload = z.infer<typeof schemas.FeatureErrorPayloadSchema>;
export type FeatureErrorCode = FeatureErrorPayload["error"];

export type CatalogRequestMsg = z.infer<typeof schemas.CatalogRequestMsgSchema>;
export type EnhancePrefillMsg = z.infer<typeof schemas.EnhancePrefillMsgSchema>;
export type StrategyEvaluateMsg = z.infer<typeof schemas.StrategyEvaluateMsgSchema>;
export type PromptOptRunMsg = z.infer<typeof schemas.PromptOptRunMsgSchema>;
export type ImplementExportMsg = z.infer<typeof schemas.ImplementExportMsgSchema>;
export type ImplementScanMsg = z.infer<typeof schemas.ImplementScanMsgSchema>;
export type ImplementApplyBlockMsg = z.infer<typeof schemas.ImplementApplyBlockMsgSchema>;
export type ImplementSkipBlockMsg = z.infer<typeof schemas.ImplementSkipBlockMsgSchema>;
export type ImplementOpenDiffMsg = z.infer<typeof schemas.ImplementOpenDiffMsgSchema>;
export type RouterPreviewMsg = z.infer<typeof schemas.RouterPreviewMsgSchema>;
export type RouterGetConfigMsg = z.infer<typeof schemas.RouterGetConfigMsgSchema>;
export type RouterSaveConfigMsg = z.infer<typeof schemas.RouterSaveConfigMsgSchema>;

export type EnhancePrefillResultMsg = z.infer<typeof schemas.EnhancePrefillResultMsgSchema>;
export type PromptOptResultMsg = z.infer<typeof schemas.PromptOptResultMsgSchema>;
export type ImplementExportedMsg = z.infer<typeof schemas.ImplementExportedMsgSchema>;
export type ImplementProposalsMsg = z.infer<typeof schemas.ImplementProposalsMsgSchema>;
export type ImplementBlockResultMsg = z.infer<typeof schemas.ImplementBlockResultMsgSchema>;
export type RouterPreviewResultMsg = z.infer<typeof schemas.RouterPreviewResultMsgSchema>;
export type RouterConfigMsg = z.infer<typeof schemas.RouterConfigMsgSchema>;
export type RouterConfigSavedMsg = z.infer<typeof schemas.RouterConfigSavedMsgSchema>;

/** Every `<feature>/error` message type that carries a FeatureErrorPayload. */
export type FeatureErrorMsgType =
  | "enhance/prefillError"
  | "strategy/error"
  | "promptopt/error"
  | "implement/error"
  | "router/error";
