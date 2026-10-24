/**
 * Model Router tab: loads the router config (saved, else the catalog default preset), edits the
 * tier table and rules, previews live which model a sample prompt routes to (RouteDecision +
 * reason, using the unsaved edits), saves the config, and exports it into `ai_optimizer/`
 * through the same exporter as the Implement tab.
 *
 * Exports: RouterView
 * Feature: model router
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Route, Save, PackagePlus, RotateCcw } from "lucide-react";
import {
  defaultRouterPreset,
  presetToRouterConfig,
  type RouteDecision,
  type RouterConfig,
} from "@token-optimizer/core";
import { vscodeBridge } from "../protocol/vscode";
import type { FeatureViewProps } from "./viewProps";
import { RouterConfigEditor } from "../components/router/RouterConfigEditor";
import { ruleTechniques } from "../components/implement/proposalState";

const PREVIEW_DEBOUNCE_MS = 250;
const TIER_STYLE: Record<RouteDecision["tier"], string> = {
  economy: "bg-emerald-900/60 text-emerald-300",
  standard: "bg-indigo-900/60 text-indigo-200",
  advanced: "bg-violet-900/60 text-violet-200",
};

export const RouterView: React.FC<FeatureViewProps> = ({ catalog, selectedTechniqueIds }) => {
  const [config, setConfig] = useState<RouterConfig | null>(null);
  const [source, setSource] = useState<"saved" | "catalog-default" | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("Summarize this support ticket in two sentences.");
  const [needsTools, setNeedsTools] = useState(false);
  const [decision, setDecision] = useState<RouteDecision | null>(null);
  const previewSeq = useRef(0);
  const exportSeq = useRef(0);

  const loadConfig = (next: RouterConfig) => {
    setConfig(next);
    setEditorKey((k) => k + 1);
  };

  useEffect(() => {
    const off = vscodeBridge.onMessage((msg) => {
      switch (msg.type) {
        case "router/config":
          loadConfig(msg.payload.config);
          setSource(msg.payload.source);
          setDirty(false);
          break;
        case "router/previewResult":
          if (msg.payload.operationId === `preview-${previewSeq.current}`) {
            setDecision(msg.payload.decision);
            setHostError(null);
          }
          break;
        case "router/configSaved":
          setSavedAt(msg.payload.savedAt);
          setSource("saved");
          setDirty(false);
          break;
        case "router/error":
          if (!msg.payload.operationId || msg.payload.operationId === `preview-${previewSeq.current}`) {
            setDecision(null);
            setHostError(msg.payload.message);
          }
          break;
        case "implement/exported":
          if (msg.payload.operationId?.startsWith("router-export-")) {
            setExportInfo(`Exported ${msg.payload.filesWritten.length} files to ${msg.payload.targetDir}/`);
          }
          break;
      }
    });
    vscodeBridge.postMessage({ version: 1, type: "router/getConfig", payload: {} });
    return off;
  }, []);

  // Live "route this prompt" preview against the (possibly unsaved) config.
  useEffect(() => {
    if (!config) return;
    const timer = setTimeout(() => {
      const operationId = `preview-${++previewSeq.current}`;
      vscodeBridge.postMessage({
        version: 1,
        type: "router/preview",
        payload: { operationId, text: prompt, needsTools, config },
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [config, prompt, needsTools]);

  const preset = useMemo(() => defaultRouterPreset(catalog.routerPresets), [catalog.routerPresets]);
  const techniqueIds = useMemo(
    () => ruleTechniques(catalog.strategies).map((s) => s.id).filter((id) => selectedTechniqueIds.includes(id)),
    [catalog.strategies, selectedTechniqueIds]
  );

  const onEdit = (next: RouterConfig) => {
    setConfig(next);
    setDirty(true);
  };

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Route className="w-4 h-4 text-indigo-400" /> Model Router
      </h2>

      {!config && !hostError && <p className="text-xs text-slate-400">Loading router config…</p>}

      {config && (
        <div className="glass-panel p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-y-2">
            <span className="text-[11px] text-slate-400">
              {source === "saved" ? "Saved workspace config" : `Catalog preset "${config.presetId ?? "default"}"`}
              {dirty && " · unsaved changes"}
            </span>
            {preset && (
              <button
                type="button"
                onClick={() => {
                  loadConfig(presetToRouterConfig(preset));
                  setDirty(true);
                }}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-100"
              >
                <RotateCcw className="w-3 h-3" /> Reset to catalog preset
              </button>
            )}
          </div>
          <RouterConfigEditor key={editorKey} config={config} models={catalog.models} onChange={onEdit} />
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => vscodeBridge.postMessage({ version: 1, type: "router/saveConfig", payload: { config } })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white"
            >
              <Save className="w-3.5 h-3.5" /> Save config
            </button>
            <button
              type="button"
              onClick={() =>
                vscodeBridge.postMessage({
                  version: 1,
                  type: "implement/export",
                  payload: { operationId: `router-export-${++exportSeq.current}`, techniqueIds, routerConfig: config },
                })
              }
              className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100"
            >
              <PackagePlus className="w-3.5 h-3.5" /> Export to ai_optimizer
            </button>
          </div>
          {savedAt && !dirty && <p className="text-[11px] text-emerald-400">Saved {new Date(savedAt).toLocaleString()}</p>}
          {exportInfo && <p className="text-[11px] text-emerald-400">{exportInfo}</p>}
        </div>
      )}

      {config && (
        <div className="glass-panel p-4 rounded-xl border border-slate-800 space-y-2">
          <label className="block text-[11px] text-slate-300">
            Route this prompt
            <textarea
              aria-label="Prompt to route"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input type="checkbox" checked={needsTools} onChange={(e) => setNeedsTools(e.target.checked)} /> Request uses tools
          </label>
          {decision && (
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="route-decision">
              <span className={`px-2 py-0.5 rounded-full ${TIER_STYLE[decision.tier]}`}>{decision.tier}</span>
              <code className="text-slate-200">
                {decision.provider}/{decision.model}
              </code>
              <span className="text-[11px] text-slate-400">{decision.reason}</span>
            </div>
          )}
        </div>
      )}

      {hostError && <p className="text-xs text-amber-400">{hostError}</p>}
    </section>
  );
};
