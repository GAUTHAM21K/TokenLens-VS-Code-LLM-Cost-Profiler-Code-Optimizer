/**
 * ETag and Cache-Control helpers for the read-only Catalog API.
 *
 * Exports: generateETag, matchesETag, CACHE_CONTROL_HEADER
 * Feature: catalog
 */
import { createHash } from "node:crypto";

/**
 * Computes an ETag for catalog payloads based on version and publication timestamp.
 * Wraps with quotes according to HTTP specification.
 */
export function generateETag(version: number | string, publishedAt: string): string {
  const hash = createHash("sha256").update(`${version}:${publishedAt}`).digest("hex");
  return `"${hash}"`;
}

/**
 * Checks if the request's If-None-Match header matches the current resource ETag.
 * Handles weak ETags (W/) and wildcard (*).
 */
export function matchesETag(
  ifNoneMatchHeader: string | undefined,
  currentETag: string
): boolean {
  if (!ifNoneMatchHeader) return false;
  const cleanCurrent = currentETag.replace(/^W\//, "").trim();
  const tags = ifNoneMatchHeader
    .split(",")
    .map((tag) => tag.replace(/^W\//, "").trim());

  return tags.includes(cleanCurrent) || tags.includes("*");
}

export const CACHE_CONTROL_HEADER = "public, max-age=3600";
