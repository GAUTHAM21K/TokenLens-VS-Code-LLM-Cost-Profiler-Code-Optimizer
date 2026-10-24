/**
 * Golden-fixture file formats shared by the TS (Vitest) and Python (pytest) test suites, so the
 * TS techniques/RouterRules and the Python `ai_optimizer` package stay byte-identical.
 * One case per JSON file under packages/fixtures/optimizer/ and packages/fixtures/router/.
 * FROZEN CONTRACT: Phase 1 tracks add cases but do not change these formats.
 *
 * Exports: OptimizerFixtureCaseSchema, RouterFixtureCaseSchema, OptimizerFixtureCase,
 *   RouterFixtureCase.
 * Feature: prompt optimizer + model router (parity tests)
 */
import { z } from "zod";
import {
  PromptMessageSchema,
  PromptParamsSchema,
  RouterConfigSchema,
  RouterTierSchema,
  ModelIdSchema,
  ProviderIdSchema,
  StrategyIdSchema,
} from "./schemas.js";

const TextIoSchema = z.object({ kind: z.literal("text"), text: z.string() }).strict();

const MessagesIoSchema = z
  .object({
    kind: z.literal("messages"),
    messages: z.array(PromptMessageSchema),
    params: PromptParamsSchema.optional(),
  })
  .strict();

/**
 * Optimizer case: run `techniques` (catalog order is NOT applied; the list order is the run order)
 * over `input` -> must equal `expected` exactly. Text input maps to Python `optimize_text`,
 * messages input to `optimize_messages`. `config` overrides technique params by technique id.
 */
export const OptimizerFixtureCaseSchema = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    techniques: z.array(StrategyIdSchema).min(1),
    config: z.record(z.record(z.unknown())).optional(),
    input: z.discriminatedUnion("kind", [TextIoSchema, MessagesIoSchema]),
    expected: z.discriminatedUnion("kind", [
      TextIoSchema,
      MessagesIoSchema.extend({ params: PromptParamsSchema }),
    ]),
  })
  .strict()
  .refine((c) => c.input.kind === c.expected.kind, {
    message: "input.kind and expected.kind must match",
  });

/**
 * Router case: route `input` under `config` -> expected tier/model/provider. `reason` is free text
 * and is not compared. Messages are measured as their contents joined with "\n"; lengths are in
 * Unicode code points; keyword matching is case-insensitive on ASCII word boundaries.
 */
export const RouterFixtureCaseSchema = z
  .object({
    id: z.string().min(1),
    description: z.string(),
    config: RouterConfigSchema,
    input: z.discriminatedUnion("kind", [
      TextIoSchema,
      z.object({ kind: z.literal("messages"), messages: z.array(PromptMessageSchema) }).strict(),
    ]),
    needsTools: z.boolean(),
    expected: z
      .object({
        tier: RouterTierSchema,
        model: ModelIdSchema,
        provider: ProviderIdSchema,
      })
      .strict(),
  })
  .strict();

export type OptimizerFixtureCase = z.infer<typeof OptimizerFixtureCaseSchema>;
export type RouterFixtureCase = z.infer<typeof RouterFixtureCaseSchema>;
