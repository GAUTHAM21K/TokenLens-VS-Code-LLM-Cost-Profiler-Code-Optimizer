/**
 * Platform-agnostic store for the user's setup (enabled models, enhance model, platform).
 *
 * Exports: UserSetup, SetupStorageBackend, USER_SETUP_STORAGE_KEY, UserSetupStore
 * Feature: settings / API keys
 */
export interface UserSetup {
  platformId?: string;
  enabledModelsByProvider: Record<string, string[]>;
  enhanceModel?: {
    providerId: string;
    modelId: string;
    keySlot?: number;
  };
  copilotOnly: boolean;
}

export interface SetupStorageBackend {
  get<T>(key: string): Promise<T | undefined> | T | undefined;
  set<T>(key: string, value: T): Promise<void> | void;
}

export const USER_SETUP_STORAGE_KEY = "tokenOptimizer.userSetup";

/**
 * UserSetupStore persists and restores non-secret user preferences.
 * Adheres to Principle I: Never stores API key values or secrets.
 * Stored in globalState per Decision (2026-10-08).
 */
export class UserSetupStore {
  constructor(private backend: SetupStorageBackend) {}

  public async getSetup(): Promise<UserSetup> {
    const raw = await this.backend.get<Partial<UserSetup>>(USER_SETUP_STORAGE_KEY);
    return {
      platformId: raw?.platformId,
      enabledModelsByProvider: raw?.enabledModelsByProvider ?? {},
      enhanceModel: raw?.enhanceModel,
      copilotOnly: raw?.copilotOnly ?? false,
    };
  }

  public async saveSetup(setup: Partial<UserSetup>): Promise<UserSetup> {
    const existing = await this.getSetup();
    const updated: UserSetup = {
      platformId: setup.platformId !== undefined ? setup.platformId : existing.platformId,
      enabledModelsByProvider:
        setup.enabledModelsByProvider !== undefined
          ? setup.enabledModelsByProvider
          : existing.enabledModelsByProvider,
      enhanceModel:
        setup.enhanceModel !== undefined ? setup.enhanceModel : existing.enhanceModel,
      copilotOnly:
        setup.copilotOnly !== undefined ? setup.copilotOnly : existing.copilotOnly,
    };

    await this.backend.set(USER_SETUP_STORAGE_KEY, updated);
    return updated;
  }
}
