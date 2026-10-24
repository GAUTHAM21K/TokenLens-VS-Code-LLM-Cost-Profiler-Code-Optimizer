/**
 * Technique checkboxes for the Prompt Optimizer: catalog techniques that carry `optimizer`
 * fields, grouped by mode (rule / llm), sorted by catalog order, each with its summary and
 * savings range.
 *
 * Exports: TechniquePicker, optimizerTechniques
 * Feature: prompt optimizer
 */
import React from "react";
import type { Strategy } from "@token-optimizer/core";

/** Catalog techniques usable by the prompt optimizer, in catalog `optimizer.order`. */
export function optimizerTechniques(strategies: Strategy[]): Strategy[] {
  return strategies
    .filter((s) => s.optimizer)
    .sort((a, b) => a.optimizer!.order - b.optimizer!.order);
}

const GROUPS: Array<{ mode: "rule" | "llm"; label: string }> = [
  { mode: "rule", label: "Rule techniques (local, deterministic)" },
  { mode: "llm", label: "LLM techniques (calls the selected model)" },
];

interface TechniquePickerProps {
  strategies: Strategy[];
  selected: string[];
  onToggle: (id: string) => void;
}

export const TechniquePicker: React.FC<TechniquePickerProps> = ({ strategies, selected, onToggle }) => {
  const techniques = optimizerTechniques(strategies);
  return (
    <div className="space-y-3">
      {GROUPS.map(({ mode, label }) => {
        const items = techniques.filter((t) => t.optimizer!.mode === mode);
        if (items.length === 0) return null;
        return (
          <fieldset key={mode} className="space-y-1">
            <legend className="text-[11px] uppercase tracking-wide text-slate-500">{label}</legend>
            {items.map((t) => (
              <label key={t.id} className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(t.id)}
                  onChange={() => onToggle(t.id)}
                  aria-label={t.name}
                />
                <span className="flex-1">
                  <span className="text-slate-200">{t.name}</span>{" "}
                  <span className="text-emerald-400">
                    {t.savings.minPercent}–{t.savings.maxPercent}% {t.optimizer!.affects}
                  </span>
                  <span className="block text-slate-500">{t.summary}</span>
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
};
