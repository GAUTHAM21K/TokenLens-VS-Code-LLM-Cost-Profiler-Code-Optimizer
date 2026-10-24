/**
 * Prompt Optimizer tab: paste a prompt, pick catalog techniques (rule / llm) and a model, run
 * (button or Ctrl/Cmd+Enter) -> `promptopt/run`; shows the host's `promptopt/result` (original vs
 * optimized, per-step tokens, $ per 1k calls, copy) and `promptopt/error` messages.
 *
 * Exports: PromptOptimizerView
 * Feature: prompt optimizer
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Wand, Play } from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import type { FeatureViewProps } from "./viewProps";
import { TechniquePicker, optimizerTechniques } from "../components/promptopt/TechniquePicker";
import { PromptOptResultPanel, type PromptOptResult } from "../components/promptopt/PromptOptResultPanel";

const DEFAULT_TECHNIQUES = ["whitespace-normalize", "filler-removal", "dedupe-sentences"];
const QUALITY_RETENTION: Record<string, number> = {
  "whitespace-normalize": 100,
  "filler-removal": 92,
  "dedupe-sentences": 95,
  "context-pruning": 85,
  "caveman-output": 80,
  "max-output-cap": 90,
  "terse-mode": 80,
};

const modelKey = (providerId: string, modelId: string) => `${providerId}::${modelId}`;

export const PromptOptimizerView: React.FC<FeatureViewProps> = ({
  catalog,
  selectedTechniqueIds,
  defaultModel,
  configuredProviderIds,
}) => {
  const techniques = useMemo(() => optimizerTechniques(catalog.strategies), [catalog.strategies]);
  const techniqueIds = useMemo(() => techniques.map((t) => t.id), [techniques]);

  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptOptResult | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const opId = useRef<string | null>(null);
  const opCounter = useRef(0);

  // Pre-select from the Optimize tab, else a safe rule-only default, once techniques arrive.
  useEffect(() => {
    if (selected.length > 0 || techniqueIds.length === 0) return;
    const fromOptimize = selectedTechniqueIds.filter((id) => techniqueIds.includes(id));
    setSelected(fromOptimize.length > 0 ? fromOptimize : DEFAULT_TECHNIQUES.filter((id) => techniqueIds.includes(id)));
  }, [selectedTechniqueIds, techniqueIds]);

  const modelOptions = useMemo(() => {
    const enabled = new Set(catalog.providers.filter((p) => p.enabled).map((p) => p.id));
    return catalog.models
      .filter((m) => m.status === "active" && enabled.has(m.providerId))
      .map((m) => {
        const hasKey = configuredProviderIds.includes(m.providerId);
        return {
          key: modelKey(m.providerId, m.id),
          providerId: m.providerId,
          modelId: m.id,
          label: `${m.label ?? m.id}${hasKey ? "" : " (no key)"}`,
          hasKey,
        };
      })
      .sort((a, b) => Number(b.hasKey) - Number(a.hasKey));
  }, [catalog.models, catalog.providers, configuredProviderIds]);

  useEffect(() => {
    if (model && modelOptions.some((o) => o.key === model)) return;
    const preferred = defaultModel && modelKey(defaultModel.providerId, defaultModel.modelId);
    const next = modelOptions.find((o) => o.key === preferred) ?? modelOptions[0];
    setModel(next ? next.key : "");
  }, [modelOptions, defaultModel, model]);

  useEffect(
    () =>
      vscodeBridge.onMessage((msg) => {
        if (msg.type !== "promptopt/result" && msg.type !== "promptopt/error") return;
        if (msg.payload.operationId && msg.payload.operationId !== opId.current) return;
        if (msg.type === "promptopt/result") setResult(msg.payload);
        else setHostError(msg.payload.message);
        setRunning(false);
      }),
    []
  );

  const chosen = modelOptions.find((o) => o.key === model);
  const needsLlm = selected.some((id) => techniques.find((t) => t.id === id)?.optimizer?.mode === "llm");
  const canRun = !running && prompt.trim() !== "" && selected.length > 0 && !!chosen;

  const run = () => {
    if (!canRun || !chosen) return;
    opCounter.current += 1;
    opId.current = `promptopt-${Date.now()}-${opCounter.current}`;
    setRunning(true);
    setHostError(null);
    setResult(null);
    vscodeBridge.postMessage({
      version: 1,
      type: "promptopt/run",
      payload: {
        operationId: opId.current,
        messages: [{ role: "user", content: prompt }],
        techniqueIds: techniqueIds.filter((id) => selected.includes(id)),
        providerId: chosen.providerId,
        modelId: chosen.modelId,
      },
    });
  };

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const names = Object.fromEntries(techniques.map((t) => [t.id, t.name]));
  const qualityRetention = selected.reduce(
    (score, id) => Math.min(score, QUALITY_RETENTION[id] ?? 100),
    100
  );

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <Wand className="w-4 h-4 text-indigo-400" /> Prompt Optimizer
      </h2>

      <textarea
        aria-label="Prompt"
        className="w-full h-36 text-xs bg-slate-900 border border-slate-700 rounded p-2 text-slate-100 font-mono"
        placeholder="Paste a prompt… (Ctrl/Cmd+Enter to run)"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run();
          }
        }}
      />

      {techniques.length === 0 ? (
        <p className="text-xs text-slate-400">No optimizer techniques in the catalog yet.</p>
      ) : (
        <TechniquePicker strategies={techniques} selected={selected} onToggle={toggle} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-400" htmlFor="promptopt-model">
          Model
        </label>
        <select
          id="promptopt-model"
          className="text-xs bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-100"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {modelOptions.length === 0 && <option value="">No models available</option>}
          {modelOptions.map((o) => (
            <option key={o.key} value={o.key}>
              {o.providerId} · {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={run}
          disabled={!canRun}
          className="ml-auto flex items-center gap-1 text-xs px-3 py-1 rounded bg-indigo-600 text-white disabled:opacity-40"
        >
          <Play className="w-3 h-3" /> {running ? "Optimizing…" : "Optimize"}
        </button>
      </div>
      {needsLlm && chosen && !chosen.hasKey && (
        <p className="text-xs text-amber-400">
          LLM techniques need an API key for {chosen.providerId} (Settings). Rule techniques still run.
        </p>
      )}

      {hostError && (
        <p className="text-xs text-amber-400" role="alert">
          {hostError}
        </p>
      )}
      {result && (
        <PromptOptResultPanel
          result={result}
          techniqueNames={names}
          qualityRetention={qualityRetention}
        />
      )}
    </section>
  );
};
