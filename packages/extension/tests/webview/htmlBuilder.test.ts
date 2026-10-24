/**
 * Tests: buildWebviewHtml and CSP (Finding 5, 6, Principle II).
 *
 * Exports: none (test suite)
 * Feature: shared protocol / webview shell
 */
import { describe, it, expect } from "vitest";
import {
  buildWebviewCsp,
  buildWebviewHtml,
} from "../../src/webview/htmlBuilder.js";

describe("buildWebviewHtml and CSP (Finding 5, 6, Principle II)", () => {
  const mockCspSource = "vscode-webview-resource:";
  const testNonce = "test-nonce-12345";

  it("builds hardened CSP with no https: img exfiltration channel", () => {
    const csp = buildWebviewCsp(mockCspSource, testNonce);

    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`img-src ${mockCspSource} data:`);
    expect(csp).not.toContain("img-src https:");
    expect(csp).toContain(`font-src ${mockCspSource}`);
    expect(csp).toContain(`style-src 'nonce-${testNonce}'`);
    expect(csp).toContain(`script-src 'nonce-${testNonce}'`);
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
  });

  it("generates unique nonces across calls", () => {
    // Check that callers providing different random nonces yield distinct CSPs
    const nonce1 = "random-nonce-1";
    const nonce2 = "random-nonce-2";

    const html1 = buildWebviewHtml({
      nonce: nonce1,
      cspSource: mockCspSource,
    });
    const html2 = buildWebviewHtml({
      nonce: nonce2,
      cspSource: mockCspSource,
    });

    expect(html1).toContain(`nonce="${nonce1}"`);
    expect(html2).toContain(`nonce="${nonce2}"`);
    expect(html1).not.toContain(nonce2);
    expect(html2).not.toContain(nonce1);
  });

  it("rewrites asset paths and injects nonce on scripts and stylesheets", () => {
    const template = `<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="/assets/style.css">
  <script type="module" src="/assets/index.js"></script>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

    const html = buildWebviewHtml({
      nonce: testNonce,
      cspSource: mockCspSource,
      template,
      toAssetUri: (assetPath) => `https://mock.webview.test/${assetPath}`,
    });

    // Asset paths rewritten
    expect(html).toContain('href="https://mock.webview.test/assets/style.css"');
    expect(html).toContain('src="https://mock.webview.test/assets/index.js"');

    // Nonce injected on tags
    expect(html).toContain(`nonce="${testNonce}"`);

    // CSP meta tag present
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(html).toContain("form-action 'none'");
  });

  it("renders safe fallback shell when no template is supplied", () => {
    const html = buildWebviewHtml({
      nonce: testNonce,
      cspSource: mockCspSource,
    });

    expect(html).toContain("Token Optimizer Shell");
    expect(html).toContain(`nonce="${testNonce}"`);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy"');
  });

  it("tells the page whether it runs in the sidebar or the editor panel", () => {
    const tpl = "<html><head></head><body><div id=\"root\"></div></body></html>";
    const panel = buildWebviewHtml({ nonce: "n1", cspSource: "vscode-resource:", template: tpl, hostView: "panel" });
    expect(panel).toContain('<meta name="token-optimizer-host" content="panel">');
    const plain = buildWebviewHtml({ nonce: "n1", cspSource: "vscode-resource:", template: tpl });
    expect(plain).not.toContain("token-optimizer-host");
  });
});

