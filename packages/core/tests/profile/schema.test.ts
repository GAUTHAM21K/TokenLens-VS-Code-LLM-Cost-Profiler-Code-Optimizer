/**
 * Tests: ProjectProfileSchema Unit Tests (T057, contracts/project-profile.schema.json, FR-010).
 *
 * Exports: none (test suite)
 * Feature: token cost estimator
 */
import { describe, it, expect } from "vitest";
import { ProjectProfileSchema, type ProjectProfile } from "../../src/profile/schema.js";

describe("ProjectProfileSchema Unit Tests (T057, contracts/project-profile.schema.json, FR-010)", () => {
  it("validates a complete project profile conforming to the JSON Schema contract", () => {
    const validProfile: ProjectProfile = {
      schemaVersion: "1.0",
      projectType: "rag-chatbot",
      overview: "A retrieval-augmented enterprise chatbot answering questions over knowledge documents with sub-second latency.",
      techStack: [
        { language: "TypeScript", framework: "Next.js", version: "14.2" },
        { language: "Python", framework: "FastAPI" },
      ],
      llm: {
        providers: ["anthropic", "openai"],
        usesRag: true,
        usesAgents: false,
        avgPromptTokens: 1200,
        avgOutputTokens: 350,
        avgPrefixTokens: 800,
        usesStructuredOutput: true,
      },
      components: [
        {
          name: "Ingestion Pipeline",
          description: "Chunks PDFs and embeds chunks into vector storage.",
          llmRole: "generates document summaries",
        },
        {
          name: "Chat Interface",
          description: "Streams conversational answers with citations.",
          llmRole: "answers queries",
        },
      ],
      dataFlow: "User submits query -> vector retrieval extracts top 5 chunks -> system prompt + chunks passed to LLM -> response streamed back.",
      phases: [
        {
          id: "build-agent-dev",
          phaseTypeId: "agent-development",
          track: "build",
          name: "Prompt tuning and eval",
          source: "taxonomy-suggestion",
          confirmed: true,
        },
        {
          id: "runtime-chat",
          phaseTypeId: "user-query",
          track: "runtime",
          name: "Live user chat queries",
          source: "llm",
          confirmed: true,
        },
      ],
      scale: {
        requestsPerDay: 5000,
        peakMultiplier: 2.5,
        monthlyDays: 22,
      },
      buildAssumptions: {
        teamSize: 3,
        sprintWeeks: 4,
        iterationsPerFeature: 2,
      },
      constraints: ["Latency must stay under 2 seconds", "No cloud key logging"],
      profileVersion: 1,
      createdAt: "2026-10-09T00:00:00.000Z",
    };

    const parsed = ProjectProfileSchema.parse(validProfile);
    expect(parsed.projectType).toBe("rag-chatbot");
    expect(parsed.llm.usesRag).toBe(true);
    expect(parsed.scale.requestsPerDay).toBe(5000);
  });

  it("fails validation when mandatory fields are missing or below bounds", () => {
    const invalidProfile = {
      schemaVersion: "1.0",
      projectType: "test",
      overview: "Too short", // minLength 20 required
      techStack: [],
      llm: {
        providers: [],
        usesRag: false,
        usesAgents: false,
        avgPromptTokens: 0, // min 1
        avgOutputTokens: 0,
      },
      components: [],
      dataFlow: "Short", // minLength 10
      phases: [],
      scale: { requestsPerDay: 0 }, // min 1
      buildAssumptions: { teamSize: 0, sprintWeeks: 0, iterationsPerFeature: 0 },
      constraints: [],
      profileVersion: 0, // min 1
      createdAt: "not-a-date",
    };

    expect(() => ProjectProfileSchema.parse(invalidProfile)).toThrow();
  });
});
