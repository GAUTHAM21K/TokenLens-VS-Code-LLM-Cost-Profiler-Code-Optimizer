/**
 * Stores API keys in VS Code SecretStorage and exposes them only via getter closures.
 *
 * Exports: ConfiguredKeyInfo, KeyService
 * Feature: settings / API keys
 */
import type * as vscode from "vscode";

export interface ConfiguredKeyInfo {
  providerId: string;
  keySlot: number;
  maskedKey: string;
}

export class KeyService {
  private static readonly KEY_PREFIX = "provider:";

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * Builds the namespaced secret key format: provider:{id}:{slot}
   */
  public static formatSecretKey(providerId: string, slot: number): string {
    if (!Number.isInteger(slot) || slot < 0 || slot > 10) {
      throw new Error(`Invalid key slot '${slot}': must be an integer between 0 and 10.`);
    }
    return `${KeyService.KEY_PREFIX}${providerId}:${slot}`;
  }

  /**
   * Masks a raw API key for display/protocol transmission.
   * Produces '...' followed by up to 4 trailing characters (matches MaskedKeySchema).
   */
  public static maskKey(key: string): string {
    if (!key) return "...";
    const trimmed = key.trim();
    if (trimmed.length <= 4) {
      return `...${trimmed}`;
    }
    return `...${trimmed.slice(-4)}`;
  }

  /**
   * Stores an API key into SecretStorage.
   */
  public async storeKey(
    providerId: string,
    slot: number,
    rawKey: string
  ): Promise<void> {
    const secretKey = KeyService.formatSecretKey(providerId, slot);
    await this.secrets.store(secretKey, rawKey.trim());
  }

  /**
   * Returns a getter closure `() => Promise<string>` that retrieves the secret on-demand.
   * NEVER returns a raw string directly (Principle I & Research Decision 9).
   */
  public getKeyGetter(
    providerId: string,
    slot: number
  ): () => Promise<string> {
    const secretKey = KeyService.formatSecretKey(providerId, slot);
    return async (): Promise<string> => {
      const secret = await this.secrets.get(secretKey);
      if (!secret) {
        throw new Error(
          `No key configured for provider '${providerId}' (slot ${slot})`
        );
      }
      return secret;
    };
  }

  /**
   * Deletes a key from SecretStorage.
   */
  public async deleteKey(providerId: string, slot: number): Promise<void> {
    const secretKey = KeyService.formatSecretKey(providerId, slot);
    await this.secrets.delete(secretKey);
  }

  /**
   * Lists all configured keys with masked values only.
   * Uses known providers or internal tracking if available.
   */
  public async listConfigured(
    knownProviders: Array<{ id: string }>,
    maxSlots = 5
  ): Promise<ConfiguredKeyInfo[]> {
    const results: ConfiguredKeyInfo[] = [];

    for (const provider of knownProviders) {
      for (let slot = 0; slot <= maxSlots; slot++) {
        const secretKey = KeyService.formatSecretKey(provider.id, slot);
        const secret = await this.secrets.get(secretKey);
        if (secret) {
          results.push({
            providerId: provider.id,
            keySlot: slot,
            maskedKey: KeyService.maskKey(secret),
          });
        }
      }
    }

    return results;
  }
}
