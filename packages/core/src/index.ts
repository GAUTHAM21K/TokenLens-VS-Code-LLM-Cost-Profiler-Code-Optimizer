/**
 * Public API of @token-optimizer/core (protocol, catalog, providers, estimation, profile).
 *
 * Exports: CORE_VERSION, * from ./protocol/schemas.js, * from ./protocol/types.js, * from
 *   ./protocol/fixtures.js, * from ./pipeline/contracts.js, * from ./catalog/schemas.js, * from
 *   ./catalog/CatalogClient.js, * from ./catalog/BundledSnapshotLoader.js, * from
 *   ./providers/ProviderAdapter.js, * from ./providers/AnthropicAdapter.js, * from
 *   ./providers/OpenAIAdapter.js, * from ./providers/GoogleAdapter.js, * from
 *   ./providers/MistralAdapter.js, * from ./providers/OpenAICompatibleAdapter.js, * from
 *   ./providers/CostCalculator.js, * from ./profile/schema.js, * from ./phases/PhaseSuggester.js, *
 *   from ./phases/PhaseResolver.js, * from ./estimation/TokenizerLayer.js, * from
 *   ./estimation/ParamResolver.js, * from ./estimation/EstimationEngine.js, * from
 *   ./strategies/SavingsAggregator.js, * from ./strategies/ConflictResolver.js, * from
 *   ./strategies/StrategyEngine.js, * from ./setup/UserSetupStore.js, * from ./optimizer/index.js, *
 *   from ./router/RouterRules.js, * from ./implement/index.js
 * Feature: token cost estimator
 */
export * from "./protocol/schemas.js";
export * from "./protocol/types.js";
export * from "./protocol/fixtures.js";
export * from "./pipeline/contracts.js";
export * from "./catalog/schemas.js";
export * from "./catalog/CatalogClient.js";
export * from "./catalog/BundledSnapshotLoader.js";
export * from "./providers/ProviderAdapter.js";
export * from "./providers/AnthropicAdapter.js";
export * from "./providers/OpenAIAdapter.js";
export * from "./providers/GoogleAdapter.js";
export * from "./providers/MistralAdapter.js";
export * from "./providers/OpenAICompatibleAdapter.js";
export * from "./providers/CostCalculator.js";
export * from "./profile/schema.js";
export * from "./phases/PhaseSuggester.js";
export * from "./phases/PhaseResolver.js";
export * from "./estimation/TokenizerLayer.js";
export * from "./estimation/ParamResolver.js";
export * from "./estimation/EstimationEngine.js";
export * from "./strategies/SavingsAggregator.js";
export * from "./strategies/ConflictResolver.js";
export * from "./strategies/StrategyEngine.js";
export * from "./setup/UserSetupStore.js";
export * from "./optimizer/index.js";
export * from "./router/RouterRules.js";
export * from "./implement/index.js";

export const CORE_VERSION = "0.1.0";

