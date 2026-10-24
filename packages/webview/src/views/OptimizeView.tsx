/**
 * Optimize tab: technique selection for the estimator. Selection state comes from the host's
 * `strategy/selection` (App passes the selected ids; this view keeps the reasons, the
 * not-pre-selected explanations and conflicts). Toggling sends `strategy/set`; mounting or
 * "Re-evaluate" sends `strategy/evaluate` for the current profile. Shows compounded savings.
 *
 * Exports: OptimizeView
 * Feature: token cost estimator (techniques savings)
 */
import React, { useState, useEffect } from "react";
import { Sliders, Percent, AlertTriangle, RefreshCw } from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import type { Strategy, SavingsRange } from "@token-optimizer/core";

interface OptimizeViewProps {
  strategies: Strategy[];
  selectedStrategyIds: string[];
  savings: {
    build: SavingsRange;
    runtime: SavingsRange;
  } | null;
  profileVersion?: number;
}

interface SelectionDetails {
  reasons: Record<string, string>;
  conflicts: Array<{ a: string; b: string; explanation: string }>;
}

export const OptimizeView: React.FC<OptimizeViewProps> = ({
  strategies,
  selectedStrategyIds,
  savings,
  profileVersion,
}) => {
  const [details, setDetails] = useState<SelectionDetails>({ reasons: {}, conflicts: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      vscodeBridge.onMessage((msg) => {
        if (msg.type === "strategy/selection") {
          const reasons: Record<string, string> = {};
          for (const s of [...msg.payload.notPreselected, ...msg.payload.selected]) {
            reasons[s.strategyId] = s.reason;
          }
          setDetails({ reasons, conflicts: msg.payload.conflicts });
          setPending(false);
          setError(null);
        } else if (msg.type === "strategy/error") {
          setPending(false);
          setError(msg.payload.message);
        }
      }),
    []
  );

  const evaluate = () => {
    if (!profileVersion) return;
    setPending(true);
    vscodeBridge.postMessage({ version: 1, type: "strategy/evaluate", payload: { profileVersion } });
  };

  useEffect(evaluate, [profileVersion]);

  const toggleStrategy = (id: string) => {
    const next = selectedStrategyIds.includes(id)
      ? selectedStrategyIds.filter((s) => s !== id)
      : [...selectedStrategyIds, id];
    setPending(true);
    vscodeBridge.postMessage({ version: 1, type: "strategy/set", payload: { selectedIds: next } });
  };

  const nameOf = (id: string) => strategies.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      {/* Header and Savings Overview */}
      <div className="glass-panel p-5 rounded-xl border border-slate-800">
        <div className="flex items-center justify-between flex-wrap gap-y-2 mb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Strategy Selection</h2>
              <p className="text-xs text-slate-400">
                Pre-selected from your profile • conservative compounded savings
              </p>
            </div>
          </div>
          <button
            onClick={evaluate}
            disabled={!profileVersion || pending}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            title="Re-run applicability for the current profile (keeps your selection)"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pending ? "animate-spin" : ""}`} />
            Re-evaluate
          </button>
        </div>

        {!profileVersion && (
          <p className="text-xs text-slate-500 pb-2">Run Enhance first to pre-select techniques for your profile.</p>
        )}
        {error && <p className="text-xs text-amber-400 pb-2" role="alert">{error}</p>}

        {savings ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-800">
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-1">Runtime Savings</span>
              <div className="text-lg font-bold text-emerald-400">
                {savings.runtime.minPercent}% – {savings.runtime.maxPercent}%
              </div>
              <span className="text-[10px] text-slate-500">{savings.runtime.basis}</span>
            </div>
            <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
              <span className="text-[11px] text-slate-400 block mb-1">Build / Iteration Savings</span>
              <div className="text-lg font-bold text-indigo-300">
                {savings.build.minPercent}% – {savings.build.maxPercent}%
              </div>
              <span className="text-[10px] text-slate-500">{savings.build.basis}</span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-slate-500 pt-2 border-t border-slate-800 flex items-center gap-1.5">
            <Percent className="w-3.5 h-3.5" /> Select techniques below to compute compounded savings.
          </div>
        )}

        {details.conflicts.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label="Technique conflicts">
            {details.conflicts.map((c) => (
              <li key={`${c.a}|${c.b}`} className="text-xs text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {nameOf(c.a)} / {nameOf(c.b)}: {c.explanation}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Techniques List */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Catalog Techniques ({strategies.length})
        </h3>

        {strategies.length > 0 ? (
          <div className="space-y-2">
            {strategies.map((strategy) => {
              const isSelected = selectedStrategyIds.includes(strategy.id);
              const reason = details.reasons[strategy.id];
              return (
                <div
                  key={strategy.id}
                  onClick={() => toggleStrategy(strategy.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    isSelected
                      ? "border-indigo-500/60 bg-indigo-950/20"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        aria-label={strategy.name}
                        onChange={() => {}} // handled by parent onClick
                        className="rounded border-slate-700 text-indigo-600 focus:ring-0 bg-slate-950"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-200">
                            {strategy.name}
                          </span>
                          <span className="text-[10px] font-mono uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
                            {strategy.group}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                          {strategy.summary}
                        </p>
                        {reason && (
                          <p
                            className={`text-[11px] mt-1 ${isSelected ? "text-emerald-300" : "text-slate-500"}`}
                            data-testid={`reason-${strategy.id}`}
                          >
                            {reason}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right pl-4">
                      <span className="text-xs font-semibold text-emerald-400">
                        {strategy.savings.minPercent}–{strategy.savings.maxPercent}%
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {strategy.savings.appliesTo ?? "estimated"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-panel p-8 rounded-xl border border-slate-800 text-center text-xs text-slate-500">
            No strategies discovered yet. Connect catalog or use the bundled snapshot.
          </div>
        )}
      </div>
    </div>
  );
};
