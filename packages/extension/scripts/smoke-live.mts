/**
 * `pnpm smoke:live`: the ONLY sanctioned live-LLM check. For each of GROQ_API_KEY,
 * OPENAI_API_KEY, ANTHROPIC_API_KEY that is set (env or repo .env), builds the provider's adapter
 * exactly as the extension does (catalog snapshot -> AdapterRegistry) and runs validateKey + one
 * tiny completion: at most 2 HTTP requests per provider, enforced by a counting fetch. The
 * catalog's model ids are re-checked against the /models list returned by validateKey (no extra
 * request). Providers without a key print "skipped: no key". Keys are never printed or logged.
 *
 * Exports: none (CLI script)
 * Feature: providers (live verification gate)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CatalogSnapshotSchema } from "@token-optimizer/core";
import { createAdapterForProvider } from "../src/providers/AdapterRegistry.js";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.resolve(EXT, "../../.env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const MAX_REQUESTS_PER_PROVIDER = 2;
const PROVIDERS: Array<{ id: string; env: string }> = [
  { id: "groq", env: "GROQ_API_KEY" },
  { id: "openai", env: "OPENAI_API_KEY" },
  { id: "anthropic", env: "ANTHROPIC_API_KEY" },
];

const redact = (text: string): string =>
  text
    .replace(/(sk-|gsk_|xai-|AIza)[A-Za-z0-9_-]+/g, "$1***")
    .replace(/(authorization|x-api-key)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "$1: ***");

const snapshot = CatalogSnapshotSchema.parse(
  JSON.parse(fs.readFileSync(path.join(EXT, "resources/catalog-snapshot.json"), "utf-8"))
);

let totalRequests = 0;
let failed = false;

for (const { id, env } of PROVIDERS) {
  const key = process.env[env]?.trim();
  if (!key) {
    console.log(`${id}: skipped: no key (${env} not set)`);
    continue;
  }
  const provider = snapshot.providers.find((p) => p.id === id);
  if (!provider) {
    console.log(`${id}: FAIL - provider missing from catalog snapshot`);
    failed = true;
    continue;
  }

  let requests = 0;
  let modelsBody: unknown = null;
  let lastStatus = 0;
  const countingFetch: typeof fetch = async (input, init) => {
    if (requests >= MAX_REQUESTS_PER_PROVIDER) {
      throw new Error(`smoke:live request budget (${MAX_REQUESTS_PER_PROVIDER}) exhausted`);
    }
    requests++;
    totalRequests++;
    const res = await fetch(input, init);
    lastStatus = res.status;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/\/models(\?|$)/.test(url) && res.ok) {
      modelsBody = await res.clone().json().catch(() => null);
    }
    return res;
  };

  const adapter = createAdapterForProvider(provider, countingFetch);
  if (!adapter) {
    console.log(`${id}: FAIL - no adapter for adapterType '${provider.adapterType}'`);
    failed = true;
    continue;
  }
  const getKey = async () => key;
  const catalogModels = snapshot.models.filter((m) => m.providerId === id && m.status === "active");
  const model =
    catalogModels.find((m) => m.tier === "economy") ?? catalogModels[0] ?? undefined;

  try {
    const v = await adapter.validateKey(getKey);
    if (!v.valid) {
      console.log(
        `${id}: FAIL - validateKey ${v.reason ?? "invalid"} (HTTP ${lastStatus}; ${requests} request(s))`
      );
      failed = true;
      continue;
    }
    const liveIds = new Set(
      ((modelsBody as { data?: Array<{ id?: string }> } | null)?.data ?? [])
        .map((m) => m.id)
        .filter(Boolean) as string[]
    );
    const missing = catalogModels.filter((m) => liveIds.size > 0 && !liveIds.has(m.id));
    const idCheck =
      liveIds.size === 0
        ? "model list not parsed"
        : `${catalogModels.length - missing.length}/${catalogModels.length} catalog model ids live` +
          (missing.length ? ` (missing: ${missing.map((m) => m.id).join(", ")})` : "");
    console.log(`${id}: validateKey PASS; ${idCheck}`);
    if (missing.length) failed = true;

    if (!model) throw new Error("no active catalog model for completion");
    const c = await adapter.complete(
      [{ role: "user", content: "Reply with the single word: pong" }],
      getKey,
      { model: model.id, maxTokens: 256, temperature: 0 }
    );
    const ok = c.content.trim().length > 0 || (c.outputTokens ?? 0) > 0;
    console.log(
      `${id}: completion ${ok ? "PASS" : "FAIL"} via ${model.id} ` +
        `(in=${c.inputTokens ?? "?"} out=${c.outputTokens ?? "?"} tokens, ` +
        `reply="${redact(c.content.trim()).slice(0, 40)}"); requests used: ${requests}`
    );
    if (!ok) failed = true;
  } catch (err) {
    console.log(`${id}: FAIL - ${redact(err instanceof Error ? err.message : String(err))} (${requests} request(s))`);
    failed = true;
  }
}

console.log(`smoke:live total live HTTP requests: ${totalRequests}`);
process.exit(failed ? 1 : 0);
