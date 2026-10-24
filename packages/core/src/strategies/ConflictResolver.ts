/**
 * Detects conflicts between selected techniques: declared `conflicts` pairs (symmetric, reported
 * once) and unmet `requires` dependencies. Pure; no catalog or host access.
 *
 * Exports: StrategyConflict, findConflicts, ConflictResolver
 * Feature: token cost estimator (techniques savings)
 */
import type { Strategy } from "../protocol/types.js";

export interface StrategyConflict {
  a: string;
  b: string;
  explanation: string;
}

/**
 * Conflicts within `selected`. `all` resolves names for ids that are required but not selected.
 * Order follows `selected`, so the result is deterministic for a given selection order.
 */
export function findConflicts(selected: Strategy[], all: Strategy[] = selected): StrategyConflict[] {
  const selectedIds = new Set(selected.map((s) => s.id));
  const nameOf = (id: string) => all.find((s) => s.id === id)?.name ?? id;
  const seen = new Set<string>();
  const out: StrategyConflict[] = [];

  for (const s of selected) {
    for (const other of selected) {
      if (other.id === s.id) continue;
      const declared = s.conflicts?.includes(other.id) || other.conflicts?.includes(s.id);
      const key = [s.id, other.id].sort().join("|");
      if (declared && !seen.has(key)) {
        seen.add(key);
        out.push({
          a: s.id,
          b: other.id,
          explanation: `${s.name} conflicts with ${other.name}; their savings should not be combined.`,
        });
      }
    }
    for (const req of s.requires ?? []) {
      if (!selectedIds.has(req)) {
        out.push({
          a: s.id,
          b: req,
          explanation: `${s.name} requires ${nameOf(req)}, which is not selected.`,
        });
      }
    }
  }
  return out;
}

export const ConflictResolver = {
  find: findConflicts,
};
