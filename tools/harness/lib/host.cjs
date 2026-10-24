/**
 * Host harness core: runs the real built extension (packages/extension/dist/extension.js) in Node
 * with a mocked `vscode` module and a fake webview that records every host -> webview message.
 * Each createHost() call loads a fresh copy of the bundle, so scenarios can start several
 * independent hosts (e.g. catalog API up vs down) in one process.
 *
 * Track D additions (additive): an in-memory TextDocument layer over the workspace folder,
 * `WorkspaceEdit` (createFile/replace/insert), `workspace.applyEdit` (one undo step per edit,
 * see host.undo()), `openTextDocument`, `findFiles` (glob subset: **, *, {a,b}),
 * `registerTextDocumentContentProvider`, `Position`/`Range`/`Uri.from`, a recorded `vscode.diff`
 * command (host.diffs) and a temp-dir workspace option (`tempWorkspaceFrom`).
 *
 * Exports: createHost, REPO_ROOT, EXT_DIR, seededProfileState, globToRegExp
 * Feature: tooling (host harness; used by harness:check scenarios and harness:serve)
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXT_DIR = path.join(REPO_ROOT, "packages/extension");
const DIST = path.join(EXT_DIR, "dist/extension.js");

let currentVscode = null;
const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode" && currentVscode) return currentVscode;
  return origLoad.call(this, request, parent, isMain);
};

const os = require("node:os");

const toPosix = (p) => p.replace(/\\/g, "/");
const mkUri = (p) => ({ fsPath: p, path: toPosix(p), scheme: "file", toString: () => "file:///" + toPosix(p) });

function memento(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get: (k, d) => (m.has(k) ? m.get(k) : d),
    update: async (k, v) => {
      m.set(k, v);
    },
    keys: () => [...m.keys()],
  };
}

/** Minimal glob -> RegExp over posix relative paths: globstar dirs, star, "?", {a,b}. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{") re += "(?:";
    else if (c === "}") re += ")";
    else if (c === ",") re += "|";
    else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class WorkspaceEdit {
  constructor() {
    this.ops = [];
  }
  createFile(uri, options = {}) {
    this.ops.push({ kind: "create", uri, options });
  }
  replace(uri, range, text) {
    this.ops.push({ kind: "text", uri, range, text });
  }
  insert(uri, position, text) {
    this.ops.push({ kind: "text", uri, range: new Range(position, position), text });
  }
}

/** Offset of a {line, character} position in text (VS Code semantics, "\n" line breaks). */
function offsetAt(text, pos) {
  let i = 0;
  for (let line = 0; line < pos.line; line++) {
    const nl = text.indexOf("\n", i);
    if (nl < 0) return text.length;
    i = nl + 1;
  }
  return Math.min(i + pos.character, text.length);
}

/** Workspace state holding a finalized copy of the ts-rag-chatbot fixture profile (v1). */
function seededProfileState() {
  const profile = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages/fixtures/profiles/ts-rag-chatbot.json"), "utf8")
  );
  const now = "2026-10-12T00:00:00.000Z";
  profile.profileVersion = 1;
  profile.finalizedAt = now;
  return {
    "tokenOptimizer.profileHistory": [
      {
        version: 1,
        narrative: "Seeded fixture profile (ts-rag-chatbot).",
        profile,
        createdAt: now,
        finalizedAt: now,
        costUsd: 0,
        tokens: { inputTokens: 0, outputTokens: 0 },
      },
    ],
  };
}

/**
 * @param {object} opts
 * @param {Record<string, unknown>} [opts.config] tokenOptimizer.* settings (e.g. catalogApiUrl)
 * @param {boolean} [opts.seedProfile] seed a finalized profile into workspace state
 * @param {string} [opts.workspaceDir] workspace folder (default: repo root)
 * @param {string} [opts.tempWorkspaceFrom] copy this folder into a fresh temp dir and use the copy
 *   as the workspace folder (removed on deactivate()). Env HARNESS_TEMP_WORKSPACE_FROM does the
 *   same for hosts that do not pass it (e.g. `harness:serve`).
 * @param {(msg: object) => void} [opts.onHostMessage] called for every host -> webview message
 */
function createHost(opts = {}) {
  if (!fs.existsSync(DIST)) {
    throw new Error(`Missing ${DIST}. Run: npx -y pnpm@12.10.1 -r build`);
  }
  const config = opts.config || {};
  let tempDir = null;
  const tempFrom = opts.tempWorkspaceFrom || process.env.HARNESS_TEMP_WORKSPACE_FROM;
  if (tempFrom) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "to-harness-ws-"));
    fs.cpSync(tempFrom, tempDir, { recursive: true });
  }
  const workspaceDir = tempDir || opts.workspaceDir || REPO_ROOT;
  /** absolute path -> { text, dirty } for documents opened through the mock. */
  const docs = new Map();
  const contentProviders = new Map();
  const undoStack = [];
  const appliedEdits = [];
  const diffs = [];
  const keyOf = (u) => path.resolve(u.fsPath);
  const docFor = (u) => {
    const k = keyOf(u);
    if (!docs.has(k)) docs.set(k, { text: fs.readFileSync(k, "utf8"), dirty: false });
    return docs.get(k);
  };
  const textDocument = (u) => ({
    uri: u,
    get isDirty() {
      return docFor(u).dirty;
    },
    getText: (range) => {
      const t = docFor(u).text;
      return range ? t.slice(offsetAt(t, range.start), offsetAt(t, range.end)) : t;
    },
    save: async () => {
      const d = docFor(u);
      fs.writeFileSync(keyOf(u), d.text, "utf8");
      d.dirty = false;
      return true;
    },
  });
  const secrets = new Map();
  const commandsRun = [];
  const messages = [];
  const waiters = new Set();
  let provider = null;
  let inbound = null;

  currentVscode = {
    Uri: {
      joinPath: (u, ...parts) => mkUri(path.posix.join(toPosix(u.fsPath), ...parts)),
      file: mkUri,
      from: ({ scheme, path: p = "", query = "" }) => ({
        scheme,
        path: p,
        query,
        fsPath: p,
        toString: () => `${scheme}:${p}${query ? "?" + query : ""}`,
      }),
    },
    Position,
    Range,
    WorkspaceEdit,
    window: {
      registerWebviewViewProvider: (_id, p) => {
        provider = p;
        return { dispose() {} };
      },
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    commands: {
      registerCommand: () => ({ dispose() {} }),
      executeCommand: async (...a) => {
        commandsRun.push(a[0]);
        if (a[0] === "vscode.diff") {
          const [, left, right, title] = a;
          const provider = contentProviders.get(right.scheme);
          const rightText = provider ? await provider.provideTextDocumentContent(right) : undefined;
          diffs.push({ left, right, title, leftText: docFor(left).text, rightText });
        }
      },
    },
    workspace: {
      fs: { readFile: async (u) => new Uint8Array(await fs.promises.readFile(u.fsPath)) },
      workspaceFolders: [{ uri: mkUri(workspaceDir), name: path.basename(workspaceDir), index: 0 }],
      getConfiguration: () => ({ get: (k, d) => (k in config ? config[k] : d) }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
      openTextDocument: async (u) => textDocument(u),
      registerTextDocumentContentProvider: (scheme, provider) => {
        contentProviders.set(scheme, provider);
        return { dispose: () => contentProviders.delete(scheme) };
      },
      findFiles: async (include, exclude) => {
        const inc = globToRegExp(String(include));
        const exc = exclude ? globToRegExp(String(exclude)) : null;
        return walkFiles(workspaceDir)
          .map((f) => [f, toPosix(path.relative(workspaceDir, f))])
          .filter(([, rel]) => inc.test(rel) && !(exc && exc.test(rel)))
          .map(([f]) => mkUri(f));
      },
      /** Creates go to disk; text edits go to the (now dirty) documents. One undo step per call. */
      applyEdit: async (edit) => {
        const before = new Map();
        const byDoc = new Map();
        for (const op of edit.ops) {
          const k = keyOf(op.uri);
          if (!before.has(k)) before.set(k, fs.existsSync(k) ? { ...docFor(op.uri) } : null);
          if (op.kind === "create") {
            if (fs.existsSync(k) && !op.options.overwrite) {
              if (op.options.ignoreIfExists) continue;
              return false;
            }
            fs.mkdirSync(path.dirname(k), { recursive: true });
            const text = op.options.contents ? Buffer.from(op.options.contents).toString("utf8") : "";
            fs.writeFileSync(k, text, "utf8");
            docs.set(k, { text, dirty: false });
          } else {
            if (!byDoc.has(k)) byDoc.set(k, { uri: op.uri, ops: [] });
            byDoc.get(k).ops.push(op);
          }
        }
        for (const { uri, ops } of byDoc.values()) {
          const d = docFor(uri);
          const spans = ops.map((op) => ({
            s: offsetAt(d.text, op.range.start),
            e: offsetAt(d.text, op.range.end),
            text: op.text,
          }));
          // descending; at equal offsets the replacement goes first so an insertion lands before it
          spans.sort((a, b) => b.s - a.s || (a.s === a.e ? 1 : -1));
          for (const sp of spans) d.text = d.text.slice(0, sp.s) + sp.text + d.text.slice(sp.e);
          d.dirty = true;
        }
        undoStack.push(before);
        appliedEdits.push({
          creates: edit.ops.filter((o) => o.kind === "create").length,
          textEdits: edit.ops.filter((o) => o.kind === "text").length,
        });
        return true;
      },
    },
    env: { appName: "Visual Studio Code", uriScheme: "vscode" },
    lm: undefined,
    CancellationTokenSource: class {
      constructor() {
        this.token = { isCancellationRequested: false };
      }
      cancel() {}
      dispose() {}
    },
    LanguageModelChatMessage: {
      User: (c) => ({ role: "user", c }),
      Assistant: (c) => ({ role: "assistant", c }),
    },
  };

  const context = {
    subscriptions: [],
    extensionUri: mkUri(EXT_DIR),
    extensionPath: EXT_DIR,
    secrets: {
      get: async (k) => secrets.get(k),
      store: async (k, v) => {
        secrets.set(k, v);
      },
      delete: async (k) => {
        secrets.delete(k);
      },
      onDidChange: () => ({ dispose() {} }),
    },
    globalState: memento(),
    workspaceState: memento(opts.seedProfile ? seededProfileState() : {}),
  };

  delete require.cache[require.resolve(DIST)];
  const ext = require(DIST);

  const webview = {
    cspSource: "'self'",
    options: {},
    html: "",
    asWebviewUri: (u) => ({ toString: () => "/" + toPosix(path.relative(EXT_DIR, u.fsPath)) }),
    postMessage: async (msg) => {
      messages.push(msg);
      if (opts.onHostMessage) opts.onHostMessage(msg);
      for (const w of [...waiters]) w(msg);
      return true;
    },
    onDidReceiveMessage: (fn) => {
      inbound = fn;
      return { dispose() {} };
    },
  };
  const view = { webview, visible: true, onDidDispose: () => ({ dispose() {} }) };

  return {
    context,
    messages,
    commandsRun,
    webview,
    workspaceDir,
    /** One entry per workspace.applyEdit call: { creates, textEdits }. */
    appliedEdits,
    /** Recorded `vscode.diff` invocations: { left, right, title, leftText, rightText }. */
    diffs,
    /** Current text of a workspace file as VS Code sees it (open document, else disk). */
    documentText(rel) {
      return docFor(mkUri(path.join(workspaceDir, rel))).text;
    },
    /** Simulates the user typing in a workspace file: replaces its document text (dirty). */
    setDocumentText(rel, text) {
      docs.set(path.resolve(path.join(workspaceDir, rel)), { text, dirty: true });
    },
    /** Ctrl+Z for the last applyEdit: restores every touched document (left dirty, as in VS Code). */
    undo() {
      const before = undoStack.pop();
      if (!before) return false;
      for (const [k, prev] of before) if (prev) docs.set(k, { text: prev.text, dirty: true });
      return true;
    },
    /** Runs extension activate() (catalog init starts in the background). */
    activate() {
      ext.activate(context);
      if (!provider) throw new Error("extension did not register a webview view provider");
    },
    /** Resolves the sidebar webview (i.e. the user opens the panel). */
    async openView() {
      await provider.resolveWebviewView(view, {}, { isCancellationRequested: false });
      return webview.html;
    },
    /** Delivers a webview -> host message (as the real webview would). */
    async send(msg) {
      if (!inbound) throw new Error("webview not open: call openView() first");
      await inbound(msg);
    },
    /** Resolves with the first host message (seen after this call) matching type + predicate. */
    waitFor(type, predicate = () => true, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`timed out after ${timeoutMs} ms waiting for host message '${type}'`));
        }, timeoutMs);
        const check = (msg) => {
          if (msg.type === type && predicate(msg)) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve(msg);
          }
        };
        waiters.add(check);
      });
    },
    deactivate() {
      for (const d of context.subscriptions) {
        try {
          d.dispose();
        } catch {
          /* ignore */
        }
      }
      if (ext.deactivate) ext.deactivate();
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

module.exports = { createHost, REPO_ROOT, EXT_DIR, seededProfileState, globToRegExp };
