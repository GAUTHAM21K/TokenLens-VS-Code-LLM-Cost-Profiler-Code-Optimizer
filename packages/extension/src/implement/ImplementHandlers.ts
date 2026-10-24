/**
 * Host handlers for the Implement tab (plan §3.3, deterministic, no LLM):
 *   implement/export     -> writes ai_optimizer/ (runtime modules + generated catalog_techniques.json
 *                           and router_config.json) with ONE WorkspaceEdit -> implement/exported
 *   implement/scan       -> core pyEditPlanner over workspace .py files -> implement/proposals
 *   implement/applyBlock -> re-reads the file; stale (original moved/changed) -> blockResult "stale"
 *                           + automatic re-scan; else ONE undoable WorkspaceEdit (block + missing
 *                           imports) -> blockResult "applied"; other pending blocks of the file are
 *                           rebased onto the new text and their new ranges sent in `rebased`
 *   implement/skipBlock  -> blockResult "skipped"
 *   implement/openDiff   -> native `vscode.diff` (file vs. virtual doc with the block applied)
 * Requests run one at a time (apply-all sends many applyBlock messages back to back).
 *
 * Exports: ImplementHandlers, EXPORT_DIR_SETTING, DIFF_SCHEME
 * Feature: implement optimization
 */
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  DEFAULT_EXPORT_DIR,
  LineIndex,
  UserSetupStore,
  applyOffsetEdits,
  buildCatalogTechniquesJson,
  planExportFiles,
  planProposalEdits,
  planPythonFile,
  rebaseRange,
  restrictRouterConfig,
  ruleTechniqueIds,
  scanExcludeGlob,
  shouldScanPythonPath,
  type FeatureErrorPayload,
  type ImplementEditProposal,
  type SourceRange,
  type ImplementFeature,
  type OffsetEdit,
  type RouterConfig,
} from "@token-optimizer/core";
import type { FeatureHandler, FeatureHandlerDeps } from "../webview/handlers/FeatureHandlerDeps.js";
import { sanitizeLogText } from "../webview/MessageRouter.js";
import { VsCodeUserSetupBackend } from "../setup/VsCodeUserSetupBackend.js";
import { resolveRouterConfig } from "../router/routerConfigStore.js";
import { readRuntimeFiles, runtimeSourceDir } from "./pythonRuntime.js";

/** `tokenOptimizer.implement.exportDir`: workspace-relative export dir (default "ai_optimizer"). */
export const EXPORT_DIR_SETTING = "implement.exportDir";
export const DIFF_SCHEME = "token-optimizer-implement";

type BlockStatus = "pending" | "applied" | "skipped" | "stale";

const sha256 = (text: string) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

export class ImplementHandlers implements FeatureHandler {
  private proposals = new Map<string, ImplementEditProposal>();
  private status = new Map<string, BlockStatus>();
  private lastScan: { features: ImplementFeature[]; techniqueIds: string[] } | null = null;
  private diffDocs = new Map<string, string>();
  private diffSeq = 0;
  private diffProviderRegistered = false;
  private rescanSeq = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: FeatureHandlerDeps) {}

  register(): void {
    const { router } = this.deps;
    router.register("implement/export", (msg) =>
      this.serial(() => this.exportPackage(msg.payload), msg.payload.operationId)
    );
    router.register("implement/scan", (msg) =>
      this.serial(async () => {
        const { operationId, features, techniqueIds } = msg.payload;
        await this.scanAndSend(features, techniqueIds, operationId);
      }, msg.payload.operationId)
    );
    router.register("implement/applyBlock", (msg) => this.serial(() => this.applyBlock(msg.payload.proposalId)));
    router.register("implement/skipBlock", (msg) =>
      this.serial(async () => {
        const id = msg.payload.proposalId;
        if (!this.proposals.has(id)) return this.blockResult(id, "failed", "Unknown block; scan again.");
        this.status.set(id, "skipped");
        await this.blockResult(id, "skipped");
      })
    );
    router.register("implement/openDiff", (msg) => this.serial(() => this.openDiff(msg.payload.proposalId)));
  }

  // ─── plumbing ─────────────────────────────────────────────────────────────

  /** Runs requests one at a time; unexpected errors become implement/error "internal". */
  private serial(fn: () => Promise<void>, operationId?: string): Promise<void> {
    const run = this.queue.then(fn).catch((err) =>
      this.fail("internal", err instanceof Error ? err.message : String(err), operationId)
    );
    this.queue = run;
    return run;
  }

  private async fail(error: FeatureErrorPayload["error"], message: string, operationId?: string): Promise<void> {
    await this.deps.router.send({
      version: 1,
      type: "implement/error",
      payload: { ...(operationId ? { operationId } : {}), error, message: sanitizeLogText(message).slice(0, 500) },
    });
  }

  private async blockResult(
    proposalId: string,
    status: "applied" | "skipped" | "stale" | "failed" | "diff-opened",
    message?: string,
    rebased?: Array<{ proposalId: string; range: SourceRange }>
  ): Promise<void> {
    await this.deps.router.send({
      version: 1,
      type: "implement/blockResult",
      payload: {
        proposalId,
        status,
        ...(message ? { message: message.slice(0, 500) } : {}),
        ...(rebased && rebased.length > 0 ? { rebased } : {}),
      },
    });
  }

  private root(): vscode.Uri | null {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? null;
  }

  private exportDir(): string {
    const configured = vscode.workspace.getConfiguration("tokenOptimizer").get<string>(EXPORT_DIR_SETTING);
    return (configured || DEFAULT_EXPORT_DIR).replace(/\\/g, "/").replace(/^\.\/|\/+$/g, "");
  }

  private fileUri(root: vscode.Uri, rel: string): vscode.Uri {
    return vscode.Uri.joinPath(root, ...rel.split("/"));
  }

  private async readText(uri: vscode.Uri): Promise<{ doc: vscode.TextDocument; text: string }> {
    const doc = await vscode.workspace.openTextDocument(uri);
    return { doc, text: doc.getText() };
  }

  // ─── export ───────────────────────────────────────────────────────────────

  private async exportPackage(payload: {
    operationId?: string;
    targetDir?: string;
    techniqueIds: string[];
    routerConfig?: RouterConfig;
  }): Promise<void> {
    const { operationId } = payload;
    const root = this.root();
    if (!root) return this.fail("invalid-request", "Open a folder to export ai_optimizer into.", operationId);
    const targetDir = (payload.targetDir ?? this.exportDir()).replace(/\\/g, "/").replace(/\/+$/, "");
    if (!targetDir || targetDir.split("/").includes("..") || path.isAbsolute(targetDir)) {
      return this.fail("invalid-request", `Invalid export directory "${targetDir}".`, operationId);
    }
    const srcDir = runtimeSourceDir(this.deps.context.extensionPath);
    if (!srcDir) return this.fail("io-failed", "The ai_optimizer runtime is missing from the extension.", operationId);

    const snapshot = this.deps.getCatalogSnapshot();
    const base = payload.routerConfig ?? resolveRouterConfig(this.deps.context.workspaceState, snapshot)?.config;
    const setup = await new UserSetupStore(new VsCodeUserSetupBackend(this.deps.context.globalState)).getSetup();
    const files = planExportFiles({
      targetDir,
      runtimeFiles: readRuntimeFiles(srcDir),
      techniques: buildCatalogTechniquesJson(snapshot?.strategies ?? [], payload.techniqueIds),
      routerConfig: base ? restrictRouterConfig(base, setup.enabledModelsByProvider) : undefined,
    });

    const edit = new vscode.WorkspaceEdit();
    for (const f of files) {
      edit.createFile(this.fileUri(root, f.path), {
        overwrite: true,
        contents: new TextEncoder().encode(f.content),
      });
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      return this.fail("io-failed", `Could not write ${targetDir}/ into the workspace.`, operationId);
    }
    await this.deps.router.send({
      version: 1,
      type: "implement/exported",
      payload: { ...(operationId ? { operationId } : {}), targetDir, filesWritten: files.map((f) => f.path) },
    });
  }

  // ─── scan ─────────────────────────────────────────────────────────────────

  private async scanAndSend(features: ImplementFeature[], techniqueIds: string[], operationId?: string): Promise<void> {
    const root = this.root();
    if (!root) return this.fail("invalid-request", "Open a folder to scan.", operationId);
    const strategies = this.deps.getCatalogSnapshot()?.strategies;
    const ids = strategies ? ruleTechniqueIds(strategies, techniqueIds) : techniqueIds;
    if (features.length === 1 && features[0] === "optimizer" && ids.length === 0) {
      return this.fail("invalid-request", "Select at least one rule technique to implement.", operationId);
    }
    this.lastScan = { features, techniqueIds };

    const exportDir = this.exportDir();
    const uris = await vscode.workspace.findFiles("**/*.py", scanExcludeGlob(exportDir));
    const files = uris
      .map((uri) => ({ uri, rel: path.relative(root.fsPath, uri.fsPath).split(path.sep).join("/") }))
      .filter((f) => !f.rel.startsWith("..") && shouldScanPythonPath(f.rel, exportDir))
      .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

    const proposals: ImplementEditProposal[] = [];
    for (const f of files) {
      const { text } = await this.readText(f.uri);
      proposals.push(...planPythonFile(f.rel, text, sha256(text), { features, techniqueIds: ids }));
    }
    this.proposals = new Map(proposals.map((p) => [p.id, p]));
    this.status = new Map(proposals.map((p) => [p.id, "pending"]));
    await this.deps.router.send({
      version: 1,
      type: "implement/proposals",
      payload: { ...(operationId ? { operationId } : {}), filesScanned: files.length, proposals },
    });
  }

  // ─── apply / diff ─────────────────────────────────────────────────────────

  private async applyBlock(id: string): Promise<void> {
    const p = this.proposals.get(id);
    const root = this.root();
    if (!p || !root) return this.blockResult(id, "failed", "Unknown block; scan again.");
    const state = this.status.get(id);
    if (state === "applied" || state === "skipped") {
      return this.blockResult(id, "failed", `Block was already ${state}.`);
    }
    const uri = this.fileUri(root, p.file);
    const { doc, text } = await this.readText(uri);
    const planned = planProposalEdits(text, p);
    if (planned.stale) {
      this.status.set(id, "stale");
      await this.blockResult(id, "stale", `${planned.reason}; re-scanning.`);
      if (this.lastScan) {
        await this.scanAndSend(this.lastScan.features, this.lastScan.techniqueIds, `rescan-${++this.rescanSeq}`);
      }
      return;
    }

    const idx = new LineIndex(text);
    const pos = (offset: number) => {
      const { line, col } = idx.position(offset);
      return new vscode.Position(line, col);
    };
    const edit = new vscode.WorkspaceEdit();
    for (const e of planned.edits) edit.replace(uri, new vscode.Range(pos(e.start), pos(e.end)), e.text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      return this.blockResult(id, "failed", "VS Code rejected the edit.");
    }
    this.status.set(id, "applied");
    await doc.save();
    const after = (await this.readText(uri)).text;
    const rebased = this.rebaseFile(p.file, text, after, planned.edits);

    const imports = planned.importsAdded.length;
    await this.blockResult(
      id,
      "applied",
      imports ? `Applied (+${imports} import line${imports > 1 ? "s" : ""}).` : "Applied.",
      rebased
    );
  }

  /** Moves pending proposals of `file` onto the post-apply text (unmatched ones go stale on apply). */
  private rebaseFile(
    file: string,
    before: string,
    after: string,
    edits: OffsetEdit[]
  ): Array<{ proposalId: string; range: SourceRange }> {
    const hash = sha256(after);
    const moved: Array<{ proposalId: string; range: SourceRange }> = [];
    for (const [id, p] of this.proposals) {
      if (p.file !== file || this.status.get(id) !== "pending") continue;
      const range = rebaseRange(before, after, p.range, edits);
      if (!range) continue;
      this.proposals.set(id, { ...p, range, fileHash: hash });
      moved.push({ proposalId: id, range });
    }
    return moved;
  }

  /** Registers the virtual-document provider on first use (activation stays side-effect free). */
  private ensureDiffProvider(): void {
    if (this.diffProviderRegistered) return;
    this.diffProviderRegistered = true;
    this.deps.context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, {
        provideTextDocumentContent: (uri) => this.diffDocs.get(uri.query) ?? "",
      })
    );
  }

  private async openDiff(id: string): Promise<void> {
    const p = this.proposals.get(id);
    const root = this.root();
    if (!p || !root) return this.blockResult(id, "failed", "Unknown block; scan again.");
    const uri = this.fileUri(root, p.file);
    const { text } = await this.readText(uri);
    const planned = planProposalEdits(text, p);
    if (planned.stale) return this.blockResult(id, "stale", `${planned.reason}; scan again.`);
    this.ensureDiffProvider();
    const key = `d${++this.diffSeq}`;
    this.diffDocs.set(key, applyOffsetEdits(text, planned.edits));
    const right = vscode.Uri.from({ scheme: DIFF_SCHEME, path: "/" + p.file, query: key });
    await vscode.commands.executeCommand(
      "vscode.diff",
      uri,
      right,
      `${p.file}:${p.range.startLine + 1} ↔ proposed (Token Optimizer)`,
      { preview: true }
    );
    await this.blockResult(id, "diff-opened");
  }
}
