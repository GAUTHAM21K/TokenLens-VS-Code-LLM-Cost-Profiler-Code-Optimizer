/**
 * Enhance tab: describe the project (or pre-fill it from a workspace scan via enhance/prefill),
 * run Enhance, review/edit phases, history and finalize.
 *
 * Exports: VersionHistoryItem, Enhance
 * Feature: token cost estimator
 */
import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Terminal,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  Code2,
  History,
  GitCompare,
  Copy,
  Check,
  AlertTriangle,
  FolderSearch,
} from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import { formatCost } from "../utils/format";
import type {
  ProjectProfile,
  ConfirmedPhase,
  Phase as CatalogPhase,
  ProfileHistorySummary,
} from "@token-optimizer/core";

export interface VersionHistoryItem {
  version: number;
  profile: ProjectProfile;
  narrative: string;
  costUsd: number;
  createdAt: string;
  finalizedAt?: string;
}

interface EnhanceProps {
  profile: ProjectProfile | null;
  narrative: string;
  isStreaming: boolean;
  costUsd: number;
  enhanceModel?: {
    providerId: string;
    modelId: string;
    keySlot?: number;
  };
  catalogPhases?: CatalogPhase[];
  onProfileSelect?: (profile: ProjectProfile) => void;
  initialHistorySummaries?: ProfileHistorySummary[];
}

export const Enhance: React.FC<EnhanceProps> = ({
  profile,
  narrative,
  isStreaming,
  costUsd,
  enhanceModel,
  catalogPhases = [],
  onProfileSelect,
  initialHistorySummaries = [],
}) => {
  const [description, setDescription] = useState("");
  const [isPreFillLoading, setIsPreFillLoading] = useState(false);
  const [prefill, setPrefill] = useState<{ signals: string[]; error?: string } | null>(null);
  const [noModelHint, setNoModelHint] = useState(false);
  const [showJsonViewer, setShowJsonViewer] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // History hydration and caching (Principle II, XI)
  const [historySummaries, setHistorySummaries] = useState<ProfileHistorySummary[]>(initialHistorySummaries);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [cachedProfiles, setCachedProfiles] = useState<Record<number, ProjectProfile>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [diffVersionA, setDiffVersionA] = useState<number | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<number | null>(null);

  // Cache current active profile
  useEffect(() => {
    if (profile) {
      setCachedProfiles((prev) => ({
        ...prev,
        [profile.profileVersion]: profile,
      }));
    }
  }, [profile]);

  // Request history on mount and listen for host history hydration messages
  useEffect(() => {
    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/getHistory",
      payload: {},
    });

    const unsubscribe = vscodeBridge.onMessage((msg) => {
      if (msg.type === "enhance/historyLoaded") {
        setHistorySummaries(msg.payload.summaries);
        setIsHistoryLoading(false);
      } else if (msg.type === "enhance/versionLoaded") {
        setCachedProfiles((prev) => ({
          ...prev,
          [msg.payload.entry.version]: msg.payload.entry.profile,
        }));
      } else if (msg.type === "enhance/prefillResult") {
        setIsPreFillLoading(false);
        setPrefill({ signals: msg.payload.signals });
        const draft = msg.payload.description;
        if (draft) {
          setDescription((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${draft}` : draft));
        }
      } else if (msg.type === "enhance/prefillError") {
        setIsPreFillLoading(false);
        setPrefill({ signals: [], error: msg.payload.message });
      } else if (msg.type === "enhance/historyCleared") {
        setHistorySummaries([]);
        setCachedProfiles({});
        setIsHistoryLoading(false);
        setDiffVersionA(null);
        setDiffVersionB(null);
      }
    });

    return unsubscribe;
  }, []);

  // Key down handling: Enter creates newline, Ctrl/Cmd+Enter submits (Principle IX, T063)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleRunEnhance();
    }
  };

  const handleRunEnhance = () => {
    if (!description.trim() || isStreaming) return;
    // No hard-coded fallback model: App passes the user's pick or the first usable catalog model.
    if (!enhanceModel) {
      setNoModelHint(true);
      return;
    }
    setNoModelHint(false);
    const { providerId, modelId } = enhanceModel;

    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/run",
      payload: {
        description: description.trim(),
        providerId,
        modelId,
        keySlot: enhanceModel?.keySlot,
        previousProfileVersion: profile?.profileVersion,
      },
    });
  };

  // Workspace pre-fill: the host scans manifests/README (WorkspaceScanner) and answers
  // enhance/prefillResult | enhance/prefillError (handled in the message effect above).
  const handlePreFillScan = () => {
    setIsPreFillLoading(true);
    setPrefill(null);
    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/prefill",
      payload: { operationId: `prefill-${Date.now()}` },
    });
  };

  const handleFinalize = () => {
    if (!profile) return;
    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/finalize",
      payload: {
        profileVersion: profile.profileVersion,
      },
    });
  };

  // Phase editing (T133, T148, FR-052) - ZERO adapter calls
  const handlePhaseChange = (index: number, updated: Partial<ConfirmedPhase>) => {
    if (!profile) return;
    const nextPhases = [...profile.phases];
    nextPhases[index] = { ...nextPhases[index], ...updated };

    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/editPhases",
      payload: {
        profileVersion: profile.profileVersion,
        phases: nextPhases,
      },
    });
  };

  const handleAddPhase = () => {
    if (!profile) return;
    const defaultPhaseType = catalogPhases[0]?.id || "architecture";
    const defaultTrack = catalogPhases[0]?.track || "build";
    const newPhase: ConfirmedPhase = {
      id: `phase-${Date.now()}`,
      phaseTypeId: defaultPhaseType,
      track: defaultTrack,
      name: "New Pipeline Phase",
      source: "user",
      confirmed: true,
    };

    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/editPhases",
      payload: {
        profileVersion: profile.profileVersion,
        phases: [...profile.phases, newPhase],
      },
    });
  };

  const handleDeletePhase = (index: number) => {
    if (!profile) return;
    const nextPhases = profile.phases.filter((_, i) => i !== index);

    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/editPhases",
      payload: {
        profileVersion: profile.profileVersion,
        phases: nextPhases,
      },
    });
  };

  const copyProfileJson = () => {
    if (!profile) return;
    navigator.clipboard.writeText(JSON.stringify(profile, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  // Guard status for finalization
  const hasZeroPhases = !profile || profile.phases.length === 0;
  const hasUnconfirmedPhases = profile?.phases.some((p) => !p.confirmed) ?? false;
  const isFinalizeDisabled = hasZeroPhases || hasUnconfirmedPhases || Boolean(profile?.finalizedAt);

  // Compute diff between Version A and Version B using cached profiles
  const versionA = diffVersionA !== null ? cachedProfiles[diffVersionA] : null;
  const versionB = diffVersionB !== null ? cachedProfiles[diffVersionB] : null;

  const handleRestoreVersion = (version: number) => {
    const cached = cachedProfiles[version];
    if (cached) {
      onProfileSelect?.(cached);
    }
    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/getVersion",
      payload: { version },
    });
  };

  const handleSelectDiffA = (version: number) => {
    setDiffVersionA(version);
    if (!cachedProfiles[version]) {
      vscodeBridge.postMessage({
        version: 1,
        type: "enhance/getVersion",
        payload: { version },
      });
    }
  };

  const handleSelectDiffB = (version: number) => {
    setDiffVersionB(version);
    if (!cachedProfiles[version]) {
      vscodeBridge.postMessage({
        version: 1,
        type: "enhance/getVersion",
        payload: { version },
      });
    }
  };

  const handleClearHistory = () => {
    vscodeBridge.postMessage({
      version: 1,
      type: "enhance/clearHistory",
      payload: {},
    });
  };

  const handleToggleHistory = () => {
    setShowHistory(!showHistory);
  };

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <div className="glass-panel rounded-xl p-5 border border-slate-800 bg-slate-900/40">
        <div className="flex items-center justify-between flex-wrap gap-y-2 mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-semibold text-slate-100">Describe Your AI Feature</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handlePreFillScan}
              disabled={isPreFillLoading || isStreaming}
              className="text-xs text-indigo-300 hover:text-indigo-200 bg-indigo-950/60 hover:bg-indigo-900/60 px-2.5 py-1 rounded-md border border-indigo-800/60 flex items-center gap-1.5 transition-colors"
              title="Pre-fill draft from scanned workspace manifests and README"
            >
              <FolderSearch className="w-3.5 h-3.5" />
              <span>{isPreFillLoading ? "Scanning..." : "Scan Workspace"}</span>
            </button>
            <span className="hidden sm:inline text-[11px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              Ctrl+Enter to Run • Enter for newline
            </span>
          </div>
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. A multi-turn RAG chatbot for customer support with document retrieval, embedding generation, reranking, and agentic fallback..."
          rows={4}
          className="w-full bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none font-sans"
        />

        {prefill && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]" data-testid="prefill-signals">
            {prefill.error ? (
              <span className="text-amber-400">Workspace scan: {prefill.error}</span>
            ) : (
              prefill.signals.map((s) => (
                <span key={s} className="bg-slate-900 text-slate-400 border border-slate-800 px-2 py-0.5 rounded">
                  {s}
                </span>
              ))
            )}
          </div>
        )}

        <div className="mt-3 flex justify-between flex-wrap gap-y-2 items-center">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            {costUsd > 0 && (
              <span className="bg-emerald-950/60 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded font-mono font-medium">
                Est. prompt cost: {formatCost(costUsd)}
              </span>
            )}
            {enhanceModel && (
              <span className="text-slate-400">
                Model: <span className="text-slate-300 font-mono">{enhanceModel.providerId} / {enhanceModel.modelId}</span>
              </span>
            )}
            {!enhanceModel && (
              <span className={noModelHint ? "text-amber-400" : "text-slate-400"}>
                No model selected: add an API key and pick an Enhance model in Settings.
              </span>
            )}
          </div>
          <button
            onClick={handleRunEnhance}
            disabled={!description.trim() || isStreaming}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-indigo-900/20"
          >
            {isStreaming ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Enhancing...</span>
              </>
            ) : (
              <>
                <span>{profile ? "Refine Profile" : "Enhance Profile"}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Narrative Streaming Panel */}
      {(narrative || isStreaming) && (
        <div className="glass-panel rounded-xl p-5 border border-slate-800 bg-slate-900/40">
          <div className="flex items-center justify-between flex-wrap gap-y-2 mb-3 text-slate-300 font-semibold text-sm">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span>Architecture Narrative</span>
            </div>
            {isStreaming && (
              <span className="text-[11px] text-indigo-400 font-mono animate-pulse">
                Streaming response...
              </span>
            )}
          </div>
          <div className="bg-slate-950/90 border border-slate-800/80 rounded-lg p-4 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
            {narrative}
            {isStreaming && (
              <span className="inline-block w-2 h-4 bg-indigo-400 ml-1 animate-pulse align-middle" />
            )}
          </div>
        </div>
      )}

      {/* Extracted Profile and Editable Phases */}
      {profile && (
        <div className="glass-panel rounded-xl p-5 border border-slate-800 bg-slate-900/40 space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-y-2">
            <div className="flex items-center gap-2.5">
              <CheckCircle2
                className={`w-5 h-5 ${
                  profile.finalizedAt ? "text-emerald-400" : "text-indigo-400"
                }`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-100">
                    Project Profile v{profile.profileVersion}
                  </h3>
                  {profile.finalizedAt ? (
                    <span className="bg-emerald-950/60 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded text-[10px] font-semibold">
                      Finalized
                    </span>
                  ) : (
                    <span className="bg-amber-950/60 text-amber-400 border border-amber-800/60 px-2 py-0.5 rounded text-[10px] font-semibold">
                      Draft
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Type: <span className="text-slate-300 font-mono">{profile.projectType}</span> • Scale:{" "}
                  <span className="text-slate-300 font-mono">{profile.scale.requestsPerDay} req/day</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowJsonViewer(!showJsonViewer)}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-700"
              >
                <Code2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{showJsonViewer ? "Hide JSON" : "View JSON"}</span>
              </button>

              <button
                onClick={handleToggleHistory}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors border border-slate-700"
              >
                <History className="w-3.5 h-3.5 text-indigo-400" />
                <span>History ({historySummaries.length})</span>
              </button>

              {!profile.finalizedAt && (
                <button
                  onClick={handleFinalize}
                  disabled={isFinalizeDisabled}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-sm"
                  title={
                    hasZeroPhases
                      ? "Requires at least one phase to finalize"
                      : hasUnconfirmedPhases
                      ? "All phases must be confirmed before finalization"
                      : "Finalize profile and enable estimation"
                  }
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Finalize Profile</span>
                </button>
              )}
            </div>
          </div>

          {/* Validation Refusal Warning Banner */}
          {!profile.finalizedAt && (hasZeroPhases || hasUnconfirmedPhases) && (
            <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg p-3 text-xs text-amber-200 flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {hasZeroPhases
                  ? "At least one phase is required to finalize this profile."
                  : "All pipeline phases must be verified and checked (confirmed) before finalization can unlock estimation."}
              </span>
            </div>
          )}

          {/* Architecture Overview */}
          <div className="bg-slate-950/60 p-3.5 rounded-lg border border-slate-800/80 text-xs text-slate-300 leading-relaxed">
            <span className="text-slate-400 block font-medium mb-1">Architecture Overview</span>
            <p>{profile.overview}</p>
          </div>

          {/* Editable Pipeline Phases Table (T133, FR-052) */}
          <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950/70">
            <div className="bg-slate-900/80 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between flex-wrap gap-y-2">
              <div>
                <span className="text-xs font-semibold text-slate-200 block">
                  Pipeline Phases (Confirmed: {profile.phases.filter((p) => p.confirmed).length}/{profile.phases.length})
                </span>
                <span className="text-[11px] text-slate-400">
                  Editing phases updates the profile immediately with zero LLM calls.
                </span>
              </div>
              <button
                onClick={handleAddPhase}
                className="px-2.5 py-1 bg-indigo-600/80 hover:bg-indigo-500 text-white rounded text-xs font-medium flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Phase</span>
              </button>
            </div>

            <div className="divide-y divide-slate-800/70">
              {profile.phases.map((phase, idx) => (
                <div
                  key={phase.id}
                  className="p-3 flex items-center gap-3 text-xs hover:bg-slate-900/30 transition-colors"
                >
                  <label
                    className="flex items-center gap-1.5 cursor-pointer shrink-0"
                    title="Confirm phase"
                  >
                    <input
                      type="checkbox"
                      checked={phase.confirmed}
                      onChange={(e) => handlePhaseChange(idx, { confirmed: e.target.checked })}
                      className="rounded border-slate-700 text-indigo-600 focus:ring-indigo-500 bg-slate-900 cursor-pointer"
                    />
                    <span
                      className={`text-[11px] font-medium ${
                        phase.confirmed ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {phase.confirmed ? "Confirmed" : "Unconfirmed"}
                    </span>
                  </label>

                  {/* Phase Name Input */}
                  <input
                    type="text"
                    value={phase.name}
                    onChange={(e) => handlePhaseChange(idx, { name: e.target.value })}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 font-medium text-xs focus:outline-none focus:border-indigo-500"
                    placeholder="Phase name"
                  />

                  {/* Track Selector */}
                  <select
                    value={phase.track}
                    onChange={(e) =>
                      handlePhaseChange(idx, { track: e.target.value as "build" | "runtime" })
                    }
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500"
                  >
                    <option value="build">BUILD track</option>
                    <option value="runtime">RUNTIME track</option>
                  </select>

                  {/* Phase Type ID Selector */}
                  <select
                    value={phase.phaseTypeId}
                    onChange={(e) => handlePhaseChange(idx, { phaseTypeId: e.target.value })}
                    className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-300 text-xs focus:outline-none focus:border-indigo-500 max-w-[150px]"
                  >
                    {catalogPhases.length > 0 ? (
                      catalogPhases.map((cp) => (
                        <option key={cp.id} value={cp.id}>
                          {cp.name} ({cp.id})
                        </option>
                      ))
                    ) : (
                      <option value={phase.phaseTypeId}>{phase.phaseTypeId}</option>
                    )}
                  </select>

                  {/* Source Badge */}
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                    {phase.source}
                  </span>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDeletePhase(idx)}
                    className="text-slate-500 hover:text-rose-400 p-1 rounded transition-colors"
                    title="Delete phase"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              {profile.phases.length === 0 && (
                <div className="p-4 text-center text-xs text-slate-500">
                  No pipeline phases configured. Click "Add Phase" to add one.
                </div>
              )}
            </div>
          </div>

          {/* Collapsible JSON Viewer */}
          {showJsonViewer && (
            <div className="bg-slate-950 rounded-lg border border-slate-800 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-mono">ProjectProfile Schema v{profile.schemaVersion}</span>
                <button
                  onClick={copyProfileJson}
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {copiedJson ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy JSON</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-slate-900/90 rounded p-3 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-72 border border-slate-800">
                {JSON.stringify(profile, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Version History & Two-Version Diff (T063, History Hydration) */}
      {showHistory && (
        <div className="glass-panel rounded-xl p-5 border border-slate-800 bg-slate-900/50 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-y-2">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-100">Version History & Diff</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleClearHistory}
                disabled={historySummaries.length === 0 || isHistoryLoading}
                className="px-2.5 py-1 bg-rose-950/40 hover:bg-rose-900/40 border border-rose-800/40 disabled:opacity-40 disabled:cursor-not-allowed text-rose-300 rounded text-xs font-medium flex items-center gap-1 transition-colors"
                title="Clear all stored profile history"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
              <span className="text-xs text-slate-400">
                {historySummaries.length} versions recorded
              </span>
            </div>
          </div>

          {isHistoryLoading ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Loading version history...</span>
            </div>
          ) : historySummaries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-slate-800/60">
              No saved profile versions found. Generate or refine a profile to create versions.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              {/* Version List */}
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {[...historySummaries]
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <div
                      key={v.version}
                      className={`p-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                        profile?.profileVersion === v.version
                          ? "border-indigo-600 bg-indigo-950/30"
                          : "border-slate-800 bg-slate-950/60 hover:bg-slate-900"
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200">v{v.version}</span>
                          {v.finalizedAt && (
                            <span className="text-[10px] text-emerald-400 font-mono">Finalized</span>
                          )}
                          {v.costUsd !== undefined && v.costUsd > 0 && (
                            <span className="text-[10px] text-slate-400 font-mono">${v.costUsd.toFixed(4)}</span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {new Date(v.createdAt).toLocaleTimeString()} • Phases: {v.phaseCount}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRestoreVersion(v.version)}
                          className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => handleSelectDiffA(v.version)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            diffVersionA === v.version
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-800 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          A
                        </button>
                        <button
                          onClick={() => handleSelectDiffB(v.version)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            diffVersionB === v.version
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-800 text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          B
                        </button>
                      </div>
                    </div>
                  ))}
              </div>

              {/* Two-Version Comparison Panel */}
              <div className="bg-slate-950/80 rounded-lg border border-slate-800 p-3 flex flex-col justify-between">
                <div>
                  <span className="font-semibold text-slate-300 block mb-2">
                    Diff: Version {diffVersionA || "—"} vs Version {diffVersionB || "—"}
                  </span>
                  {versionA && versionB ? (
                    <div className="space-y-2 text-[11px] font-mono">
                      <div className="bg-slate-900 p-2 rounded border border-slate-800 space-y-1">
                        <div>
                          Phases: v{versionA.profileVersion} ({versionA.phases.length}) → v{versionB.profileVersion} ({versionB.phases.length})
                        </div>
                        <div>
                          Scale: {versionA.scale.requestsPerDay} → {versionB.scale.requestsPerDay} req/day
                        </div>
                        <div>
                          Components: {versionA.components.length} → {versionB.components.length}
                        </div>
                      </div>
                    </div>
                  ) : diffVersionA !== null && diffVersionB !== null ? (
                    <p className="text-slate-400 text-xs italic">
                      Loading profile details for diff comparison...
                    </p>
                  ) : (
                    <p className="text-slate-500 text-xs italic">
                      Select version A and version B using the buttons on the left to see comparison.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
