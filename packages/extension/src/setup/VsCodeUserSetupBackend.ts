/**
 * UserSetupStore backend on VS Code globalState.
 *
 * Exports: VsCodeUserSetupBackend
 * Feature: settings / API keys
 */
import type * as vscode from "vscode";
import type { SetupStorageBackend } from "@token-optimizer/core";

export class VsCodeUserSetupBackend implements SetupStorageBackend {
  constructor(private globalState: vscode.Memento) {}

  public get<T>(key: string): T | undefined {
    return this.globalState.get<T>(key);
  }

  public async set<T>(key: string, value: T): Promise<void> {
    await this.globalState.update(key, value);
  }
}
