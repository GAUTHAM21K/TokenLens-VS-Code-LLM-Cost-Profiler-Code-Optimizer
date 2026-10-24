/**
 * Pure HTML and CSP builder for the Token Optimizer Webview.
 * Independent of VS Code runtime for unit testing (Constitution Principle II).
 * `hostView` adds `<meta name="token-optimizer-host" content="sidebar|panel">` so the page knows
 * whether it runs in the sidebar view or the editor-area panel.
 *
 * Exports: BuildWebviewHtmlOptions, HostView, buildWebviewCsp, buildWebviewHtml
 * Feature: shared protocol / webview shell
 */

export type HostView = "sidebar" | "panel";

export interface BuildWebviewHtmlOptions {
  hostView?: HostView;
  nonce: string;
  cspSource: string;
  template?: string;
  toAssetUri?: (assetRelativePath: string) => string;
}

export function buildWebviewCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ") + ";";
}

export function buildWebviewHtml(options: BuildWebviewHtmlOptions): string {
  const { nonce, cspSource, template, toAssetUri, hostView } = options;
  const csp = buildWebviewCsp(cspSource, nonce);
  const hostMeta = hostView ? `<meta name="token-optimizer-host" content="${hostView}">` : "";

  if (template) {
    let html = template;

    // Replace {{NONCE}} placeholders
    html = html.replace(/{{NONCE}}/g, nonce);

    // Rewrite asset links to webview-safe URIs with nonce
    if (toAssetUri) {
      html = html.replace(
        /(src|href)="\/?assets\/([^"]+)"/g,
        (_match, attr, assetFile) => {
          const uri = toAssetUri(`assets/${assetFile}`);
          return `${attr}="${uri}" nonce="${nonce}"`;
        }
      );
    }

    // Inject or update Content-Security-Policy meta tag (+ the host-view meta tag)
    const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="${csp}">${hostMeta}`;
    if (/<meta http-equiv="Content-Security-Policy"[^>]*>/i.test(html)) {
      html = html.replace(
        /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
        cspMetaTag
      );
    } else if (html.includes("<head>")) {
      html = html.replace("<head>", `<head>\n    ${cspMetaTag}`);
    } else {
      html = `${cspMetaTag}\n${html}`;
    }

    return html;
  }

  // Fallback shell when bundle is unavailable
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">${hostMeta}
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Optimizer</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family, sans-serif); padding: 16px; color: var(--vscode-foreground); background-color: var(--vscode-editor-background); }
    .card { border: 1px solid var(--vscode-widget-border, #333); border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div id="root">
    <h2>Token Optimizer Shell</h2>
    <div class="card">
      <p>Webview provider active with strict CSP.</p>
    </div>
  </div>
</body>
</html>`;
}
