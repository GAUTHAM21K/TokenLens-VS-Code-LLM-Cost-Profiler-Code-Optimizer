/**
 * Suggests catalog phases for a project profile.
 *
 * Exports: suggestPhases
 * Feature: token cost estimator
 */
import type { ProfilePhase, ProjectProfile } from "../profile/schema.js";
import type { Phase } from "../protocol/types.js";

/**
 * Deterministically suggest catalog phases when Enhance returns no usable phases.
 * (FR-052, US2 scenario 11, Principle IV)
 *
 * Guarantees:
 * - Deterministic: repeat calls with identical input produce byte-identical outputs.
 * - Every returned phaseTypeId exists in catalogPhases.
 * - All suggested phases have source: "taxonomy-suggestion" and confirmed: false.
 * - Zero vscode imports (packages/core).
 */
export function suggestPhases(
  profile: Pick<ProjectProfile, "projectType" | "llm">,
  catalogPhases: Phase[]
): ProfilePhase[] {
  if (!catalogPhases || catalogPhases.length === 0) {
    return [];
  }

  const projectType = (profile.projectType || "").toLowerCase().trim();
  const usesRag = Boolean(profile.llm?.usesRag);
  const usesAgents = Boolean(profile.llm?.usesAgents);

  // Filter catalog phases deterministically
  const matched = catalogPhases.filter((phase) => {
    const archetypes = phase.archetypes.map((a) => a.toLowerCase());
    if (archetypes.includes(projectType)) {
      return true;
    }
    if (archetypes.includes("general")) {
      return true;
    }
    if (usesRag && archetypes.includes("rag-chatbot")) {
      return true;
    }
    if (usesAgents && archetypes.includes("coding-agent")) {
      return true;
    }
    return false;
  });

  const finalPhases = matched.length > 0 ? matched : catalogPhases;

  // Sort deterministically by sortOrder, then by id
  const sorted = [...finalPhases].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.id.localeCompare(b.id);
  });

  return sorted.map((phase) => ({
    id: `phase-${phase.id}`,
    phaseTypeId: phase.id,
    track: phase.track,
    name: phase.name,
    source: "taxonomy-suggestion" as const,
    confirmed: false,
  }));
}
