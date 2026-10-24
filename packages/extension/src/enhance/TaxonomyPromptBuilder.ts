/**
 * Builds the phase-taxonomy section of the Enhance prompt within a token budget.
 *
 * Exports: TaxonomyBudgetLevel, BuildTaxonomyPromptOptions, BuildTaxonomyPromptResult,
 *   TaxonomyPromptBuilder
 * Feature: token cost estimator
 */
import type { Phase } from "@token-optimizer/core";

export type TaxonomyBudgetLevel = "full" | "short" | "compact";

export interface BuildTaxonomyPromptOptions {
  modelContextWindow: number;
  modelMaxOutput?: number;
  description: string;
  previousProfileContext?: string;
  catalogPhases: Phase[];
}

export interface BuildTaxonomyPromptResult {
  level: TaxonomyBudgetLevel;
  phasesTaxonomyText: string;
  estimatedTaxonomyTokens: number;
  availableBudgetTokens: number;
}

export class TaxonomyPromptBuilder {
  public static readonly FIXED_INSTRUCTION_TOKENS = 600;

  /**
   * Approximate token count using standard ~4 chars per token heuristic.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Builds formatted phases taxonomy text using a budget-driven degradation ladder:
   * Level 1 (full): Full descriptions
   * Level 2 (short): One-line shortDescription stored per phase
   * Level 3 (compact): Name and ID only
   * Error: If even compact does not fit within budget.
   */
  public static buildTaxonomyText(
    options: BuildTaxonomyPromptOptions
  ): BuildTaxonomyPromptResult {
    const {
      modelContextWindow,
      modelMaxOutput = 4096,
      description,
      previousProfileContext = "",
      catalogPhases,
    } = options;

    if (!catalogPhases || catalogPhases.length === 0) {
      return {
        level: "full",
        phasesTaxonomyText: "",
        estimatedTaxonomyTokens: 0,
        availableBudgetTokens: modelContextWindow,
      };
    }

    // Budget calculation: context window - reserved output - overview - fixed instructions
    const reservedOutput = Math.min(modelMaxOutput, Math.floor(modelContextWindow * 0.4));
    const overviewTokens =
      TaxonomyPromptBuilder.estimateTokens(description) +
      TaxonomyPromptBuilder.estimateTokens(previousProfileContext);
    const availableBudget =
      modelContextWindow -
      reservedOutput -
      TaxonomyPromptBuilder.FIXED_INSTRUCTION_TOKENS -
      overviewTokens;

    // Ladder Level 1: Full descriptions
    const fullText = catalogPhases
      .map((p) => `- ${p.id} (${p.track}): ${p.name} - ${p.description}`)
      .join("\n");
    const fullTokens = TaxonomyPromptBuilder.estimateTokens(fullText);
    if (fullTokens <= availableBudget) {
      return {
        level: "full",
        phasesTaxonomyText: fullText,
        estimatedTaxonomyTokens: fullTokens,
        availableBudgetTokens: availableBudget,
      };
    }

    // Ladder Level 2: Short descriptions (Principle VII)
    const shortText = catalogPhases
      .map((p) => `- ${p.id} (${p.track}): ${p.name} - ${p.shortDescription || p.name}`)
      .join("\n");
    const shortTokens = TaxonomyPromptBuilder.estimateTokens(shortText);
    if (shortTokens <= availableBudget) {
      return {
        level: "short",
        phasesTaxonomyText: shortText,
        estimatedTaxonomyTokens: shortTokens,
        availableBudgetTokens: availableBudget,
      };
    }

    // Ladder Level 3: Names and IDs only
    const compactText = catalogPhases
      .map((p) => `- ${p.id} (${p.track}): ${p.name}`)
      .join("\n");
    const compactTokens = TaxonomyPromptBuilder.estimateTokens(compactText);
    if (compactTokens <= availableBudget) {
      return {
        level: "compact",
        phasesTaxonomyText: compactText,
        estimatedTaxonomyTokens: compactTokens,
        availableBudgetTokens: availableBudget,
      };
    }

    // Even names and IDs do not fit: return a clear error rather than truncating
    throw new Error(
      `Model context window (${modelContextWindow} tokens) is too small for Enhance (available budget: ${availableBudget} tokens, requires at least ${compactTokens} tokens for taxonomy names).`
    );
  }
}
