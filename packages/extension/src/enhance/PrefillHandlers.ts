/**
 * Host handlers for Enhance pre-fill and hydration. `enhance/prefill` scans the first workspace
 * folder (WorkspaceScanner) and answers `enhance/prefillResult` with a draft description plus the
 * signals behind it (or `enhance/prefillError`). On `webview/ready` it also sends the latest
 * profile as `enhance/versionLoaded`, so a fresh panel shows the last (finalized) profile next to
 * the history that EnhanceHandlers sends.
 *
 * Exports: PrefillHandlers, signalsFromDraft
 * Feature: token cost estimator (Enhance)
 */
import * as vscode from "vscode";
import type { FeatureHandler, FeatureHandlerDeps } from "../webview/handlers/FeatureHandlerDeps.js";
import { WorkspaceScanner } from "../workspace/WorkspaceScanner.js";

/** One signal per "Label: value" paragraph of the WorkspaceScanner draft (max 300 chars each). */
export function signalsFromDraft(draft: string): string[] {
  return draft
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((p) => (p.length > 300 ? `${p.slice(0, 297)}...` : p));
}

export class PrefillHandlers implements FeatureHandler {
  constructor(private readonly deps: FeatureHandlerDeps) {}

  register(): void {
    const { router, historyStore } = this.deps;

    router.register("enhance/prefill", async (msg) => {
      const operationId = msg.payload.operationId;
      const op = operationId ? { operationId } : {};
      const folder = vscode.workspace?.workspaceFolders?.[0];
      if (!folder) {
        await router.send({
          version: 1,
          type: "enhance/prefillError",
          payload: { ...op, error: "invalid-request", message: "Open a workspace folder to scan it." },
        });
        return;
      }
      try {
        const draft = (await WorkspaceScanner.scanWorkspace(folder)).slice(0, 20000);
        await router.send({
          version: 1,
          type: "enhance/prefillResult",
          payload: {
            ...op,
            description: draft,
            signals: draft
              ? signalsFromDraft(draft)
              : ["No package.json, requirements.txt, pyproject.toml, go.mod or README.md found."],
          },
        });
      } catch (err) {
        await router.send({
          version: 1,
          type: "enhance/prefillError",
          payload: {
            ...op,
            error: "io-failed",
            message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          },
        });
      }
    });

    router.register("webview/ready", async () => {
      const latest = historyStore.getLatest();
      if (latest) {
        await router.send({ version: 1, type: "enhance/versionLoaded", payload: { entry: latest } });
      }
    });
  }
}
