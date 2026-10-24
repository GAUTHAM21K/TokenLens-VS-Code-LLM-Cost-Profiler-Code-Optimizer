/**
 * Popover rendering an estimation explain tree (formula, inputs, result).
 *
 * Exports: ExplainPopoverProps, ExplainPopover
 * Feature: token cost estimator
 */
import React, { useEffect, useState } from "react";
import { HelpCircle, X, ChevronDown, ChevronRight, Calculator } from "lucide-react";
import type { ExplainNode } from "@token-optimizer/core";

export interface ExplainPopoverProps {
  node: ExplainNode | null;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
}

interface NodeViewProps {
  node: ExplainNode;
  depth?: number;
  isRoot?: boolean;
}

const NodeView: React.FC<NodeViewProps> = ({ node, depth = 0, isRoot = false }) => {
  const [expanded, setExpanded] = useState<boolean>(true);
  const hasChildren = Boolean(node.children && node.children.length > 0);

  return (
    <div
      className={`border rounded-lg p-3 ${
        isRoot
          ? "border-indigo-500/40 bg-indigo-950/20"
          : "border-slate-800 bg-slate-900/40 mt-2"
      }`}
      style={{ marginLeft: isRoot ? 0 : `${Math.min(depth * 12, 36)}px` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {hasChildren && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-0.5 text-slate-400 hover:text-slate-200 transition-colors"
              aria-label={expanded ? "Collapse step" : "Expand step"}
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <span className="font-semibold text-xs text-slate-200 truncate">
            {node.label}
          </span>
        </div>
        <div className="font-mono text-xs font-bold text-indigo-400 whitespace-nowrap">
          = {typeof node.result === "number" ? Number(node.result.toFixed(4)) : node.result}
        </div>
      </div>

      {/* Formula String (FR-022: every leaf and branch node shows formula string) */}
      <div className="mt-1.5 bg-slate-950/80 rounded px-2 py-1 font-mono text-[11px] text-amber-300/90 border border-slate-800/80">
        <span className="text-slate-500 mr-1.5 select-none">formula:</span>
        <code>{node.formula}</code>
      </div>

      {/* Inputs Table */}
      {node.inputs && Object.keys(node.inputs).length > 0 && (
        <div className="mt-2 text-[11px]">
          <span className="text-slate-400 font-medium block mb-0.5">Inputs:</span>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 bg-slate-900/60 p-1.5 rounded border border-slate-800/60 font-mono text-[10px]">
            {Object.entries(node.inputs).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between gap-1">
                <span className="text-slate-400 truncate">{key}:</span>
                <span className="text-slate-200 font-medium">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recursive Children Nodes */}
      {hasChildren && expanded && (
        <div className="mt-2 space-y-1.5 pl-1 border-l border-slate-800">
          {node.children!.map((child, idx) => (
            <NodeView key={`${child.label}-${idx}`} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const ExplainPopover: React.FC<ExplainPopoverProps> = ({
  node,
  isOpen,
  onClose,
  title = "Calculation Explanation",
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !node) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explain-popover-title"
    >
      <div className="glass-panel border border-slate-700 bg-slate-900 w-full max-w-lg rounded-xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Calculator className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="explain-popover-title"
                className="text-sm font-semibold text-slate-100"
              >
                {title}
              </h2>
              <p className="text-[11px] text-slate-400">
                Formula and inputs inspection • Principle IV, FR-022
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close explain popover"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          <NodeView node={node} isRoot />
        </div>

        {/* Modal Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
            Zero stochastic inference • Deterministic mathematics
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
