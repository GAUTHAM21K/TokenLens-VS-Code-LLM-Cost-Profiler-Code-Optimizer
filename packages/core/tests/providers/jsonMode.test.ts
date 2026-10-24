/**
 * Tests: `responseFormat: "json_object"` completion option (OpenAI, OpenAI-compatible/Groq,
 * Mistral) sends response_format json_object, and is omitted by default.
 *
 * Exports: none (test suite)
 * Feature: providers (used by Enhance JSON mode)
 */
import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleAdapter } from "../../src/providers/OpenAICompatibleAdapter.js";
import { MistralAdapter } from "../../src/providers/MistralAdapter.js";
import type { ProviderAdapter } from "../../src/providers/ProviderAdapter.js";

function mockFetch() {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 }
    )
  );
}

async function sentBody(adapter: ProviderAdapter, fetchFn: ReturnType<typeof vi.fn>, json: boolean) {
  await adapter.complete([{ role: "user", content: "hi" }], async () => "k", {
    model: "m",
    ...(json ? { responseFormat: "json_object" as const } : {}),
  });
  return JSON.parse(fetchFn.mock.calls[0][1].body as string);
}

describe("responseFormat json_object", () => {
  it("OpenAI-compatible adapter sends response_format only when asked", async () => {
    const f1 = mockFetch();
    const on = new OpenAICompatibleAdapter({ providerId: "groq", baseUrl: "https://x.test/v1", fetchFn: f1 as unknown as typeof fetch });
    expect((await sentBody(on, f1, true)).response_format).toEqual({ type: "json_object" });
    const f2 = mockFetch();
    const off = new OpenAICompatibleAdapter({ providerId: "groq", baseUrl: "https://x.test/v1", fetchFn: f2 as unknown as typeof fetch });
    expect((await sentBody(off, f2, false)).response_format).toBeUndefined();
  });

  it("Mistral adapter sends response_format json_object", async () => {
    const f = mockFetch();
    const a = new MistralAdapter({ fetchFn: f as unknown as typeof fetch });
    expect((await sentBody(a, f, true)).response_format).toEqual({ type: "json_object" });
  });
});
