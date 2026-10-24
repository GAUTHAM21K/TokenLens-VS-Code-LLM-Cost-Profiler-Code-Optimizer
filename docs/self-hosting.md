# Self-Hosting the Token Optimizer Catalog API

The Token Optimizer Catalog API is a lightweight, read-only Fastify service that serves models, providers, pricing, phases, strategies, platforms, and prompt templates to Token Optimizer clients.

---

## 1. Production Architecture: Ingress Rate Limiting

Per the API contract ([`catalog-api.yaml`](../specs/001-token-optimizer/contracts/catalog-api.yaml)), production rate limiting is enforced at the **ingress / API gateway layer** (e.g., Cloudflare, AWS CloudFront / WAF, NGINX, or Envoy).

The Node.js server process serves public read-only JSON responses with aggressive caching headers (`Cache-Control: public, max-age=3600`) and standard ETag conditional requests (`304 Not Modified`).

---

## 2. In-Process Rate Limiting for Self-Hosters (Opt-In)

If you are self-hosting without a dedicated reverse-proxy or API gateway, the Catalog API provides opt-in, in-process rate limiting via `@fastify/rate-limit`.

`@fastify/rate-limit` is **not a required dependency** and is disabled by default.

### How to Enable

1. Install `@fastify/rate-limit` in `@token-optimizer/catalog-api`:
   ```bash
   pnpm --filter @token-optimizer/catalog-api add @fastify/rate-limit
   ```

2. Configure environment variables:
   ```bash
   # Enable the in-process rate limiter
   RATE_LIMIT_ENABLED=true

   # Max requests allowed within the time window (default: 100)
   RATE_LIMIT_MAX=100

   # Time window (default: 1 minute)
   RATE_LIMIT_TIME_WINDOW="1 minute"
   ```

3. Start the server:
   ```bash
   pnpm --filter @token-optimizer/catalog-api start
   ```

When enabled, requests exceeding `RATE_LIMIT_MAX` within the configured time window will receive HTTP `429 Too Many Requests`.

---

## 3. Database Credentials & Principle III

In compliance with **Principle III (Zero Credentials)**:
- Never commit database connection strings or credentials to source control or container images.
- Provide the MongoDB connection URI at runtime via the `MONGODB_URI` environment variable.
