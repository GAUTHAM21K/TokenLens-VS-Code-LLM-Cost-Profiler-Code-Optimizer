/**
 * Runs Enhance: description -> LLM (JSON mode where supported) -> host-completed, validated
 * ProjectProfile (one repair attempt listing the exact Zod issues), streamed to the webview.
 * The call cost uses the effective-date pricing lookup shared with the estimation engine.
 *
 * Exports: EnhanceRequest, EnhanceServiceOptions, EnhanceService
 * Feature: token cost estimator
 */
import {
  ProjectProfileSchema,
  suggestPhases,
  CostCalculator,
  findActivePricing,
  pricingReferenceTime,
  type ProjectProfile,
  type ProviderAdapter,
  type CatalogSnapshot,
  type ChatMessage,
  type HostToWebviewMsg,
  type Phase,
} from "@token-optimizer/core";
import type { ZodIssue } from "zod";
import { KeyService } from "../secrets/KeyService.js";
import { ProfileHistoryStore } from "./ProfileHistoryStore.js";
import { TaxonomyPromptBuilder } from "./TaxonomyPromptBuilder.js";
import {
  LlmProfileSchema,
  PROFILE_SHAPE_PROMPT,
  buildRepairPrompt,
  completeProfile,
  unwrapProfilePayload,
} from "./profileCompletion.js";

/** Provider adapter types that accept response_format json_object. */
const JSON_MODE_ADAPTERS = new Set(["openai", "openai-compatible", "mistral"]);

export interface EnhanceRequest {
  description: string;
  providerId: string;
  modelId: string;
  keySlot?: number;
  previousProfileVersion?: number;
}

export interface EnhanceServiceOptions {
  keyService: KeyService;
  adapters: Map<string, ProviderAdapter>;
  getCatalogSnapshot: () => CatalogSnapshot | null;
  postMessage: (msg: HostToWebviewMsg) => Promise<void>;
  historyStore: ProfileHistoryStore;
}

type ValidationOutcome =
  | { ok: true; narrative: string; profile: ProjectProfile }
  | { ok: false; issues: ZodIssue[] | null };

export class EnhanceService {
  private keyService: KeyService;
  private adapters: Map<string, ProviderAdapter>;
  private getCatalogSnapshot: () => CatalogSnapshot | null;
  private postMessage: (msg: HostToWebviewMsg) => Promise<void>;
  private historyStore: ProfileHistoryStore;

  constructor(options: EnhanceServiceOptions) {
    this.keyService = options.keyService;
    this.adapters = options.adapters;
    this.getCatalogSnapshot = options.getCatalogSnapshot;
    this.postMessage = options.postMessage;
    this.historyStore = options.historyStore;
  }

  public async run(request: EnhanceRequest): Promise<ProjectProfile | null> {
    const { description, providerId, modelId, keySlot, previousProfileVersion } = request;

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      await this.postMessage({
        version: 1,
        type: "enhance/error",
        payload: {
          error: "llm-failed",
          message: `No provider adapter found for ${providerId}`,
        },
      });
      return null;
    }

    const snapshot = this.getCatalogSnapshot();
    const catalogPhases = snapshot?.phases ?? [];

    // Prompt Template selection by purpose="enhance" (T059)
    const promptTemplate = snapshot?.promptTemplates.find(
      (t) => t.purpose === "enhance" && t.active
    ) || snapshot?.promptTemplates.find((t) => t.purpose === "enhance");

    // If refining a previous profile version, include previous context to avoid duplicating sections
    let previousProfileContext = "";
    if (previousProfileVersion) {
      const prevEntry = this.historyStore.getVersion(previousProfileVersion);
      if (prevEntry) {
        previousProfileContext = `\n\nPrevious Profile Version ${previousProfileVersion} to refine:\n${JSON.stringify(
          prevEntry.profile
        )}`;
      }
    }

    const model = snapshot?.models.find((m) => m.id === modelId);
    let taxonomyResult: {
      level: "full" | "short" | "compact";
      phasesTaxonomyText: string;
      estimatedTaxonomyTokens: number;
      availableBudgetTokens: number;
    };
    try {
      taxonomyResult = TaxonomyPromptBuilder.buildTaxonomyText({
        modelContextWindow: model?.contextWindow ?? 128000,
        modelMaxOutput: model?.maxOutput ?? 4096,
        description,
        previousProfileContext,
        catalogPhases,
      });
    } catch (err) {
      await this.postMessage({
        version: 1,
        type: "enhance/error",
        payload: {
          error: "llm-failed",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }

    let promptText: string;
    if (promptTemplate) {
      // S3-4: Safe function replacer to prevent interpreting $& or $1 in arbitrary user text
      promptText = promptTemplate.template
        .replace(/\{\{description\}\}/g, () => description)
        .replace(/\{\{phasesTaxonomy\}\}/g, () => taxonomyResult.phasesTaxonomyText);
    } else {
      promptText = `Analyze project architecture and generate token optimization profile.\n\nProject:\n${description}\n\nPhases:\n${taxonomyResult.phasesTaxonomyText}`;
    }
    // Field list + example JSON: at {{profileShape}} when the template has it, else appended.
    promptText = promptText.includes("{{profileShape}}")
      ? promptText.replace(/\{\{profileShape\}\}/g, () => PROFILE_SHAPE_PROMPT)
      : `${promptText}\n\n${PROFILE_SHAPE_PROMPT}`;

    if (previousProfileContext) {
      promptText += previousProfileContext;
    }

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          "You are an expert AI architect. You analyze software descriptions and produce a JSON object with keys 'narrative' (string describing the architecture) and 'profile' (the project profile described in the request). Return ONLY valid JSON.",
      },
      {
        role: "user",
        content: promptText,
      },
    ];

    const getKey = this.keyService.getKeyGetter(providerId, keySlot ?? 0);
    const adapterType = snapshot?.providers.find((p) => p.id === providerId)?.adapterType;
    const jsonMode = adapterType && JSON_MODE_ADAPTERS.has(adapterType)
      ? { responseFormat: "json_object" as const }
      : {};
    const validate = (text: string) =>
      this.validateResponse(text, {
        profileVersion: this.historyStore.getNextVersion(),
        catalogPhases,
      });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    let content: string;
    try {
      const result = await adapter.complete(messages, getKey, {
        model: modelId,
        temperature: 0.2,
        ...jsonMode,
      });
      content = result.content;
      totalInputTokens += result.inputTokens ?? 0;
      totalOutputTokens += result.outputTokens ?? 0;
    } catch (err) {
      await this.postMessage({
        version: 1,
        type: "enhance/error",
        payload: {
          error: "llm-failed",
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return null;
    }

    // Try parsing initial response
    let outcome = validate(content);

    // Single repair attempt if parse or schema validation failed (T059, FR-010, FR-013)
    if (!outcome.ok) {
      const repairMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content },
        { role: "user", content: buildRepairPrompt(outcome.issues) },
      ];

      try {
        const repairResult = await adapter.complete(repairMessages, getKey, {
          model: modelId,
          temperature: 0.1,
          ...jsonMode,
        });
        totalInputTokens += repairResult.inputTokens ?? 0;
        totalOutputTokens += repairResult.outputTokens ?? 0;

        outcome = validate(repairResult.content);
      } catch (err) {
        await this.postMessage({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "repair-failed",
            message: `Repair call failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
        return null;
      }

      // If still invalid after the single repair attempt, abort without altering previous version
      if (!outcome.ok) {
        await this.postMessage({
          version: 1,
          type: "enhance/error",
          payload: {
            error: "repair-failed",
            message: "Failed to produce schema-valid Project Profile after repair attempt.",
          },
        });
        return null;
      }
    }

    const narrative = outcome.narrative || "Architecture synthesis completed.";
    const profile = outcome.profile;

    // Fall back to deterministic PhaseSuggester if no usable phases returned (T133, T147)
    if (profile.phases.length === 0) {
      profile.phases = suggestPhases(profile, catalogPhases);
    }

    // S3-5: All phases from LLM generation start unconfirmed, requiring explicit user review
    for (const phase of profile.phases) {
      phase.confirmed = false;
    }

    // Stream narrative preview deltas
    // S3-2: If taxonomy budget degradation occurred, include note in both stream and saved narrative
    let finalNarrative = narrative;
    if (taxonomyResult.level !== "full") {
      const budgetNote = `[Taxonomy budget level: ${taxonomyResult.level} - prompt compacted to fit context budget]\n\n`;
      finalNarrative = budgetNote + narrative;
    }

    const chunkSize = 40;
    for (let i = 0; i < finalNarrative.length; i += chunkSize) {
      const delta = finalNarrative.slice(i, i + chunkSize);
      await this.postMessage({
        version: 1,
        type: "enhance/stream",
        payload: { delta },
      });
    }

    // Calculate prompt execution cost (effective-date pricing, same lookup as EstimationEngine)
    let costUsd = 0;
    const pricing = findActivePricing(modelId, snapshot?.pricing ?? [], pricingReferenceTime(snapshot));
    if (pricing) {
      costUsd = CostCalculator.computeCostUsd(totalInputTokens, totalOutputTokens, pricing);
    }

    // S3-1: Always allocate the next sequential version rather than overwriting intermediate versions
    const nextVersion = this.historyStore.getNextVersion();

    profile.profileVersion = nextVersion;
    profile.createdAt = new Date().toISOString();

    const entry = await this.historyStore.add({
      version: nextVersion,
      narrative: finalNarrative,
      profile,
      createdAt: profile.createdAt,
      costUsd,
      tokens: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    });

    await this.postMessage({
      version: 1,
      type: "enhance/result",
      payload: {
        narrative: finalNarrative,
        profile: entry.profile,
        profileVersion: entry.version,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
        taxonomyBudgetLevel: taxonomyResult.level,
      },
    });

    // Hydrate webview history summaries
    await this.postMessage({
      version: 1,
      type: "enhance/historyLoaded",
      payload: {
        summaries: this.historyStore.getSummaries(),
      },
    });

    return entry.profile;
  }

  /**
   * Parses the LLM text, checks the profile against the LLM-facing schema (issues feed the repair
   * prompt), lets the host complete profileVersion/createdAt/schemaVersion and phase defaults, and
   * validates the result with ProjectProfileSchema. Phases with unknown phase types are dropped as
   * a set (the caller then falls back to PhaseSuggester).
   */
  private validateResponse(
    content: string,
    opts: { profileVersion: number; catalogPhases: Phase[] }
  ): ValidationOutcome {
    const parsed = this.extractJson(content);
    if (!parsed) return { ok: false, issues: null };
    const { narrative, profile: raw } = unwrapProfilePayload(parsed);

    const llm = LlmProfileSchema.safeParse(raw);
    if (!llm.success) return { ok: false, issues: llm.error.issues };

    const completed = completeProfile(llm.data, {
      profileVersion: opts.profileVersion,
      createdAt: new Date().toISOString(),
      catalogPhases: opts.catalogPhases,
    }) as { phases: Array<{ phaseTypeId: string }> };
    const known = new Set(opts.catalogPhases.map((p) => p.id));
    if (completed.phases.some((p) => !known.has(p.phaseTypeId))) {
      completed.phases = [];
    }

    const final = ProjectProfileSchema.safeParse(completed);
    return final.success
      ? { ok: true, narrative, profile: final.data }
      : { ok: false, issues: final.error.issues };
  }

  private extractJson(content: string): unknown {
    if (!content || typeof content !== "string") {
      return null;
    }

    // 1. Direct JSON parse
    try {
      const parsed = JSON.parse(content.trim());
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Continue to next extraction strategy
    }

    // 2. Fenced code block ```json ... ```
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1].trim());
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      } catch {
        // Continue
      }
    }

    // 3. Balanced braces heuristic
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        const snippet = content.slice(firstBrace, lastBrace + 1);
        const parsed = JSON.parse(snippet);
        if (parsed && typeof parsed === "object") {
          return parsed;
        }
      } catch {
        // Fall through
      }
    }

    return null;
  }
}
