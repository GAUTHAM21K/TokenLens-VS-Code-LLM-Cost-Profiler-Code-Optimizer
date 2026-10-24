/**
 * ProjectProfile Zod schema (the finalized output of Enhance, input of estimation).
 *
 * Exports: ProfilePhaseSchema, ProfileTechStackSchema, ProfileComponentSchema, ProfileLlmSchema,
 *   ProfileScaleSchema, ProfileBuildAssumptionsSchema, ProjectProfileSchema, ProjectProfile,
 *   ProfilePhase, ProfileTechStack, ProfileComponent, ProfileLlm, ProfileScale,
 *   ProfileBuildAssumptions, ProfileHistoryEntry
 * Feature: token cost estimator
 */
import { z } from "zod";

export const ProfilePhaseSchema = z
  .object({
    id: z.string().min(1).max(64),
    phaseTypeId: z.string().min(1).max(100),
    track: z.enum(["build", "runtime"]),
    name: z.string().min(1).max(120),
    source: z.enum(["llm", "user", "taxonomy-suggestion"]),
    confirmed: z.boolean(),
  })
  .strict();

export const ProfileTechStackSchema = z
  .object({
    language: z.string().min(1).max(100),
    framework: z.string().max(100).optional(),
    version: z.string().max(50).optional(),
  })
  .strict();

export const ProfileComponentSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000),
    llmRole: z.string().max(200).optional(),
  })
  .strict();

export const ProfileLlmSchema = z
  .object({
    providers: z.array(z.string().max(100)).default([]),
    usesRag: z.boolean(),
    usesAgents: z.boolean(),
    agentCount: z.number().int().min(1).optional(),
    avgPrefixTokens: z.number().int().min(0).optional(),
    avgPromptTokens: z.number().int().min(1),
    avgOutputTokens: z.number().int().min(1),
    avgConversationTurns: z.number().int().min(1).optional(),
    usesStructuredOutput: z.boolean().optional(),
    usesBatchProcessing: z.boolean().optional(),
    usesFunctionCalling: z.boolean().optional(),
  })
  .strict();

export const ProfileScaleSchema = z
  .object({
    requestsPerDay: z.number().min(1),
    peakMultiplier: z.number().min(1.0).default(2.0),
    usersPerDay: z.number().min(1).optional(),
    sessionsPerUserPerDay: z.number().min(1).default(1).optional(),
    monthlyDays: z.number().int().min(1).max(31).default(22).optional(),
  })
  .strict();

export const ProfileBuildAssumptionsSchema = z
  .object({
    teamSize: z.number().int().min(1),
    sprintWeeks: z.number().int().min(1),
    iterationsPerFeature: z.number().min(1),
  })
  .strict();

export const ProjectProfileSchema = z
  .object({
    schemaVersion: z.string().default("1.0"),
    projectType: z.string().min(1).max(100),
    overview: z.string().min(20).max(4000),
    techStack: z.array(ProfileTechStackSchema).default([]),
    llm: ProfileLlmSchema,
    components: z.array(ProfileComponentSchema).default([]),
    dataFlow: z.string().min(10).max(2000),
    phases: z.array(ProfilePhaseSchema).max(40).default([]),
    scale: ProfileScaleSchema,
    buildAssumptions: ProfileBuildAssumptionsSchema,
    constraints: z.array(z.string().max(500)).default([]),
    profileVersion: z.number().int().min(1),
    createdAt: z.string(),
    finalizedAt: z.string().optional(),
  })
  .strict();

export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type ProfilePhase = z.infer<typeof ProfilePhaseSchema>;
export type ProfileTechStack = z.infer<typeof ProfileTechStackSchema>;
export type ProfileComponent = z.infer<typeof ProfileComponentSchema>;
export type ProfileLlm = z.infer<typeof ProfileLlmSchema>;
export type ProfileScale = z.infer<typeof ProfileScaleSchema>;
export type ProfileBuildAssumptions = z.infer<typeof ProfileBuildAssumptionsSchema>;

export interface ProfileHistoryEntry {
  version: number;
  narrative: string;
  profile: ProjectProfile;
  createdAt: string;
  finalizedAt?: string;
  costUsd?: number;
  tokens?: {
    inputTokens: number;
    outputTokens: number;
  };
}
