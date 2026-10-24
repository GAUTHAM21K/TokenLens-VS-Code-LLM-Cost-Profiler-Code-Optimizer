/**
 * Result panel of the Prompt Optimizer: original vs optimized side by side, token and $ totals
 * for the selected model, the per-technique step breakdown, and a copy button.
 *
 * Exports: PromptOptResultPanel, PromptOptResult, messagesToText
 * Feature: prompt optimizer
 */
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { HostToWebviewMsg, PromptMessage } from "@token-optimizer/core";

export type PromptOptResult = Extract<HostToWebviewMsg, { type: "promptopt/result" }>["payload"];

/** A single user message shows as its plain content; otherwise each message gets a [role] header. */
export function messagesToText(messages: PromptMessage[]): string {
  if (messages.length === 1 && messages[0]!.role === "user") return messages[0]!.content;
  return messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
}

const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
const pct = (before: number, after: number) => (before > 0 ? ((before - after) / before) * 100 : 0);

interface Props {
  result: PromptOptResult;
  techniqueNames: Record<string, string>;
  qualityRetention?: number;
}

export const PromptOptResultPanel: React.FC<Props> = ({ result, techniqueNames, qualityRetention = 100 }) => {
  const [copied, setCopied] = useState(false);
  const optimizedText = messagesToText(result.optimized.messages);
  const saved = result.original.inputTokens - result.optimized.inputTokens;
  const approx = result.tokenLabel === "approximate" ? "≈" : "";
  const { cost } = result;
  const maxTokens = result.optimized.params.max_tokens;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(optimizedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="promptopt-result">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <div className="text-[11px] text-slate-500 mb-1">
            Original · {approx}
            {result.original.inputTokens} tokens
          </div>
          <pre className="whitespace-pre-wrap break-words text-xs bg-slate-900 border border-slate-800 rounded p-2 max-h-72 overflow-auto">
            {messagesToText(result.original.messages)}
          </pre>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1 flex items-center justify-between">
            <span>
              Optimized · {approx}
              {result.optimized.inputTokens} tokens
              {maxTokens !== undefined && ` · max_tokens ${maxTokens}`}
            </span>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
              aria-label="Copy optimized prompt"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre
            className="whitespace-pre-wrap break-words text-xs bg-slate-900 border border-emerald-900 rounded p-2 max-h-72 overflow-auto"
            data-testid="promptopt-optimized"
          >
            {optimizedText}
          </pre>
        </div>
      </div>

      <div className="text-xs text-slate-300 space-y-0.5" data-testid="promptopt-totals">
        <div>
          Input tokens saved:{" "}
          <span className="text-emerald-400 font-semibold">
            {approx}
            {saved} ({pct(result.original.inputTokens, result.optimized.inputTokens).toFixed(1)}%)
          </span>{" "}
          <span className="text-slate-500">({result.tokenLabel})</span>
        </div>
        <div className={qualityRetention < 85 ? "text-amber-300" : "text-slate-300"}>
          Estimated quality retention: <span className="font-semibold">{qualityRetention}%</span>
          {qualityRetention < 85 && <span role="alert"> · Review aggressive compression</span>}
        </div>
        {cost && (
          <div>
            Per 1k calls on {cost.modelId}: {usd(cost.usdPer1kCallsBefore)} → {usd(cost.usdPer1kCallsAfter)}{" "}
            <span className="text-emerald-400">
              (saves {usd(cost.usdPer1kCallsBefore - cost.usdPer1kCallsAfter)},{" "}
              {pct(cost.usdPer1kCallsBefore, cost.usdPer1kCallsAfter).toFixed(1)}%)
            </span>
            <span className="block text-slate-500">
              Assumes {cost.outputTokensBefore} → {cost.outputTokensAfter} output tokens per call; $
              {cost.inputPerMTok} in / ${cost.outputPerMTok} out per MTok.
            </span>
          </div>
        )}
        {result.llmUsage && (
          <div className="text-slate-500">
            LLM rewrite cost: {result.llmUsage.inputTokens} in / {result.llmUsage.outputTokens} out tokens (
            {usd(result.llmUsage.costUsd)}).
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="promptopt-steps">
          <thead>
            <tr className="text-slate-500 text-left">
              <th className="font-normal">Step</th>
              <th className="font-normal">Mode</th>
              <th className="font-normal text-right">Tokens before → after</th>
              <th className="font-normal text-right">Δ</th>
            </tr>
          </thead>
          <tbody>
            {result.steps.map((s, i) => (
              <tr key={`${s.techniqueId}-${i}`} className="border-t border-slate-800">
                <td className="py-1">
                  {i + 1}. {techniqueNames[s.techniqueId] ?? s.techniqueId}
                  {!s.applied && <span className="text-slate-500"> (no change)</span>}
                  {s.note && <span className="block text-amber-400">{s.note}</span>}
                </td>
                <td>{s.mode}</td>
                <td className="text-right">
                  {s.inputTokensBefore} → {s.inputTokensAfter}
                </td>
                <td className="text-right text-emerald-400">{s.inputTokensAfter - s.inputTokensBefore || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-slate-500">Token counts are {result.tokenLabel} for this model.</p>
    </div>
  );
};
