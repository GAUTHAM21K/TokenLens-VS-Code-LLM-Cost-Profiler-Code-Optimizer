/**
 * Implement tab: choose what to implement (optimizer / router / both) and which rule techniques
 * (pre-selected from the Optimize tab), export the `ai_optimizer` package into the workspace,
 * scan .py files for LangChain call sites, and review each block (original vs modified) with
 * Apply / Skip / Open diff, per-block status, and Apply-all-remaining (one block at a time,
 * stopping on the first non-applied result). After an apply, the other blocks of that file move to
 * the rebased ranges the host sends, so their file:line labels stay correct.
 *
 * Exports: ImplementView
 * Feature: implement optimization
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FolderGit2, PackagePlus, ScanSearch, ListChecks } from "lucide-react";
import { vscodeBridge } from "../protocol/vscode";
import type { FeatureViewProps } from "./viewProps";
import { ProposalCard, type ProposalRow } from "../components/implement/ProposalCard";
import {
  RESCAN_PREFIX,
  mergeRescan,
  rowsFromScan,
  ruleTechniques,
  withRebasedRanges,
  withStatus,
} from "../components/implement/proposalState";

type Mode = "optimizer" | "router" | "both";
const MODES: Array<{ id: Mode; label: string }> = [
  { id: "optimizer", label: "Prompt optimizer" },
  { id: "router", label: "Model router" },
  { id: "both", label: "Both" },
];

export const ImplementView: React.FC<FeatureViewProps> = ({ catalog, selectedTechniqueIds }) => {
  const rules = useMemo(() => ruleTechniques(catalog.strategies), [catalog.strategies]);
  const [mode, setMode] = useState<Mode>("both");
  const [techniqueIds, setTechniqueIds] = useState<string[]>(() =>
    selectedTechniqueIds.filter((id) => rules.some((r) => r.id === id))
  );
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [rows, setRows] = useState<ProposalRow[]>([]);
  const [filesScanned, setFilesScanned] = useState<number | null>(null);
  const [busy, setBusy] = useState<"export" | "scan" | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const applyQueue = useRef<string[]>([]);
  const opSeq = useRef(0);

  // Selection arrives after mount (or changes on the Optimize tab): keep it in sync.
  useEffect(() => {
    setTechniqueIds(selectedTechniqueIds.filter((id) => rules.some((r) => r.id === id)));
  }, [selectedTechniqueIds, rules]);

  const features = mode === "both" ? (["optimizer", "router"] as const) : ([mode] as const);
  const needsTechniques = mode !== "router" && techniqueIds.length === 0;

  const sendApply = (id: string) => {
    setRows((r) => withStatus(r, id, "applying"));
    vscodeBridge.postMessage({ version: 1, type: "implement/applyBlock", payload: { proposalId: id } });
  };

  useEffect(
    () =>
      vscodeBridge.onMessage((msg) => {
        switch (msg.type) {
          case "implement/exported":
            setBusy(null);
            setExportInfo(`Exported ${msg.payload.filesWritten.length} files to ${msg.payload.targetDir}/`);
            break;
          case "implement/proposals": {
            const { proposals, operationId } = msg.payload;
            setBusy(null);
            setFilesScanned(msg.payload.filesScanned);
            if (operationId?.startsWith(RESCAN_PREFIX)) {
              setRows((prev) => mergeRescan(prev, proposals));
              setNotice("The file changed since the scan, so the blocks were re-scanned. Review and apply again.");
            } else {
              setRows(rowsFromScan(proposals));
              setNotice(null);
            }
            break;
          }
          case "implement/blockResult": {
            const { proposalId, status, message, rebased } = msg.payload;
            if (status === "diff-opened") break;
            setRows((r) => withRebasedRanges(withStatus(r, proposalId, status, message), rebased));
            if (applyQueue.current[0] === proposalId) {
              applyQueue.current.shift();
              if (status === "applied" && applyQueue.current.length > 0) sendApply(applyQueue.current[0]);
              else applyQueue.current = [];
            }
            break;
          }
          case "implement/error":
            setBusy(null);
            applyQueue.current = [];
            setHostError(msg.payload.message);
            break;
        }
      }),
    []
  );

  const nextOp = (kind: string) => `${kind}-${++opSeq.current}`;

  const onExport = () => {
    setBusy("export");
    setHostError(null);
    vscodeBridge.postMessage({
      version: 1,
      type: "implement/export",
      payload: { operationId: nextOp("export"), techniqueIds },
    });
  };

  const onScan = () => {
    setBusy("scan");
    setHostError(null);
    applyQueue.current = [];
    vscodeBridge.postMessage({
      version: 1,
      type: "implement/scan",
      payload: { operationId: nextOp("scan"), features: [...features], techniqueIds },
    });
  };

  const remaining = rows.filter((r) => r.status === "pending");
  const onApplyAll = () => {
    applyQueue.current = remaining.map((r) => r.proposal.id);
    if (applyQueue.current.length > 0) sendApply(applyQueue.current[0]);
  };

  const toggleTechnique = (id: string) =>
    setTechniqueIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : rules.map((r) => r.id).filter((x) => x === id || ids.includes(x))));

  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const applying = rows.some((r) => r.status === "applying");

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
        <FolderGit2 className="w-4 h-4 text-indigo-400" /> Implement
      </h2>

      <div className="glass-panel p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex gap-1" role="radiogroup" aria-label="Feature">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              onClick={() => setMode(m.id)}
              className={`px-3 py-1 rounded-md text-xs ${mode === m.id ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode !== "router" && (
          <div className="space-y-1">
            <span className="text-[11px] text-slate-400">Techniques (pre-selected from the Optimize tab)</span>
            {rules.length === 0 && <p className="text-xs text-slate-500">No rule techniques in the catalog yet.</p>}
            <ul className="grid grid-cols-1 gap-1">
              {rules.map((t) => (
                <li key={t.id}>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={techniqueIds.includes(t.id)} onChange={() => toggleTechnique(t.id)} />
                    {t.name} <code className="text-[10px] text-slate-500">{t.id}</code>
                  </label>
                </li>
              ))}
            </ul>
            {needsTechniques && <p className="text-[11px] text-amber-400">Select at least one technique.</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onExport}
            disabled={busy !== null}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100"
          >
            <PackagePlus className="w-3.5 h-3.5" /> Export ai_optimizer
          </button>
          <button
            type="button"
            onClick={onScan}
            disabled={busy !== null || needsTechniques}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
          >
            <ScanSearch className="w-3.5 h-3.5" /> Scan workspace
          </button>
        </div>
        {exportInfo && <p className="text-[11px] text-emerald-400">{exportInfo}</p>}
        {hostError && <p className="text-[11px] text-amber-400">{hostError}</p>}
      </div>

      {filesScanned !== null && (
        <div className="space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-y-2">
            <span className="text-xs text-slate-400">
              {rows.length} block{rows.length === 1 ? "" : "s"} in {filesScanned} file{filesScanned === 1 ? "" : "s"}
              {rows.length > 0 &&
                ` · ${counts.applied ?? 0} applied · ${counts.skipped ?? 0} skipped · ${remaining.length} remaining`}
            </span>
            <button
              type="button"
              onClick={onApplyAll}
              disabled={remaining.length === 0 || applying}
              className="flex items-center gap-1 px-3 py-1 rounded-md text-xs bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white"
            >
              <ListChecks className="w-3.5 h-3.5" /> Apply all remaining
            </button>
          </div>
          {notice && <p className="text-[11px] text-amber-400">{notice}</p>}
          {rows.length === 0 && <p className="text-xs text-slate-500">No LangChain call sites found.</p>}
          <ul className="space-y-2">
            {rows.map((row) => (
              <ProposalCard
                key={row.proposal.id}
                row={row}
                busy={applying}
                onApply={() => sendApply(row.proposal.id)}
                onSkip={() =>
                  vscodeBridge.postMessage({ version: 1, type: "implement/skipBlock", payload: { proposalId: row.proposal.id } })
                }
                onDiff={() =>
                  vscodeBridge.postMessage({ version: 1, type: "implement/openDiff", payload: { proposalId: row.proposal.id } })
                }
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};
