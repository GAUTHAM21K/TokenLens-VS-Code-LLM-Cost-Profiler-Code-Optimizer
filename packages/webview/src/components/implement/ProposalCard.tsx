/**
 * One Implement block: file:line, pattern/feature badges, original vs modified preview, the
 * import lines it adds, its status, and Apply / Skip / Open diff actions.
 *
 * Exports: BlockStatus, ProposalRow, ProposalCard
 * Feature: implement optimization
 */
import React from "react";
import { Check, FileDiff, SkipForward, Loader2 } from "lucide-react";
import type { ImplementEditProposal } from "@token-optimizer/core";

export type BlockStatus = "pending" | "applying" | "applied" | "skipped" | "stale" | "failed";

export interface ProposalRow {
  proposal: ImplementEditProposal;
  status: BlockStatus;
  message?: string;
}

const STATUS_STYLE: Record<BlockStatus, string> = {
  pending: "bg-slate-800 text-slate-300",
  applying: "bg-indigo-900/60 text-indigo-200",
  applied: "bg-emerald-900/60 text-emerald-300",
  skipped: "bg-slate-800 text-slate-500",
  stale: "bg-amber-900/60 text-amber-300",
  failed: "bg-rose-900/60 text-rose-300",
};

const PATTERN_LABEL: Record<ImplementEditProposal["pattern"], string> = {
  agent: "P1 agent",
  invoke: "P2 invoke",
  construction: "P3 router",
};

interface Props {
  row: ProposalRow;
  busy: boolean;
  onApply: () => void;
  onSkip: () => void;
  onDiff: () => void;
}

export const ProposalCard: React.FC<Props> = ({ row, busy, onApply, onSkip, onDiff }) => {
  const { proposal: p, status, message } = row;
  const actionable = status === "pending" || status === "failed";
  return (
    <li className="p-3 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2" data-testid="proposal">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <code className="text-xs text-indigo-300 truncate">
            {p.file}:{p.range.startLine + 1}
          </code>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{PATTERN_LABEL[p.pattern]}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{p.feature}</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`} data-testid="status">
          {status === "applying" && <Loader2 className="inline w-3 h-3 mr-1 animate-spin" />}
          {status}
        </span>
      </div>
      {p.description && <p className="text-[11px] text-slate-400">{p.description}</p>}
      <div className="grid grid-cols-1 gap-2">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Original</span>
          <pre className="text-[11px] leading-snug p-2 rounded bg-rose-950/30 border border-rose-900/40 text-slate-300 overflow-x-auto whitespace-pre">
            {p.original}
          </pre>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Modified</span>
          <pre className="text-[11px] leading-snug p-2 rounded bg-emerald-950/30 border border-emerald-900/40 text-slate-200 overflow-x-auto whitespace-pre">
            {p.modified}
          </pre>
        </div>
        {p.importsToAdd.length > 0 && (
          <pre className="text-[11px] p-2 rounded bg-slate-950/60 border border-slate-800 text-emerald-300/80 overflow-x-auto whitespace-pre">
            {p.importsToAdd.map((l) => `+ ${l}`).join("\n")}
          </pre>
        )}
      </div>
      {message && <p className="text-[11px] text-slate-400">{message}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onApply}
          disabled={!actionable || busy}
          className="flex items-center gap-1 px-3 py-1 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
        >
          <Check className="w-3.5 h-3.5" /> Apply
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={!actionable || busy}
          className="flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
        >
          <SkipForward className="w-3.5 h-3.5" /> Skip
        </button>
        <button
          type="button"
          onClick={onDiff}
          disabled={status === "applied" || status === "stale"}
          className="flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200"
        >
          <FileDiff className="w-3.5 h-3.5" /> Open diff
        </button>
      </div>
    </li>
  );
};
