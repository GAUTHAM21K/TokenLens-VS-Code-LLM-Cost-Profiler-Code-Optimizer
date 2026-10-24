/**
 * Editable RouterConfig: tier table (economy / standard / advanced) with ordered candidate models
 * (first = routed model; add from the catalog, move up, remove) and the routing rules
 * (economy length limit, advanced keywords, tools minimum tier, default tier).
 *
 * Exports: RouterConfigEditor, parseKeywords
 * Feature: model router
 */
import React, { useState } from "react";
import { ArrowUp, Plus, X } from "lucide-react";
import { ROUTER_TIERS, type Model, type RouterConfig, type RouterTier } from "@token-optimizer/core";

interface Props {
  config: RouterConfig;
  models: Model[];
  onChange: (config: RouterConfig) => void;
}

/** Comma/newline separated keywords, trimmed, empty and duplicate entries dropped. */
export function parseKeywords(text: string): string[] {
  const out: string[] = [];
  for (const k of text.split(/[,\n]/).map((s) => s.trim())) if (k && !out.includes(k)) out.push(k);
  return out;
}

const TIER_HINT: Record<RouterTier, string> = {
  economy: "short prompts, no tools",
  standard: "default / tool use",
  advanced: "keyword-triggered reasoning",
};

const TierRow: React.FC<{ tier: RouterTier } & Props> = ({ tier, config, models, onChange }) => {
  const [adding, setAdding] = useState("");
  const list = config.tiers[tier];
  const setList = (next: RouterConfig["tiers"][RouterTier]) =>
    onChange({ ...config, tiers: { ...config.tiers, [tier]: next } });
  const options = models.filter((m) => !list.some((c) => c.providerId === m.providerId && c.modelId === m.id));
  return (
    <tr className="border-t border-slate-800 align-top" data-testid={`tier-${tier}`}>
      <td className="py-2 pr-2">
        <div className="text-xs font-semibold text-slate-200 capitalize">{tier}</div>
        <div className="text-[10px] text-slate-500">{TIER_HINT[tier]}</div>
      </td>
      <td className="py-2 space-y-1">
        {list.length === 0 && <div className="text-[11px] text-slate-500">empty (falls back to the next tier)</div>}
        {list.map((c, i) => (
          <div key={`${c.providerId}/${c.modelId}`} className="flex items-center gap-1 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded ${i === 0 ? "bg-indigo-900/60 text-indigo-200" : "bg-slate-800 text-slate-300"}`}>
              {c.providerId}/{c.modelId}
            </span>
            <button
              type="button"
              aria-label={`Move ${c.modelId} up`}
              disabled={i === 0}
              onClick={() => setList([list[i], ...list.slice(0, i), ...list.slice(i + 1)])}
              className="p-0.5 text-slate-400 hover:text-slate-100 disabled:opacity-30"
            >
              <ArrowUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              aria-label={`Remove ${c.modelId}`}
              onClick={() => setList(list.filter((_, j) => j !== i))}
              className="p-0.5 text-slate-400 hover:text-rose-300"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <select
            aria-label={`Add model to ${tier}`}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            className="text-[11px] bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 max-w-[12rem]"
          >
            <option value="">Add model…</option>
            {options.map((m) => (
              <option key={`${m.providerId}/${m.id}`} value={`${m.providerId}\u0000${m.id}`}>
                {m.providerId}/{m.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Add to ${tier}`}
            disabled={!adding}
            onClick={() => {
              const [providerId, modelId] = adding.split("\u0000");
              setList([...list, { providerId, modelId }]);
              setAdding("");
            }}
            className="p-0.5 text-slate-400 hover:text-emerald-300 disabled:opacity-30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
};

export const RouterConfigEditor: React.FC<Props> = (props) => {
  const { config, onChange } = props;
  const [keywordText, setKeywordText] = useState(config.rules.advancedKeywords.join(", "));
  const setRules = (rules: Partial<RouterConfig["rules"]>) => onChange({ ...config, rules: { ...config.rules, ...rules } });
  const tierSelect = (label: string, value: RouterTier, key: "needsToolsMinTier" | "defaultTier") => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => setRules({ [key]: e.target.value as RouterTier })}
        className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200"
      >
        {ROUTER_TIERS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full">
          <tbody>
            {ROUTER_TIERS.map((t) => (
              <TierRow key={t} tier={t} {...props} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 pt-2 border-t border-slate-800">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Rules (in order)</span>
        <label className="block text-[11px] text-slate-300">
          1. Advanced keywords (case-insensitive, whole word)
          <input
            aria-label="Advanced keywords"
            value={keywordText}
            onChange={(e) => {
              setKeywordText(e.target.value);
              setRules({ advancedKeywords: parseKeywords(e.target.value) });
            }}
            className="mt-1 w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
          2. Economy if prompt ≤ chars (and no tools)
          <input
            aria-label="Max chars for economy"
            type="number"
            min={0}
            value={config.rules.maxCharsForEconomy}
            onChange={(e) => setRules({ maxCharsForEconomy: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-slate-200"
          />
        </label>
        {tierSelect("3. Default tier", config.rules.defaultTier, "defaultTier")}
        {tierSelect("4. Tool calls need at least", config.rules.needsToolsMinTier, "needsToolsMinTier")}
      </div>
    </div>
  );
};
