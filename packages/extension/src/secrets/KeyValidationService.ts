/**
 * Validates saved API keys through the provider adapters and reports the result to the webview.
 *
 * Exports: KeyValidationServiceOptions, KeyValidationService
 * Feature: settings / API keys
 */
import type { HostToWebviewMsg } from "@token-optimizer/core";
import type { ProviderAdapter } from "@token-optimizer/core";
import { KeyService } from "./KeyService.js";
import type { MessageRouter } from "../webview/MessageRouter.js";

export interface KeyValidationServiceOptions {
  keyService: KeyService;
  adapters: Map<string, ProviderAdapter>;
  router?: MessageRouter;
  postMessage?: (msg: unknown) => Promise<boolean>;
}

export class KeyValidationService {
  private keyService: KeyService;
  private adapters: Map<string, ProviderAdapter>;
  private postFn?: (msg: unknown) => Promise<boolean>;

  constructor(options: KeyValidationServiceOptions) {
    this.keyService = options.keyService;
    this.adapters = options.adapters;
    if (options.router) {
      this.postFn = (msg) => options.router!.send(msg as HostToWebviewMsg);
    } else if (options.postMessage) {
      this.postFn = options.postMessage;
    }
  }

  /**
   * Validates and saves an API key.
   * If validation succeeds, stores in KeyService and posts auth/keySaved.
   * If validation fails, posts auth/keyError and DOES NOT store the key (FR-005).
   */
  public async validateAndSaveKey(
    providerId: string,
    slot: number,
    rawKey: string
  ): Promise<boolean> {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      await this.postError(
        providerId,
        slot,
        "invalid",
        `Unknown provider '${providerId}'.`
      );
      return false;
    }

    try {
      const result = await adapter.validateKey(async () => rawKey);

      if (result.valid) {
        await this.keyService.storeKey(providerId, slot, rawKey);
        const maskedKey = KeyService.maskKey(rawKey);

        await this.postSuccess(providerId, slot, maskedKey);
        return true;
      }

      const reason = result.reason || "invalid";
      await this.postError(
        providerId,
        slot,
        reason,
        result.message || "Key validation failed."
      );
      return false;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error during key validation.";
      await this.postError(
        providerId,
        slot,
        "unreachable",
        message
      );
      return false;
    }
  }

  private async postSuccess(
    providerId: string,
    keySlot: number,
    maskedKey: string
  ): Promise<void> {
    if (this.postFn) {
      await this.postFn({
        version: 1,
        type: "auth/keySaved",
        payload: {
          providerId,
          keySlot,
          maskedKey,
        },
      });
    }
  }

  private async postError(
    providerId: string,
    keySlot: number,
    error: "invalid" | "unreachable" | "rate-limited",
    message: string
  ): Promise<void> {
    if (this.postFn) {
      await this.postFn({
        version: 1,
        type: "auth/keyError",
        payload: {
          providerId,
          keySlot,
          error,
          message,
        },
      });
    }
  }
}
