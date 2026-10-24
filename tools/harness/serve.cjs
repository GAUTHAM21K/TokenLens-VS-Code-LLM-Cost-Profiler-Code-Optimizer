/**
 * `pnpm harness:serve [--seed-profile] [--catalog-url <url>] [--port 5177]`: runs the real built
 * extension host (mock vscode) and serves the real webview at http://localhost:<port> for manual
 * browser checks. Webview <-> host messages are relayed over HTTP POST /msg and SSE /events.
 * Like VS Code, messages posted while no browser is connected are dropped (no replay), so late
 * panel opening behaves as in the editor. GET /__state returns the host message log.
 *
 * Exports: none (CLI)
 * Feature: tooling (host harness, manual checks)
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { createHost, EXT_DIR } = require("./lib/host.cjs");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(value("port", 5177));
const log = (...a) => process.stdout.write(`[harness] ${a.join(" ")}\n`);

const sseClients = new Set();
const hostMsgLog = [];
const config = {};
if (value("catalog-url")) config.catalogApiUrl = value("catalog-url");

const host = createHost({
  config,
  seedProfile: flag("seed-profile"),
  onHostMessage: (msg) => {
    hostMsgLog.push(msg.type);
    log("host -> webview:", msg.type);
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of sseClients) c.write(data);
  },
});
host.activate();
log("extension activated", flag("seed-profile") ? "(seeded finalized fixture profile v1)" : "");

(async () => {
  const html = await host.openView();
  const nonce = (html.match(/nonce-([^';]+)/) || [])[1];
  const shim = `<script nonce="${nonce}">
    window.acquireVsCodeApi = () => {
      let state = null;
      return {
        postMessage: (m) => fetch('/msg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }),
        getState: () => state, setState: (s) => { state = s; },
      };
    };
    const es = new EventSource('/events');
    es.onmessage = (e) => window.postMessage(JSON.parse(e.data), '*');
    window.__harness = true;
  </script>`;
  // Harness-only CSP relaxation: allow same-origin fetch/EventSource for the relay.
  const page = html
    .replace(/(Content-Security-Policy" content="[^"]*?)default-src 'none';/, "$1default-src 'none'; connect-src 'self';")
    .replace("<head>", "<head>\n" + shim);

  http
    .createServer((req, res) => {
      const url = req.url.split("?")[0];
      if (url === "/" || url === "/index.html") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(page);
      }
      if (url === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      if (url === "/msg" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", async () => {
          let msg;
          try {
            msg = JSON.parse(body);
          } catch {
            msg = body;
          }
          log("webview -> host:", msg && msg.type);
          res.writeHead(204);
          res.end();
          await host.send(msg);
        });
        return;
      }
      if (url === "/__state") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ hostMsgLog, commandsRun: host.commandsRun }));
      }
      const file = path.join(EXT_DIR, decodeURIComponent(url));
      if (file.startsWith(path.join(EXT_DIR, "dist")) && fs.existsSync(file)) {
        const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
        res.writeHead(200, { "content-type": type });
        return res.end(fs.readFileSync(file));
      }
      res.writeHead(404);
      res.end();
    })
    .listen(PORT, () => log(`serving http://localhost:${PORT}`));
})();
