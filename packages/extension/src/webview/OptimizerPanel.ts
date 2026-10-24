/**
 * Editor-area WebviewPanel ("Token Optimizer: Open Optimizer Panel"): the same page as the sidebar
 * view, but full width. It attaches to the shared MessageRouter, so it reuses every feature
 * handler and gets the catalog resend on `webview/ready`. One panel at a time; opening again
 * reveals it.
 *
 * Exports: OptimizerPanel
 * Feature: shared protocol / webview shell
 */
import * as vscode from "vscode";
import type { MessageRouter } from "./MessageRouter.js";
import { renderWebview } from "./WebviewProvider.js";

export class OptimizerPanel {
  public static readonly viewType = "tokenOptimizer.panel";
  private static current: OptimizerPanel | undefined;

  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly router: MessageRouter
  ) {}

  /** Opens the panel in the active editor column, or reveals the existing one. */
  public static async createOrShow(extensionUri: vscode.Uri, router: MessageRouter): Promise<void> {
    if (OptimizerPanel.current) {
      OptimizerPanel.current.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      OptimizerPanel.viewType,
      "Token Optimizer",
      vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist", "webview")],
      }
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, "media", "icon.svg");
    const instance = new OptimizerPanel(panel, router);
    OptimizerPanel.current = instance;
    instance.disposables.push(panel.onDidDispose(() => instance.release()));
    instance.disposables.push(...(await renderWebview(panel.webview, extensionUri, router, "panel")));
  }

  private release(): void {
    this.router.detachTarget(this.panel.webview);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (OptimizerPanel.current === this) OptimizerPanel.current = undefined;
  }
}
