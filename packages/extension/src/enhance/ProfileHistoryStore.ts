/**
 * Persists versioned project profiles (history, finalize) in workspace state.
 *
 * Exports: PROFILE_HISTORY_STORAGE_KEY, MAX_PROFILE_HISTORY_VERSIONS, ProfileHistoryStore
 * Feature: token cost estimator
 */
import type * as vscode from "vscode";
import {
  ProjectProfileSchema,
  type ProfileHistoryEntry,
  type ProfileHistorySummary,
  type ProfilePhase,
} from "@token-optimizer/core";

export const PROFILE_HISTORY_STORAGE_KEY = "tokenOptimizer.profileHistory";
export const MAX_PROFILE_HISTORY_VERSIONS = 20;

export class ProfileHistoryStore {
  private workspaceState: vscode.Memento;

  constructor(workspaceState: vscode.Memento) {
    this.workspaceState = workspaceState;
  }

  /**
   * Retrieves all valid profile history entries, sorted by version ascending.
   * Validates each stored entry against ProjectProfileSchema and drops any invalid entries.
   */
  public getAll(): ProfileHistoryEntry[] {
    const raw = this.workspaceState.get<ProfileHistoryEntry[]>(
      PROFILE_HISTORY_STORAGE_KEY,
      []
    );
    if (!Array.isArray(raw)) {
      return [];
    }

    // Validate against ProjectProfileSchema and drop corrupted or obsolete records
    const valid = raw.filter((entry) => {
      if (!entry || typeof entry.version !== "number" || !entry.profile) {
        return false;
      }
      const parseResult = ProjectProfileSchema.safeParse(entry.profile);
      return parseResult.success;
    });

    return [...valid].sort((a, b) => a.version - b.version);
  }

  /**
   * Returns lightweight metadata summaries for webview hydration without sending full profiles.
   */
  public getSummaries(): ProfileHistorySummary[] {
    return this.getAll().map((e) => ({
      version: e.version,
      createdAt: e.createdAt,
      finalizedAt: e.finalizedAt,
      phaseCount: Array.isArray(e.profile?.phases) ? e.profile.phases.length : 0,
      costUsd: e.costUsd,
    }));
  }

  /**
   * Retrieves a specific profile history entry by version number.
   */
  public getVersion(version: number): ProfileHistoryEntry | undefined {
    const all = this.getAll();
    return all.find((entry) => entry.version === version);
  }

  /**
   * Retrieves the most recent profile history entry.
   */
  public getLatest(): ProfileHistoryEntry | undefined {
    const all = this.getAll();
    return all.length > 0 ? all[all.length - 1] : undefined;
  }

  /**
   * Determines the next sequential version number.
   */
  public getNextVersion(): number {
    const all = this.getAll();
    if (all.length === 0) {
      return 1;
    }
    const maxVersion = Math.max(...all.map((e) => e.version));
    return maxVersion + 1;
  }

  /**
   * Appends a new profile version entry to history.
   * Enforces monotonically increasing version number and max-20 FIFO eviction.
   */
  public async add(
    entry: Omit<ProfileHistoryEntry, "version"> & { version?: number }
  ): Promise<ProfileHistoryEntry> {
    const current = this.getAll();
    const version = entry.version ?? this.getNextVersion();
    const createdAt = entry.createdAt || new Date().toISOString();

    const effectiveFinalizedAt = entry.finalizedAt ?? entry.profile?.finalizedAt;
    const finalizedEntry: ProfileHistoryEntry = {
      ...entry,
      version,
      createdAt,
      finalizedAt: effectiveFinalizedAt,
      profile: {
        ...entry.profile,
        profileVersion: version,
        createdAt,
        finalizedAt: effectiveFinalizedAt,
      },
    };

    // Filter out duplicate if version already exists, then append
    const updated = current.filter((e) => e.version !== version);
    updated.push(finalizedEntry);

    // Sort ascending by version
    updated.sort((a, b) => a.version - b.version);

    // Max 20 versions eviction: protect finalized versions by evicting oldest unfinalized drafts first
    let trimmed = updated;
    if (updated.length > MAX_PROFILE_HISTORY_VERSIONS) {
      const excess = updated.length - MAX_PROFILE_HISTORY_VERSIONS;
      const unfinalized = updated.filter((e) => !e.finalizedAt);
      const toRemove = new Set<number>();
      for (let i = 0; i < unfinalized.length && toRemove.size < excess; i++) {
        toRemove.add(unfinalized[i].version);
      }
      if (toRemove.size < excess) {
        for (const e of updated) {
          if (!toRemove.has(e.version)) {
            toRemove.add(e.version);
            if (toRemove.size === excess) break;
          }
        }
      }
      trimmed = updated.filter((e) => !toRemove.has(e.version));
    }

    await this.workspaceState.update(PROFILE_HISTORY_STORAGE_KEY, trimmed);
    return finalizedEntry;
  }

  /**
   * Marks a profile version as finalized with an ISO timestamp.
   */
  public async markFinal(
    version: number,
    finalizedAt: string = new Date().toISOString()
  ): Promise<ProfileHistoryEntry | undefined> {
    const all = this.getAll();
    const target = all.find((e) => e.version === version);
    if (!target) {
      return undefined;
    }

    target.finalizedAt = finalizedAt;
    target.profile = {
      ...target.profile,
      finalizedAt,
    };

    await this.workspaceState.update(PROFILE_HISTORY_STORAGE_KEY, all);
    return target;
  }

  /**
   * Creates a new draft version from an existing profile with edited phases.
   * Zero adapter/LLM calls (FR-052).
   */
  public async createDraftWithPhases(
    baseVersion: number,
    phases: ProfilePhase[]
  ): Promise<ProfileHistoryEntry | undefined> {
    const base = this.getVersion(baseVersion);
    if (!base) {
      return undefined;
    }

    const nextVersion = this.getNextVersion();
    const now = new Date().toISOString();

    const newProfile = {
      ...base.profile,
      profileVersion: nextVersion,
      phases,
      createdAt: now,
      finalizedAt: undefined,
    };

    return this.add({
      version: nextVersion,
      narrative: base.narrative,
      profile: newProfile,
      createdAt: now,
      finalizedAt: undefined,
      costUsd: 0,
      tokens: { inputTokens: 0, outputTokens: 0 },
    });
  }

  /**
   * Clears the profile history (e.g. for testing).
   */
  public async clear(): Promise<void> {
    await this.workspaceState.update(PROFILE_HISTORY_STORAGE_KEY, []);
  }
}
