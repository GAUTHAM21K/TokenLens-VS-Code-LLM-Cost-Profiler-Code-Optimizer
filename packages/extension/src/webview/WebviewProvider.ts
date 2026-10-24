/**
 * Sidebar WebviewViewProvider: loads the built webview HTML under a strict CSP and relays
 * messages. `renderWebview` is shared with the editor-area OptimizerPanel, so both surfaces get
 * the same page, CSP and message wiring.
 *
 * Exports: WebviewProvider, renderWebview
 * Feature: shared protocol / webview shell
 */
import * as vscode from "vscode";
import * as crypto from "node:crypto";
import { MessageRouter } from "./MessageRouter.js";
import { buildWebviewHtml, type HostView } from "./htmlBuilder.js";

/**
 * Sets options + HTML on `webview`, attaches it to `router` and relays its inbound messages.
 * Returns the disposables to release when the webview goes away (the caller also detaches it).
 */
export async function renderWebview(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  router: MessageRouter,
  hostView: HostView
): Promise<vscode.Disposable[]> {
  router.setTarget(webview);

  const distWebviewUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");

  // Restrict local resource roots strictly to packaged webview dist (Principle II & Finding 1)
  webview.options = {
    enableScripts: true,
    localResourceRoots: [distWebviewUri],
  };

  const htmlUri = vscode.Uri.joinPath(distWebviewUri, "index.html");
  let template: string | undefined;

  try {
    const bytes = await vscode.workspace.fs.readFile(htmlUri);
    template = new TextDecoder().decode(bytes);
  } catch (err) {
    console.error(
      "[WebviewProvider] Webview build artifacts missing or unreadable at dist/webview/index.html:",
      err
    );
  }

  const nonce = crypto.randomBytes(16).toString("base64");
  webview.html = buildWebviewHtml({
    hostView,
    nonce,
    cspSource: webview.cspSource,
    template,
    toAssetUri: (assetRelativePath) =>
      webview.asWebviewUri(vscode.Uri.joinPath(distWebviewUri, assetRelativePath)).toString(),
  });

  return [
    webview.onDidReceiveMessage(async (message) => {
      await router.handleInbound(message);
    }),
  ];
}

export class WebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "tokenOptimizer";
  private view?: vscode.WebviewView;
  private router: MessageRouter;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    router?: MessageRouter
  ) {
    this.router = router || new MessageRouter();
  }

  public getRouter(): MessageRouter {
    return this.router;
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.view = webviewView;
    this.disposables.push(
      ...(await renderWebview(webviewView.webview, this.extensionUri, this.router, "sidebar")),
      webviewView.onDidDispose(() => {
        // The view can be re-resolved later (sidebar hidden/shown): keep the router's handlers.
        this.releaseView();
      })
    );
  }

  private releaseView(): void {
    if (this.view) this.router.detachTarget(this.view.webview);
    this.view = undefined;
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  public dispose(): void {
    this.releaseView();
    this.router.dispose();
  }
}
