/**
 * Webview root: header (catalog status badge), tab bar, and tab routing for
 * Enhance | Estimate | Optimize | Prompt Optimizer | Implement | Router | Settings.
 * Owns catalog state and cross-tab selections; each tab renders its own views/<Feature>View.
 * Narrow sidebar (< 640 px): inactive tabs show icons only (title + aria-label), the tab bar
 * scrolls horizontally instead of clipping, and the header offers "Open in editor" (a full-width
 * editor-area panel) unless we already are that panel.
 * FROZEN SHELL for Phase 1: tracks edit only their own view files.
 *
 * Exports: App, pickDefaultModel
 * Feature: webview shell (all features)
 */
import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Calculator,
  Sliders,
  FolderGit2,
  Settings,
  Wand,
  Route,
  Wifi,
  WifiOff,
  AlertCircle,
  X,
  Maximize2,
} from "lucide-react";
import { vscodeBridge } from "./protocol/vscode";
import { hostView, useNarrowLayout } from "./utils/layout";
import { EnhanceView } from "./views/EnhanceView";
import { EstimateView } from "./views/EstimateView";
import { OptimizeView } from "./views/OptimizeView";
import { ImplementView } from "./views/ImplementView";
import { SettingsView } from "./views/SettingsView";
import { PromptOptimizerView } from "./views/PromptOptimizerView";
import { RouterView } from "./views/RouterView";
import type { CatalogViewData, FeatureViewProps, ModelRef } from "./views/viewProps";
import type {
  HostToWebviewMsg,
  ProjectProfile,
  EstimationResult,
  Strategy,
  Provider,
  Model,
  SavingsRange,
  Phase as CatalogPhase,
  Pricing,
  RouterPreset,
} from "@token-optimizer/core";

type TabId =
  | "enhance"
  | "estimate"
  | "optimize"
  | "promptopt"
  | "implement"
  | "router"
  | "settings";

/**
 * Default model when the user has not picked an Enhance model: the first active model of an
 * enabled provider that has a stored key; undefined means "ask the user to pick one".
 */
export function pickDefaultModel(
  providers: Provider[],
  models: Model[],
  configuredProviderIds: string[]
): ModelRef | undefined {
  for (const provider of providers) {
    if (!provider.enabled || !configuredProviderIds.includes(provider.id)) continue;
    const model = models.find((m) => m.providerId === provider.id && m.status === "active");
    if (model) return { providerId: provider.id, modelId: model.id };
  }
  return undefined;
}

interface PersistedUiState {
  activeTab?: TabId;
  narrative?: string;
  enhanceCostUsd?: number;
  profile?: ProjectProfile | null;
  selectedStrategyIds?: string[];
}

export const App: React.FC = () => {
  const initialSavedState = vscodeBridge.getState<PersistedUiState>() || {};

  const [activeTab, setActiveTab] = useState<TabId>(initialSavedState.activeTab || "enhance");
  // null = unknown until the host sends catalog/updated (badge shows "Catalog: checking").
  const [isOffline, setIsOffline] = useState<boolean | null>(null);
  const [routerPresets, setRouterPresets] = useState<RouterPreset[]>([]);
  const [catalogPublishedAt, setCatalogPublishedAt] = useState<string | null>(null);
  const [platform, setPlatform] = useState("vscode");
  const [catalogPhases, setCatalogPhases] = useState<CatalogPhase[]>([]);
  const [pricing, setPricing] = useState<Pricing[]>([]);

  // Enhance state
  const [profile, setProfile] = useState<ProjectProfile | null>(initialSavedState.profile || null);
  const [narrative, setNarrative] = useState(initialSavedState.narrative || "");
  const [isEnhanceStreaming, setIsEnhanceStreaming] = useState(false);
  const [enhanceCostUsd, setEnhanceCostUsd] = useState(initialSavedState.enhanceCostUsd || 0);

  // Estimate state
  const [estimation, setEstimation] = useState<EstimationResult | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);

  // Strategy / Optimize state
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>(
    initialSavedState.selectedStrategyIds || []
  );
  const [savings, setSavings] = useState<{
    build: SavingsRange;
    runtime: SavingsRange;
  } | null>(null);

  // Auth / Settings state
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [configuredKeys, setConfiguredKeys] = useState<
    Array<{
      providerId: string;
      keySlot: number;
      maskedKey: string;
      enabledModels: string[];
    }>
  >([]);
  const [copilotAvailable, setCopilotAvailable] = useState(true);
  const [enhanceModel, setEnhanceModel] = useState<
    { providerId: string; modelId: string; keySlot?: number } | undefined
  >(undefined);

  // Error banners (Finding 12)
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Persist state to VS Code webview state (Finding 13)
  useEffect(() => {
    vscodeBridge.setState<PersistedUiState>({
      activeTab,
      narrative,
      enhanceCostUsd,
      profile,
      selectedStrategyIds,
    });
  }, [activeTab, narrative, enhanceCostUsd, profile, selectedStrategyIds]);

  // Initial handshake: webview/ready makes the host (re)send catalog + auth state. If no catalog
  // arrives shortly (e.g. ready was dropped), ask explicitly with catalog/request.
  useEffect(() => {
    vscodeBridge.postMessage({
      version: 1,
      type: "webview/ready",
      payload: {},
    });
  }, []);
  useEffect(() => {
    if (isOffline !== null) return;
    const timer = setTimeout(() => {
      vscodeBridge.postMessage({ version: 1, type: "catalog/request", payload: {} });
    }, 1500);
    return () => clearTimeout(timer);
  }, [isOffline]);

  // H11: Auto-trigger estimation when switching to estimate tab with finalized profile
  useEffect(() => {
    if (activeTab === "estimate" && profile?.finalizedAt) {
      if (!estimation || estimation.profileVersion !== profile.profileVersion) {
        setIsEstimating(true);
        vscodeBridge.postMessage({
          version: 1,
          type: "estimate/request",
          payload: {
            profileVersion: profile.profileVersion,
          },
        });
      }
    }
  }, [activeTab, profile?.finalizedAt, profile?.profileVersion, estimation]);

  useEffect(() => {
    const unsubscribe = vscodeBridge.onMessage((msg: HostToWebviewMsg) => {
      switch (msg.type) {
        case "catalog/updated":
          setStrategies(msg.payload.strategies);
          setProviders(msg.payload.providers);
          setModels(msg.payload.models);
          setPricing(msg.payload.pricing || []);
          setCatalogPhases(msg.payload.phases || []);
          setRouterPresets(msg.payload.routerPresets ?? []);
          setIsOffline(msg.payload.isOffline);
          if (msg.payload.publishedAt) {
            setCatalogPublishedAt(msg.payload.publishedAt);
          }
          break;

        case "auth/state":
          setPlatform(msg.payload.platform);
          setConfiguredKeys(msg.payload.configuredKeys);
          setCopilotAvailable(msg.payload.copilotAvailable);
          if (msg.payload.enhanceModel) {
            setEnhanceModel(msg.payload.enhanceModel);
          }
          break;

        case "auth/keySaved":
          setErrorBanner(null);
          setConfiguredKeys((prev) => [
            ...prev.filter(
              (k) =>
                !(
                  k.providerId === msg.payload.providerId &&
                  k.keySlot === msg.payload.keySlot
                )
            ),
            {
              providerId: msg.payload.providerId,
              keySlot: msg.payload.keySlot,
              maskedKey: msg.payload.maskedKey,
              enabledModels: [],
            },
          ]);
          break;

        case "auth/keyRemoved":
          setConfiguredKeys((prev) =>
            prev.filter(
              (k) =>
                !(
                  k.providerId === msg.payload.providerId &&
                  k.keySlot === msg.payload.keySlot
                )
            )
          );
          break;

        case "auth/keyError":
          setErrorBanner(
            `Key validation failed for ${msg.payload.providerId} [slot ${msg.payload.keySlot}]: ${msg.payload.message}`
          );
          break;

        case "enhance/stream":
          setIsEnhanceStreaming(true);
          setNarrative((prev) => prev + msg.payload.delta);
          break;

        case "enhance/result":
          setIsEnhanceStreaming(false);
          setNarrative(msg.payload.narrative);
          setProfile(msg.payload.profile);
          setEnhanceCostUsd(msg.payload.costUsd);
          break;

        case "enhance/phasesUpdated":
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  profileVersion: msg.payload.profileVersion,
                  phases: msg.payload.phases,
                }
              : null
          );
          if (msg.payload.problems && msg.payload.problems.length > 0) {
            setErrorBanner(
              `Phase validation issue: ${msg.payload.problems.map((p) => `${p.phaseId} (${p.problem})`).join(", ")}`
            );
          }
          break;

        case "enhance/profileFinalized":
          setProfile((prev) =>
            prev
              ? {
                  ...prev,
                  profileVersion: msg.payload.profileVersion,
                  finalizedAt: new Date().toISOString(),
                }
              : null
          );
          break;

        case "enhance/versionLoaded":
          setProfile(msg.payload.entry.profile);
          if (msg.payload.entry.narrative) {
            setNarrative(msg.payload.entry.narrative);
          }
          break;

        case "enhance/error":
          setIsEnhanceStreaming(false);
          setErrorBanner(`Enhance stage failed: ${msg.payload.message}`);
          break;

        case "estimate/result":
          setIsEstimating(false);
          setEstimation(msg.payload.result);
          break;

        case "estimate/error":
          setIsEstimating(false);
          setErrorBanner(`Estimation error: ${msg.payload.message}`);
          break;

        case "strategy/selection":
          setSelectedStrategyIds(msg.payload.selected.map((s) => s.strategyId));
          break;

        case "strategy/savingsUpdate":
          setSavings({
            build: msg.payload.build,
            runtime: msg.payload.runtime,
          });
          break;

        default:
          break;
      }
    });

    return unsubscribe;
  }, []);

  const navItems = [
    { id: "enhance" as TabId, label: "Enhance", icon: Sparkles },
    { id: "estimate" as TabId, label: "Estimate", icon: Calculator },
    { id: "optimize" as TabId, label: "Optimize", icon: Sliders },
    { id: "promptopt" as TabId, label: "Prompt Optimizer", icon: Wand },
    { id: "implement" as TabId, label: "Implement", icon: FolderGit2 },
    { id: "router" as TabId, label: "Router", icon: Route },
    { id: "settings" as TabId, label: "Settings", icon: Settings },
  ];

  const narrow = useNarrowLayout();
  const inPanel = hostView() === "panel";
  const openInEditor = () =>
    vscodeBridge.postMessage({ version: 1, type: "view/openInEditor", payload: {} });

  const currentProfileVersion = profile ? profile.profileVersion : 1;

  const configuredProviderIds = [...new Set(configuredKeys.map((k) => k.providerId))];
  const defaultModel = enhanceModel ?? pickDefaultModel(providers, models, configuredProviderIds);
  const catalog: CatalogViewData = {
    providers,
    models,
    pricing,
    strategies,
    routerPresets,
    isOffline,
  };
  const featureProps: FeatureViewProps = {
    catalog,
    selectedTechniqueIds: selectedStrategyIds,
    defaultModel,
    configuredProviderIds,
  };

  return (
    <div className="flex flex-col min-h-screen bg-slate-950 text-slate-100">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-20 px-3 py-2 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow-md shadow-indigo-500/20">
            TO
          </div>
          <span className="font-semibold text-xs tracking-tight text-slate-100 whitespace-nowrap">
            Token Optimizer
          </span>
          <span className="hidden sm:inline text-[10px] text-slate-400 font-mono bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
            {platform}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!inPanel && (
            <button
              onClick={openInEditor}
              title="Open in editor (full width)"
              aria-label="Open in editor"
              className="p-1 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isOffline === null ? (
            <span className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-full">
              <Wifi className="w-3 h-3" /> Catalog: checking
            </span>
          ) : isOffline ? (
            <span className="flex items-center gap-1 text-[11px] text-amber-400 bg-amber-950/40 border border-amber-800/40 px-2 py-0.5 rounded-full">
              <WifiOff className="w-3 h-3" />
              <span>
                {catalogPublishedAt
                  ? `Snapshot from ${new Date(catalogPublishedAt).toISOString().split("T")[0]}`
                  : "Offline Fallback"}
              </span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded-full">
              <Wifi className="w-3 h-3" /> Catalog Connected
            </span>
          )}
        </div>
      </header>

      {/* Global Error Notification Banner */}
      {errorBanner && (
        <div className="bg-rose-950/80 border-b border-rose-800/80 px-4 py-2 text-xs text-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            onClick={() => setErrorBanner(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tabs Navigation */}
      <nav
        aria-label="Token Optimizer tabs"
        data-testid="tab-bar"
        className="border-b border-slate-800/80 bg-slate-900/40 px-1.5 py-1.5 flex gap-0.5 overflow-x-auto"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          // Narrow pane: icon-only tabs (the active one keeps its label); tooltip + aria-label always.
          const showLabel = !narrow || isActive;

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 ${showLabel ? "px-2.5" : "px-1.5"} py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                isActive
                  ? "bg-slate-800 text-slate-100 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {showLabel && <span>{item.label}</span>}
              {item.id === "estimate" && profile?.finalizedAt && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Profile Finalized" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-3 sm:p-4 max-w-4xl mx-auto w-full min-w-0">
        {activeTab === "enhance" && (
          <EnhanceView
            profile={profile}
            narrative={narrative}
            isStreaming={isEnhanceStreaming}
            costUsd={enhanceCostUsd}
            enhanceModel={defaultModel}
            catalogPhases={catalogPhases}
            onProfileSelect={setProfile}
          />
        )}

        {activeTab === "estimate" && (
          <EstimateView
            estimation={estimation}
            isLoading={isEstimating}
            profileVersion={currentProfileVersion}
            profile={profile}
            catalogPhases={catalogPhases}
            models={models}
            pricing={pricing}
          />
        )}

        {activeTab === "optimize" && (
          <OptimizeView
            strategies={strategies}
            selectedStrategyIds={selectedStrategyIds}
            savings={savings}
            profileVersion={currentProfileVersion}
          />
        )}

        {activeTab === "implement" && (
          <ImplementView {...featureProps} />
        )}

        {activeTab === "promptopt" && <PromptOptimizerView {...featureProps} />}

        {activeTab === "router" && <RouterView {...featureProps} />}

        {activeTab === "settings" && (
          <SettingsView
            platform={platform}
            configuredKeys={configuredKeys}
            copilotAvailable={copilotAvailable}
            providers={providers}
            models={models}
          />
        )}
      </main>
    </div>
  );
};
