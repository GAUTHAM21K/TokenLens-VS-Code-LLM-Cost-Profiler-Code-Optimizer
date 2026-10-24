/**
 * Migration 007: creates the prompt_templates collection.
 *
 * Exports: up
 * Feature: catalog
 */
import type { Db } from "mongodb";

/**
 * Migration 007: Prompt Templates Collection & Seed Stubs
 * - Creates prompt_templates collection
 * - Index on id (unique) and { purpose: 1, active: 1 }
 * - Seeds templates for enhance, profile-extract, apply-edit, preview
 * - Idempotent
 */
export async function up(db: Db): Promise<void> {
  const collection = db.collection("prompt_templates");

  const templates = [
    {
      id: "enhance-default",
      version: 1,
      purpose: "enhance" as const,
      template:
        "You are an AI software architect and token optimization specialist. Analyze the following project description, architecture, and requirements to produce an optimized project profile and narrative.\n\nProject Description:\n{{description}}\n\nPhases available in catalog:\n{{phasesTaxonomy}}\n\nOutput valid JSON containing narrative and profile.",
      outputSchemaRef: "ProjectProfileSchema",
      active: true,
    },
    {
      id: "profile-extract-default",
      version: 1,
      purpose: "profile-extract" as const,
      template:
        "Extract project token estimation profile information from workspace codebase configuration.\n\nWorkspace Files:\n{{workspaceFiles}}\n\nOutput valid JSON project profile.",
      outputSchemaRef: "ProjectProfileSchema",
      active: true,
    },
    {
      id: "apply-edit-default",
      version: 1,
      purpose: "apply-edit" as const,
      template:
        "You are an automated refactoring engine. Apply the specified token optimization strategy to the target code snippet.\n\nStrategy: {{strategyName}}\nDetails: {{strategySummary}}\nCode:\n{{codeSnippet}}\n\nReturn strictly valid JSON EditProposal matching the schema.",
      outputSchemaRef: "EditProposalSchema",
      active: true,
    },
    {
      id: "preview-default",
      version: 1,
      purpose: "preview" as const,
      template:
        "Preview token reduction optimization for strategy {{strategyName}}.\n\nOriginal Text:\n{{inputText}}\n\nTransformed Text:\n{{transformedText}}",
      outputSchemaRef: undefined,
      active: true,
    },
  ];

  for (const tpl of templates) {
    await collection.updateOne(
      { id: tpl.id },
      {
        $set: tpl,
      },
      { upsert: true }
    );
  }

  await collection.createIndex({ id: 1 }, { unique: true, background: true });
  await collection.createIndex({ purpose: 1, active: 1 }, { background: true });
}
