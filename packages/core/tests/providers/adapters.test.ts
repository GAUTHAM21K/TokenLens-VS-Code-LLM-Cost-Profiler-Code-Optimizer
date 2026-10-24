/**
 * Tests: Provider Adapters Unit Tests (T043-T048, FR-003, FR-023, Principle X).
 *
 * Exports: none (test suite)
 * Feature: providers
 */
import { describe, it, expect, vi } from "vitest";
import {
  AnthropicAdapter,
  OpenAIAdapter,
  GoogleAdapter,
  MistralAdapter,
  OpenAICompatibleAdapter,
} from "../../src/index.js";

describe("Provider Adapters Unit Tests (T043-T048, FR-003, FR-023, Principle X)", () => {
  describe("AnthropicAdapter (T044)", () => {
    it("validates key successfully on 200 OK", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "claude-3-5-sonnet" }] }),
      });

      const adapter = new AnthropicAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "sk-ant-valid");

      expect(res.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.anthropic.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-api-key": "sk-ant-valid",
            "anthropic-version": "2023-06-01",
          }),
        })
      );
    });

    it("returns valid=false with reason='invalid' on 401", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const adapter = new AnthropicAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "sk-ant-invalid");

      expect(res.valid).toBe(false);
      expect(res.reason).toBe("invalid");
    });

    it("retries on 429 and returns rate-limited when exhausted", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
      });

      const adapter = new AnthropicAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "sk-ant-limited");

      expect(res.valid).toBe(false);
      expect(res.reason).toBe("rate-limited");
      // Initial attempt + 2 retries = 3 calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("lists models from /v1/models", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "claude-3-5-sonnet" }, { id: "claude-3-5-haiku" }],
        }),
      });

      const adapter = new AnthropicAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const models = await adapter.listModels(async () => "sk-ant-key");

      expect(models).toEqual(["claude-3-5-sonnet", "claude-3-5-haiku"]);
    });

    it("returns approximate token count with margin", async () => {
      const adapter = new AnthropicAdapter();
      const count = await adapter.countTokens("Hello world, how are you today?");
      expect(count.label).toBe("approximate");
      expect(count.margin).toBe("+-15%");
      expect(count.count).toBeGreaterThan(0);
    });
  });

  describe("OpenAIAdapter (T045)", () => {
    it("validates key with Bearer token header on 200 OK", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "gpt-4o" }] }),
      });

      const adapter = new OpenAIAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "sk-proj-valid");

      expect(res.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer sk-proj-valid",
          }),
        })
      );
    });

    it("handles 401 as invalid key", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const adapter = new OpenAIAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "sk-proj-bad");

      expect(res.valid).toBe(false);
      expect(res.reason).toBe("invalid");
    });
  });

  describe("GoogleAdapter (T046)", () => {
    it("validates key via query parameter on 200 OK", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ models: [{ name: "models/gemini-1.5-pro" }] }),
      });

      const adapter = new GoogleAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "AIzaSyD-valid");

      expect(res.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyD-valid",
        expect.anything()
      );
    });

    it("strips models/ prefix when listing models", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: "models/gemini-1.5-pro" },
            { name: "models/gemini-1.5-flash" },
          ],
        }),
      });

      const adapter = new GoogleAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const models = await adapter.listModels(async () => "AIzaSyD-valid");

      expect(models).toEqual(["gemini-1.5-pro", "gemini-1.5-flash"]);
    });
  });

  describe("MistralAdapter (T047)", () => {
    it("validates key and labels countTokens approximate with +-15% margin", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "mistral-large" }] }),
      });

      const adapter = new MistralAdapter({ fetchFn: mockFetch as unknown as typeof fetch });
      const res = await adapter.validateKey(async () => "mistral-key");
      expect(res.valid).toBe(true);

      const count = await adapter.countTokens("some sample prompt content");
      expect(count.label).toBe("approximate");
      expect(count.margin).toBe("+-15%");
    });
  });

  describe("OpenAICompatibleAdapter (T048)", () => {
    it("uses injected baseUrl at construction", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "custom-model" }] }),
      });

      const customUrl = "https://custom-llm.enterprise.internal/v1";
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: customUrl,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(adapter.getBaseUrl()).toBe(customUrl);

      const res = await adapter.validateKey(async () => "any-token");
      expect(res.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://custom-llm.enterprise.internal/v1/models",
        expect.anything()
      );
    });
  });
});
