/**
 * Validates confirmed project phases against the catalog phase taxonomy.
 *
 * Exports: UnconfirmedPhaseError, UnknownPhaseTypeError, PhaseTrackMismatchError, ResolvedPhase,
 *   resolvePhases, PhaseResolver
 * Feature: token cost estimator
 */
import type { ConfirmedPhase, Phase } from "../protocol/types.js";

export class UnconfirmedPhaseError extends Error {
  constructor(public readonly phaseId: string, public readonly phaseName: string) {
    super(`Phase '${phaseName}' (id: ${phaseId}) is not confirmed.`);
    this.name = "UnconfirmedPhaseError";
  }
}

export class UnknownPhaseTypeError extends Error {
  constructor(public readonly phaseTypeId: string, public readonly phaseId: string) {
    super(`Phase type '${phaseTypeId}' referenced by phase '${phaseId}' not found in catalog taxonomy.`);
    this.name = "UnknownPhaseTypeError";
  }
}

export class PhaseTrackMismatchError extends Error {
  constructor(
    public readonly phaseId: string,
    public readonly profileTrack: string,
    public readonly catalogTrack: string
  ) {
    super(
      `Phase '${phaseId}' has track '${profileTrack}' but catalog phase type defines track '${catalogTrack}'.`
    );
    this.name = "PhaseTrackMismatchError";
  }
}

export interface ResolvedPhase {
  id: string;
  phaseTypeId: string;
  name: string;
  track: "build" | "runtime";
  source: "llm" | "user" | "taxonomy-suggestion";
  confirmed: true;
  description: string;
  shortDescription?: string;
  sortOrder: number;
  archetypes: string[];
  defaultParams: Phase["defaultParams"];
  paramHints?: Record<string, string>;
  cacheablePrefix?: number;
}

/**
 * Pure function resolving confirmed project profile phases against catalog taxonomy.
 * (FR-017, FR-052, Principle IV)
 *
 * Guarantees:
 * - Deterministic: identical inputs produce byte-identical outputs.
 * - Rejects any unconfirmed phase with UnconfirmedPhaseError.
 * - Rejects unknown phaseTypeId with UnknownPhaseTypeError.
 * - Rejects track mismatch with PhaseTrackMismatchError.
 * - Attaches catalog description, defaultParams, paramHints, cacheablePrefix.
 * - Sorts by track ("build" then "runtime") then by catalog sortOrder ascending.
 */
export function resolvePhases(
  profilePhases: ConfirmedPhase[],
  catalogPhases: Phase[]
): ResolvedPhase[] {
  if (!Array.isArray(profilePhases)) {
    return [];
  }

  const catalogMap = new Map<string, Phase>();
  for (const cp of catalogPhases) {
    catalogMap.set(cp.id, cp);
  }

  const resolvedList: ResolvedPhase[] = [];

  for (const phase of profilePhases) {
    if (!phase.confirmed) {
      throw new UnconfirmedPhaseError(phase.id, phase.name);
    }

    const catalogPhase = catalogMap.get(phase.phaseTypeId);
    if (!catalogPhase) {
      throw new UnknownPhaseTypeError(phase.phaseTypeId, phase.id);
    }

    if (phase.track !== catalogPhase.track) {
      throw new PhaseTrackMismatchError(phase.id, phase.track, catalogPhase.track);
    }

    resolvedList.push({
      id: phase.id,
      phaseTypeId: phase.phaseTypeId,
      name: phase.name,
      track: phase.track,
      source: phase.source,
      confirmed: true,
      description: catalogPhase.description,
      shortDescription: catalogPhase.shortDescription,
      sortOrder: catalogPhase.sortOrder,
      archetypes: [...catalogPhase.archetypes],
      defaultParams: { ...catalogPhase.defaultParams },
      paramHints: catalogPhase.paramHints ? { ...catalogPhase.paramHints } : undefined,
      cacheablePrefix: catalogPhase.cacheablePrefix,
    });
  }

  // Sort: "build" track first, then "runtime" track; within track by sortOrder ascending, tie-breaker id
  resolvedList.sort((a, b) => {
    if (a.track !== b.track) {
      return a.track === "build" ? -1 : 1;
    }
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.id.localeCompare(b.id);
  });

  return resolvedList;
}

export const PhaseResolver = {
  resolve: resolvePhases,
};
