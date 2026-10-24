# Router golden fixtures (TS `RouterRules` ↔ Python `ai_optimizer.router.route`)

Format: one case per `*.json`, validated by `RouterFixtureCaseSchema`
(`packages/core/src/protocol/fixtures.ts`). Each case carries its full `RouterConfig`
(a copy of the catalog default preset), so neither runtime needs the catalog.

Compared: `tier`, `model`, `provider`. Not compared: `reason`.
Rule order (see `RouterRulesSchema` doc comment): advanced keyword → economy by length →
`defaultTier`; then `needsTools` raises to at least `needsToolsMinTier`. Messages are measured
as contents joined with `"\n"`, in Unicode code points; keywords match case-insensitively on
ASCII word boundaries. Add cases freely; never change the format (frozen contract).
