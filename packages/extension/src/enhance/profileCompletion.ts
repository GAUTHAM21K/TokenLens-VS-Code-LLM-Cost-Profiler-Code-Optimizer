/**
 * Enhance profile helpers: the LLM-facing profile schema (host-owned fields optional), the compact
 * field list + example JSON put in the Enhance prompt, host completion of the LLM's profile
 * (profileVersion, createdAt, schemaVersion, phase defaults) before ProjectProfileSchema
 * validation, and the repair prompt that lists the exact Zod issues.
 *
 * Exports: LlmProfileSchema, PROFILE_SHAPE_PROMPT, CompleteProfileOptions, unwrapProfilePayload,
 *   completeProfile, formatZodIssues, buildRepairPrompt
 * Feature: token cost estimator (Enhance)
 */
import { z } from "zod";
import {
  ProjectProfileSchema,
  ProfilePhaseSchema,
  type Phase,
} from "@token-optimizer/core";

/** What the LLM must produce: host-owned fields and phase bookkeeping are optional. */
export const LlmProfileSchema = ProjectProfileSchema.extend({
  schemaVersion: z.string().optional(),
  profileVersion: z.number().int().min(1).optional(),
  createdAt: z.string().optional(),
  phases: z
    .array(
      ProfilePhaseSchema.extend({
        id: ProfilePhaseSchema.shape.id.optional(),
        track: ProfilePhaseSchema.shape.track.optional(),
        name: ProfilePhaseSchema.shape.name.optional(),
        source: ProfilePhaseSchema.shape.source.optional(),
        confirmed: z.boolean().optional(),
      })
    )
    .max(40)
    .default([]),
});

const EXAMPLE = {
  narrative: "Customer-support RAG chatbot: retrieval over docs, one answer call per question.",
  profile: {
    projectType: "rag-chatbot",
    overview: "Support chatbot that answers product questions from indexed documentation.",
    techStack: [{ language: "python", framework: "langchain" }],
    llm: {
      providers: ["groq"],
      usesRag: true,
      usesAgents: false,
      avgPrefixTokens: 1200,
      avgPromptTokens: 1800,
      avgOutputTokens: 400,
      usesStructuredOutput: false,
    },
    components: [{ name: "Retriever", description: "Vector search over docs", llmRole: "retrieval" }],
    dataFlow: "Question -> retriever -> LLM answer -> user",
    phases: [{ phaseTypeId: "query-answering", track: "runtime", name: "Answer questions" }],
    scale: { requestsPerDay: 500, peakMultiplier: 2 },
    buildAssumptions: { teamSize: 2, sprintWeeks: 2, iterationsPerFeature: 3 },
    constraints: ["Keep latency under 2s"],
  },
};

/** Compact field list + example, appended to the Enhance prompt (or put at {{profileShape}}). */
export const PROFILE_SHAPE_PROMPT = `Respond with ONE JSON object: {"narrative": string, "profile": {...}}.
profile fields (required unless marked ?):
- projectType: short slug, e.g. "rag-chatbot", "agent", "batch-summarizer"
- overview: string, 20-4000 chars
- techStack: [{language, framework?, version?}]
- llm: {providers: string[], usesRag: bool, usesAgents: bool, agentCount?: int>=1, avgPrefixTokens?: int>=0 (shared static prompt prefix), avgPromptTokens: int>=1, avgOutputTokens: int>=1, avgConversationTurns?: int>=1, usesStructuredOutput?: bool, usesBatchProcessing?: bool, usesFunctionCalling?: bool}
- components: [{name, description, llmRole?}]
- dataFlow: string, 10-2000 chars
- phases: [{phaseTypeId (one of the phase ids listed above), track: "build"|"runtime", name}] - at least one
- scale: {requestsPerDay: number>=1, peakMultiplier?: number>=1, usersPerDay?: number>=1, monthlyDays?: int 1-31}
- buildAssumptions: {teamSize: int>=1, sprintWeeks: int>=1, iterationsPerFeature: number>=1}
- constraints: string[]
Do not add other keys. Do not send profileVersion, createdAt, schemaVersion or finalizedAt (the tool fills them).
Example:
${JSON.stringify(EXAMPLE)}`;

export interface CompleteProfileOptions {
  profileVersion: number;
  createdAt: string;
  catalogPhases: Phase[];
}

/** Accepts {narrative, profile} or a bare profile object; returns the parts. */
export function unwrapProfilePayload(payload: unknown): { narrative: string; profile: unknown } {
  const obj = (payload ?? {}) as Record<string, unknown>;
  if (obj.profile && typeof obj.profile === "object") {
    return { narrative: typeof obj.narrative === "string" ? obj.narrative : "", profile: obj.profile };
  }
  if ("projectType" in obj || "llm" in obj) {
    const { narrative, ...rest } = obj;
    return { narrative: typeof narrative === "string" ? narrative : "", profile: rest };
  }
  return { narrative: typeof obj.narrative === "string" ? obj.narrative : "", profile: undefined };
}

/**
 * Fills host-owned fields (overwriting whatever the LLM sent), drops finalizedAt, and defaults
 * phase id/track/name/source/confirmed from the catalog. Returns a new object; never throws.
 */
export function completeProfile(raw: unknown, options: CompleteProfileOptions): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const src = raw as Record<string, unknown>;
  const { finalizedAt: _ignored, ...rest } = src;
  void _ignored;
  const out: Record<string, unknown> = {
    ...rest,
    schemaVersion: typeof src.schemaVersion === "string" ? src.schemaVersion : "1.0",
    profileVersion: options.profileVersion,
    createdAt: options.createdAt,
  };

  if (Array.isArray(src.phases)) {
    const used = new Set<string>();
    out.phases = src.phases.map((p, i) => {
      if (!p || typeof p !== "object") return p;
      const ph = p as Record<string, unknown>;
      const cat = options.catalogPhases.find((c) => c.id === ph.phaseTypeId);
      let id = typeof ph.id === "string" && ph.id ? ph.id : `phase-${String(ph.phaseTypeId ?? i)}`;
      if (used.has(id)) id = `${id}-${i + 1}`;
      used.add(id);
      return {
        ...ph,
        id: id.slice(0, 64),
        track: ph.track ?? cat?.track,
        name: typeof ph.name === "string" && ph.name ? ph.name : cat?.name ?? String(ph.phaseTypeId ?? "Phase"),
        source: ph.source ?? "llm",
        confirmed: typeof ph.confirmed === "boolean" ? ph.confirmed : false,
      };
    });
  }
  return out;
}

/** One line per Zod issue: `- path: message (code)`. */
export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(root)"}: ${i.message} (${i.code})`)
    .join("\n");
}

/** Repair prompt: either the JSON parse failure or the exact list of schema issues. */
export function buildRepairPrompt(issues: z.ZodIssue[] | null): string {
  const problem = issues
    ? `The profile failed schema validation with these issues:\n${formatZodIssues(issues)}`
    : "The response was not parseable JSON.";
  return `${problem}\n\nReturn the corrected answer as ONE JSON object {"narrative": string, "profile": {...}} with every issue fixed, the same field names, and no other text.`;
}
