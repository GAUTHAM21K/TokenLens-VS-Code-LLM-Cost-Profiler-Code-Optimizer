/**
 * Tests: Catalog API Health Check (T005, FR-043, Finding 20).
 *
 * Exports: none (test suite)
 * Feature: catalog
 */
import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("Catalog API Health Check (T005, FR-043, Finding 20)", () => {
  it("serves GET /v1/health with 200 OK via server.inject", async () => {
    const server = buildServer();
    const response = await server.inject({
      method: "GET",
      url: "/v1/health",
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("ok");
  });

  it("serves GET /v1/health with 200 OK over real live HTTP socket", async () => {
    const server = buildServer();
    const address = await server.listen({ port: 0, host: "127.0.0.1" });

    try {
      const res = await fetch(`${address}/v1/health`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toMatchObject({ status: "ok" });
    } finally {
      await server.close();
    }
  });
});
