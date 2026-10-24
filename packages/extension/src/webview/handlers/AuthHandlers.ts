/**
 * Host handlers for API keys, enabled models, platform and Enhance model selection.
 *
 * Exports: AuthHandlersOptions, AuthHandlers
 * Feature: settings / API keys
 */
import * as vscode from "vscode";
import {
  UserSetupStore,
  type CatalogSnapshot,
} from "@token-optimizer/core";
import { KeyService } from "../../secrets/KeyService.js";
import { KeyValidationService } from "../../secrets/KeyValidationService.js";
import { PlatformDetector } from "../../platform/PlatformDetector.js";
import { HostLmAdapter } from "../../lm/HostLmAdapter.js";
import { VsCodeUserSetupBackend } from "../../setup/VsCodeUserSetupBackend.js";
import type { MessageRouter } from "../MessageRouter.js";

export interface AuthHandlersOptions {
  context: vscode.ExtensionContext;
  router: MessageRouter;
  keyService: KeyService;
  validationService: KeyValidationService;
  getCatalogSnapshot: () => CatalogSnapshot | null;
  hostLmAdapter?: HostLmAdapter;
}

export class AuthHandlers {
  private context: vscode.ExtensionContext;
  private router: MessageRouter;
  private keyService: KeyService;
  private validationService: KeyValidationService;
  private getCatalogSnapshot: () => CatalogSnapshot | null;
  private hostLmAdapter?: HostLmAdapter;
  private setupStore: UserSetupStore;

  constructor(options: AuthHandlersOptions) {
    this.context = options.context;
    this.router = options.router;
    this.keyService = options.keyService;
    this.validationService = options.validationService;
    this.getCatalogSnapshot = options.getCatalogSnapshot;
    this.hostLmAdapter = options.hostLmAdapter;
    this.setupStore = new UserSetupStore(
      new VsCodeUserSetupBackend(this.context.globalState)
    );
  }

  public register(): void {
    // 1. auth/saveKey
    this.router.register("auth/saveKey", async (msg) => {
      let rawKey = String(msg.payload.key);
      const providerId = msg.payload.providerId;
      const keySlot = msg.payload.keySlot ?? 0;

      try {
        const success = await this.validationService.validateAndSaveKey(
          providerId,
          keySlot,
          rawKey
        );
        if (success) {
          await this.postAuthState();
        }
      } finally {
        // Principle I: Immediately clear raw key variable
        rawKey = "";
      }
    });

    // 2. auth/removeKey
    this.router.register("auth/removeKey", async (msg) => {
      const providerId = msg.payload.providerId;
      const keySlot = msg.payload.keySlot ?? 0;

      await this.keyService.deleteKey(providerId, keySlot);

      await this.router.send({
        version: 1,
        type: "auth/keyRemoved",
        payload: {
          providerId,
          keySlot,
        },
      });

      await this.postAuthState();
    });

    // 3. auth/setEnabledModels (persisted via UserSetupStore in globalState)
    this.router.register("auth/setEnabledModels", async (msg) => {
      const { providerId, enabledModels } = msg.payload;
      const setup = await this.setupStore.getSetup();
      await this.setupStore.saveSetup({
        enabledModelsByProvider: {
          ...setup.enabledModelsByProvider,
          [providerId]: enabledModels,
        },
      });
      await this.postAuthState();
    });

    // 4. auth/setPlatform (validates against catalog platforms and persists in globalState, T132)
    this.router.register("auth/setPlatform", async (msg) => {
      const { platformId } = msg.payload;
      const catalog = this.getCatalogSnapshot();
      if (catalog && catalog.platforms && catalog.platforms.length > 0) {
        const isValid = catalog.platforms.some((p) => p.id === platformId);
        if (!isValid) {
          console.warn(`[AuthHandlers] Unknown platformId rejected: ${platformId}`);
          return;
        }
      }
      await this.setupStore.saveSetup({ platformId });
      await this.postAuthState();
    });

    // 5. auth/setEnhanceModel (persisted in globalState via UserSetupStore, T131)
    this.router.register("auth/setEnhanceModel", async (msg) => {
      await this.setupStore.saveSetup({ enhanceModel: msg.payload });
      await this.postAuthState();
    });

    // 6. auth/setCopilotOnly (persisted in globalState via UserSetupStore, T131)
    this.router.register("auth/setCopilotOnly", async (msg) => {
      await this.setupStore.saveSetup({ copilotOnly: msg.payload.copilotOnly });
      await this.postAuthState();
    });

    // 7. On webview/ready, post initial auth/state
    this.router.register("webview/ready", async () => {
      await this.postAuthState();
    });
  }

  /**
   * Posts current auth/state envelope to the webview.
   * NEVER contains raw keys (Principle I & II).
   */
  public async postAuthState(): Promise<void> {
    const catalog = this.getCatalogSnapshot();
    const providers = catalog?.providers || [];
    const setup = await this.setupStore.getSetup();

    // 1. Determine platform
    const overriddenPlatform = setup.platformId;
    let detectedPlatformId = "vscode";
    if (catalog) {
      try {
        const detected = PlatformDetector.detect(catalog, {
          appName: typeof vscode !== "undefined" ? vscode.env?.appName : undefined,
          uriScheme: typeof vscode !== "undefined" ? vscode.env?.uriScheme : undefined,
          workspaceRoot:
            typeof vscode !== "undefined" && vscode.workspace?.workspaceFolders?.[0]
              ? vscode.workspace.workspaceFolders[0].uri.fsPath
              : undefined,
        });
        detectedPlatformId = detected.id;
      } catch {
        // Fall back to first platform if detection failed
        detectedPlatformId = catalog.platforms[0]?.id || "vscode";
      }
    }
    const currentPlatform = overriddenPlatform || detectedPlatformId;

    // 2. Determine configured keys (masked only)
    const configuredKeysRaw = await this.keyService.listConfigured(providers);
    const configuredKeys = configuredKeysRaw.map((k) => {
      const enabled = setup.enabledModelsByProvider[k.providerId] || [];
      return {
        providerId: k.providerId,
        keySlot: k.keySlot,
        maskedKey: k.maskedKey,
        enabledModels: enabled,
      };
    });

    // 3. Copilot availability
    let copilotAvailable = false;
    if (this.hostLmAdapter) {
      copilotAvailable = await this.hostLmAdapter.isAvailable();
    }
    const copilotOnly = setup.copilotOnly;

    // 4. Enhance model preference
    const enhanceModel = setup.enhanceModel;

    await this.router.send({
      version: 1,
      type: "auth/state",
      payload: {
        platform: currentPlatform,
        configuredKeys,
        copilotAvailable,
        copilotOnly,
        platformOverridden: Boolean(overriddenPlatform),
        enhanceModel,
      },
    });
  }
}
