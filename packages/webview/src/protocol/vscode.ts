/**
 * Webview side of the message bridge: acquireVsCodeApi wrapper with Zod-validated inbound
 * messages.
 *
 * Exports: vscodeBridge
 * Feature: shared protocol / webview shell
 */
import {
  HostToWebviewMsgSchema,
  type WebviewToHostMsg,
  type HostToWebviewMsg,
} from "@token-optimizer/core";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

class VsCodeBridge {
  private vscode: VsCodeApi | null = null;
  private listeners: Array<(msg: HostToWebviewMsg) => void> = [];

  constructor() {
    if (typeof acquireVsCodeApi === "function") {
      this.vscode = acquireVsCodeApi();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        // Zod validation at webview boundary (Constitution Principle II, Finding 5)
        const parseResult = HostToWebviewMsgSchema.safeParse(event.data);
        if (!parseResult.success) {
          console.debug(
            "[VsCodeBridge] Dropped malformed host message:",
            parseResult.error.message
          );
          return;
        }

        const msg = parseResult.data;
        for (const listener of this.listeners) {
          listener(msg);
        }
      });
    }
  }

  postMessage(message: WebviewToHostMsg): void {
    if (this.vscode) {
      this.vscode.postMessage(message);
    } else {
      // Mock logger in browser dev - drop sensitive key entirely (Finding 7)
      if (message.type === "auth/saveKey") {
        console.log(
          "[Mock VsCode PostMessage]: auth/saveKey (key omitted for provider " +
            message.payload.providerId +
            ")"
        );
      } else {
        console.log("[Mock VsCode PostMessage]:", message);
      }
    }
  }

  onMessage(listener: (msg: HostToWebviewMsg) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  getState<T>(): T | undefined {
    if (this.vscode) {
      return this.vscode.getState() as T | undefined;
    }
    return undefined;
  }

  setState<T>(state: T): void {
    if (this.vscode) {
      this.vscode.setState(state);
    }
  }
}

export const vscodeBridge = new VsCodeBridge();
