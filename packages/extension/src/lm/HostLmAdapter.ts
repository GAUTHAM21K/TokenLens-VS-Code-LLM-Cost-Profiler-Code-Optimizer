/**
 * ProviderAdapter backed by the VS Code Language Model API (e.g. Copilot).
 *
 * Exports: HostLmSelector, HostLmAdapter
 * Feature: providers
 */
import * as vscode from "vscode";
import type { Provider, ChatMessage, CompletionResult } from "@token-optimizer/core";

export interface HostLmSelector {
  vendor?: string;
  family?: string;
  id?: string;
}

export class HostLmAdapter {
  public readonly providerId: string;
  private readonly selector: HostLmSelector;

  constructor(provider: Provider) {
    this.providerId = provider.id;
    // Vendor and family strictly come from the catalog (Principle VII)
    // No hardcoded "copilot" or "gpt-4o" literals in extension source!
    this.selector = (provider as Provider & { hostLm?: HostLmSelector }).hostLm || {};
  }

  public getSelector(): HostLmSelector {
    return { ...this.selector };
  }

  /**
   * Checks if the host language model API is available in this VS Code environment
   * and has matching models accessible to the extension.
   */
  public async isAvailable(): Promise<boolean> {
    if (typeof vscode === "undefined" || !vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
      return false;
    }

    try {
      const models = await vscode.lm.selectChatModels(this.selector);
      return Array.isArray(models) && models.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Lists available host chat models matching the catalog selector.
   */
  public async listModels(): Promise<string[]> {
    if (typeof vscode === "undefined" || !vscode.lm || typeof vscode.lm.selectChatModels !== "function") {
      return [];
    }

    try {
      const models = await vscode.lm.selectChatModels(this.selector);
      return models.map((m) => m.id);
    } catch {
      return [];
    }
  }

  /**
   * Completes a chat request via vscode.lm.
   */
  public async complete(
    messages: ChatMessage[],
    options: {
      modelId?: string;
      token?: vscode.CancellationToken;
    } = {}
  ): Promise<CompletionResult> {
    if (typeof vscode === "undefined" || !vscode.lm) {
      throw new Error("vscode.lm API is not available in this environment");
    }

    const models = await vscode.lm.selectChatModels(this.selector);
    if (!models || models.length === 0) {
      throw new Error("No host LM models available matching the catalog selector");
    }

    const selectedModel = options.modelId
      ? models.find((m) => m.id === options.modelId) || models[0]
      : models[0];

    const vscodeMessages = messages.map((m) => {
      if (m.role === "assistant") {
        return vscode.LanguageModelChatMessage.Assistant(m.content);
      }
      return vscode.LanguageModelChatMessage.User(m.content);
    });

    const cancellationToken = options.token || new vscode.CancellationTokenSource().token;
    const response = await selectedModel.sendRequest(vscodeMessages, {}, cancellationToken);

    let content = "";
    for await (const chunk of response.text) {
      content += chunk;
    }

    return { content };
  }
}
