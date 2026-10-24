# token_optimizer database: schema snapshot (partial)

Source: screenshots of MongoDB Atlas Data Explorer (Cluster0), taken 2026-10-07.
Scope: one or two visible documents per collection. Nested fields are expanded for one `models`, one `optimizer_rules` and one `pricing_history` document. Anything still collapsed in the UI is marked `<collapsed>` (for example `phases` and `providers` have no nested fields to expand, and the remaining documents in each collection are unseen). Nothing in this file has been inferred beyond what the screenshots show.

## Collections

| Collection | Documents | Avg document size | Indexes |
|---|---|---|---|
| models | 40 | 616 B | 1 (default `_id`) |
| optimizer_rules | 3 | 475 B | 1 (default `_id`) |
| phases | 10 | 301 B | 1 (default `_id`) |
| pricing_history | 2 | 578 B | 1 (default `_id`) |
| providers | 11 | 437 B | 1 (default `_id`) |

Naming convention observed: snake_case field names, `created_at` / `updated_at` as ISODate on most documents.

---

## models (40 documents)

Observed document (gpt-4o-mini):

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b38')",
  "provider": "openai",
  "model_id": "gpt-4o-mini",
  "display_name": "GPT-4o Mini (Cost-Efficient)",
  "pricing": {
    "input_per_1m": 0.15,
    "output_per_1m": 0.6,
    "cached_input_per_1m": 0.0375,
    "batch_input_per_1m": 0.075,
    "batch_output_per_1m": 0.3,
    "cache_write_per_1m": null
  },
  "pricing_version": 2,
  "context_window": 128000,
  "capabilities": ["text", "vision", "tool_use"],
  "active": true,
  "complexity_tier": "moderate",
  "reasoning_complexity": "single-step",
  "output_quality": "standard",
  "primary_use": ["classification", "summarization", "instruction-following"],
  "effective_from": "ISODate('2026-09-09T05:39:02.517Z')",
  "created_at": "ISODate('2026-09-08T14:49:52.060Z')",
  "updated_at": "ISODate('2026-09-09T05:39:02.517Z')"
}
```

Notes:
- `provider` is a string that matches `providers.provider_id`.
- Pricing is embedded in the model document and versioned with `pricing_version`. All prices are per 1M tokens (field names end in `_per_1m`). The pricing object already has cached-input, batch input/output and cache-write rates; `cache_write_per_1m` is `null` for this OpenAI model.
- No source URL or verification date is stored with the pricing.

---

## providers (11 documents)

Observed documents:

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b34')",
  "provider_id": "anthropic",
  "display_name": "Anthropic Claude",
  "active": true,
  "implementation_type": "native",
  "native_key": "anthropic",
  "created_at": "ISODate('2026-09-08T14:49:52.060Z')",
  "updated_at": "ISODate('2026-09-08T14:49:52.060Z')"
}
```

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b33')",
  "provider_id": "openai",
  "display_name": "OpenAI",
  "active": true,
  "implementation_type": "native",
  "native_key": "openai",
  "created_at": "ISODate('2026-09-08T14:49:52.060Z')",
  "updated_at": "<not visible in screenshot>"
}
```

Notes: `implementation_type` is "native" for both visible documents. Values used by the other 9 providers are not visible.

---

## optimizer_rules (3 documents)

This is the existing strategy/rule store. Only the first document is visible; the other two are not (one has `_id` ending `...5859b48`).

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b4a')",
  "rule_id": "batch_processing",
  "version": 1,
  "name": "Batch Discount Rule",
  "description": "Triggers 50% discount pricing for large asynchronous runs.",
  "category": "batch_processing",
  "condition": {
    "field": "total_input_tokens",
    "operator": ">=",
    "threshold": 50000
  },
  "token_pool": "both",
  "savings_percentage": {
    "low": 0.5,
    "expected": 0.5,
    "high": 0.5
  },
  "max_reduction": 0.5,
  "affected_phases": ["*"],
  "active": false,
  "created_at": "ISODate('2026-09-08T14:49:52.060Z')",
  "updated_at": "ISODate('2026-09-09T08:39:40.387Z')"
}
```

Notes:
- `condition` is a single `field` / `operator` / `threshold` test against an estimate quantity (here `total_input_tokens`).
- `savings_percentage` holds `low` / `expected` / `high` as fractions (0.5 means 50%), despite the field name.
- `affected_phases: ["*"]` means all phases.
- This rule is `active: false` and was updated about 18 hours after creation.
- It describes a pricing discount (batch, 50%). The `models.pricing` object already has `batch_input_per_1m` and `batch_output_per_1m`, so applying both could double-count the discount.
- There is no field for implementation steps, detection patterns, code examples, or review status.

---

## phases (10 documents)

Three documents are partly or fully visible.

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b40')",
  "phase_id": "architecture",
  "name": "Architecture",
  "sort_order": 3,
  "default_agent_role": "Architecture agent",
  "default_cacheable_fraction": 0.9,
  "ams_classified": false,
  "default_complexity_tier": "complex",
  "default_reasoning_complexity": "multi-step",
  "default_output_quality": "high-fidelity"
}
```

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b47')",
  "phase_id": "ams_run_support",
  "name": "AMS Run Support",
  "sort_order": 10,
  "default_agent_role": "Support agent",
  "default_cacheable_fraction": 0.8,
  "ams_classified": true,
  "default_complexity_tier": "simple",
  "default_reasoning_complexity": "direct",
  "default_output_quality": "standard"
}
```

```json
{
  "_id": "ObjectId('6aa02091985f5fb7c5859b44')",
  "phase_id": "devops",
  "name": "DevOps",
  "sort_order": "7 (partially visible)",
  "...": "remaining fields not visible"
}
```

---

## pricing_history (2 documents)

Observed document (gpt-4o):

```json
{
  "_id": "ObjectId('6aa0f0f927dbb7a65bbbca8e')",
  "model_id": "gpt-4o",
  "provider": "openai",
  "previous_pricing": {
    "input_per_1m": 5,
    "output_per_1m": 15,
    "cached_input_per_1m": 2.5,
    "batch_input_per_1m": 2.5,
    "batch_output_per_1m": 7.5
  },
  "new_pricing": {
    "input_per_1m": 2.5,
    "output_per_1m": 10,
    "cached_input_per_1m": 0.625,
    "batch_input_per_1m": 1.25,
    "batch_output_per_1m": 5,
    "cache_write_per_1m": null
  },
  "pricing_version": 2,
  "changed_by": "bulk_upsert_models.py (Sep 2026 rate card)",
  "changed_at": "ISODate('2026-09-09T05:39:02.517Z')",
  "reason": "Bulk upload from Sep 2026 rate-card spreadsheet / Gemini pricing screenshots"
}
```

Second document (`_id` ending `...bbbca8f`): `model_id` "gpt-4o-mini", `provider` "openai", `previous_pricing` Object (5), `new_pricing` Object (6), `pricing_version` 2. Remaining fields are not visible.

---

## Not captured yet (needed before writing migrations)

1. (Done in this version) Nested fields of one `models`, one `optimizer_rules` and one `pricing_history` document are now expanded. Still unseen: how other providers' models fill `pricing.cache_write_per_1m`, and whether `previous_pricing` always omits `cache_write_per_1m`.
2. The other two `optimizer_rules` documents (to see whether `condition` and `affected_phases` take other shapes, such as other operators, fields or specific phase ids).
3. The remaining `phases` documents (7 of 10 not visible) and the full `devops` document.
4. The remaining `providers` (9 of 11) and `models` (39 of 40), at least the distinct values of `provider`, `implementation_type`, `complexity_tier`, `reasoning_complexity`, `output_quality`.
5. Validation rules (the Validation tab) and the Schema tab output for each collection.

How to capture 1 to 5: in Data Explorer, click the `{}` (JSON) view, expand the nested fields, and copy a full document. Set the page size to 100 for the small collections.
