/**
 * Host handlers for Enhance runs, profile history, phase edits and finalize.
 *
 * Exports: EnhanceHandlersOptions, EnhanceHandlers
 * Feature: token cost estimator
 */
import * as vscode from "vscode";
import type {
  CatalogSnapshot,
  HostToWebviewMsg,
} from "@token-optimizer/core";
import type { MessageRouter } from "../MessageRouter.js";
import type { EnhanceService } from "../../enhance/EnhanceService.js";
import type { ProfileHistoryStore } from "../../enhance/ProfileHistoryStore.js";
import { WorkspaceScanner } from "../../workspace/WorkspaceScanner.js";

export interface EnhanceHandlersOptions {
  context: vscode.ExtensionContext;
  router: MessageRouter;
  enhanceService: EnhanceService;
  historyStore: ProfileHistoryStore;
  getCatalogSnapshot: () => CatalogSnapshot | null;
}

export class EnhanceHandlers {
  private context: vscode.ExtensionContext;
  private router: MessageRouter;
  private enhanceService: EnhanceService;
  private historyStore: ProfileHistoryStore;
  private getCatalogSnapshot: () => CatalogSnapshot | null;

  constructor(options: EnhanceHandlersOptions) {
    this.context = options.context;
    this.router = options.router;
    this.enhanceService = options.enhanceService;
    this.historyStore = options.historyStore;
    this.getCatalogSnapshot = options.getCatalogSnapshot;
  }

  public register(): void {
    // 1. enhance/run
    this.router.register("enhance/run", async (msg) => {
      const payload = msg.payload;
      await this.enhanceService.run({
        description: payload.description,
        providerId: payload.providerId,
        modelId: payload.modelId,
        keySlot: payload.keySlot,
        previousProfileVersion: payload.previousProfileVersion,
      });
    });

    // 2. enhance/finalize (T061, T148, FR-015, FR-052)
    this.router.register("enhance/finalize", async (msg) => {
      const { profileVersion } = msg.payload;
      const entry = this.historyStore.getVersion(profileVersion);

      if (!entry) {
        await this.postToWebview({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "schema-invalid",
            message: `Profile version ${profileVersion} not found in history store.`,
          },
        });
        return;
      }

      const phases = entry.profile.phases || [];

      // Guard 1: At least one phase required
      if (phases.length === 0) {
        await this.postToWebview({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "schema-invalid",
            message: "Cannot finalize profile: at least one phase is required.",
          },
        });
        return;
      }

      // Guard 2: Unknown phase type
      const snapshot = this.getCatalogSnapshot();
      const catalogPhases = snapshot?.phases || [];
      const validPhaseTypes = new Map(catalogPhases.map((p) => [p.id, p]));

      for (const phase of phases) {
        if (!validPhaseTypes.has(phase.phaseTypeId)) {
          await this.postToWebview({
            version: 1,
            type: "enhance/error",
            payload: {
              error: "schema-invalid",
              message: `Cannot finalize profile: phase '${phase.name}' references unknown catalog phase type '${phase.phaseTypeId}'.`,
            },
          });
          return;
        }
      }

      // Guard 3: Unconfirmed phases
      const unconfirmed = phases.filter((p) => !p.confirmed);
      if (unconfirmed.length > 0) {
        const names = unconfirmed.map((p) => `'${p.name}'`).join(", ");
        await this.postToWebview({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "schema-invalid",
            message: `Cannot finalize profile: all phases must be confirmed before finalization (${names} unconfirmed).`,
          },
        });
        return;
      }

      // Finalize and mark timestamp
      const finalized = await this.historyStore.markFinal(profileVersion);
      if (finalized) {
        await this.postToWebview({
          version: 1,
          type: "enhance/profileFinalized",
          payload: {
            profileVersion,
          },
        });
        await this.sendHistory();
      }
    });

    // 3. enhance/editPhases (T148, FR-052) - ZERO adapter calls
    this.router.register("enhance/editPhases", async (msg) => {
      const { profileVersion, phases } = msg.payload;
      const snapshot = this.getCatalogSnapshot();
      const catalogPhases = snapshot?.phases || [];
      const catalogMap = new Map(catalogPhases.map((p) => [p.id, p]));

      // Validate edited phases against catalog
      const problems: Array<{
        phaseId: string;
        problem: "unknown-type" | "track-mismatch" | "unconfirmed";
      }> = [];

      for (const phase of phases) {
        const catalogPhase = catalogMap.get(phase.phaseTypeId);
        if (!catalogPhase) {
          problems.push({ phaseId: phase.id, problem: "unknown-type" });
        } else if (catalogPhase.track !== phase.track) {
          problems.push({ phaseId: phase.id, problem: "track-mismatch" });
        }

        if (!phase.confirmed) {
          problems.push({ phaseId: phase.id, problem: "unconfirmed" });
        }
      }

      // Create new draft version in ProfileHistoryStore without LLM call
      const newEntry = await this.historyStore.createDraftWithPhases(
        profileVersion,
        phases
      );

      if (newEntry) {
        await this.postToWebview({
          version: 1,
          type: "enhance/phasesUpdated",
          payload: {
            profileVersion: newEntry.version,
            phases: newEntry.profile.phases,
            problems,
          },
        });
        await this.sendHistory();
      }
    });

    // 4. On webview/ready handshake, send initial history summaries
    this.router.register("webview/ready", async () => {
      await this.sendHistory();
    });

    // 5. enhance/getHistory
    this.router.register("enhance/getHistory", async () => {
      await this.sendHistory();
    });

    // 6. enhance/getVersion - fetch full profile on demand
    this.router.register("enhance/getVersion", async (msg) => {
      const { version } = msg.payload;
      const entry = this.historyStore.getVersion(version);
      if (entry) {
        await this.postToWebview({
          version: 1,
          type: "enhance/versionLoaded",
          payload: {
            entry,
          },
        });
      } else {
        await this.postToWebview({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "schema-invalid",
            message: `Profile version ${version} not found in history store.`,
          },
        });
      }
    });

    // 7. enhance/clearHistory
    this.router.register("enhance/clearHistory", async () => {
      await this.historyStore.clear();
      await this.postToWebview({
        version: 1,
        type: "enhance/historyCleared",
        payload: {},
      });
    });
  }

  public async sendHistory(): Promise<void> {
    await this.postToWebview({
      version: 1,
      type: "enhance/historyLoaded",
      payload: {
        summaries: this.historyStore.getSummaries(),
      },
    });
  }

  /**
   * Scans workspace to produce prefill draft if workspace is open.
   */
  public async getWorkspacePreFill(): Promise<string> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return WorkspaceScanner.scanWorkspace(folder);
  }

  private async postToWebview(msg: HostToWebviewMsg): Promise<void> {
    await this.router.send(msg);
  }
}
