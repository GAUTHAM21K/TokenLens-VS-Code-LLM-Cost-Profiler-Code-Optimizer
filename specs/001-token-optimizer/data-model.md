# Data Model: Token Optimizer

**Phase**: 1 | **Date**: 2026-10-07 | **Plan**: [plan.md](plan.md)

---

## Core Domain Entities

### 1. ProjectProfile

The structured output of the Enhance step. Stored in `workspaceState` (version history).
The "final" version drives estimation and strategy selection.

```typescript
ProjectProfile {
  schemaVersion: string           // e.g. "1.0"
  projectType: string             // e.g. "rag-chatbot", "coding-agent", "summariser"
  overview: string
  techStack: TechStackEntry[]     // {language, framework?, version?}
  llm: {
    providers: string[]           // provider ids referenced
    usesRag: boolean
    usesAgents: boolean
    agentCount?: number
    avgPrefixTokens?: number      // for cache-prefix strategies
    avgPromptTokens: number
    avgOutputTokens: number
    avgConversationTurns?: number
  }
  components: ComponentEntry[]    // {name, description, llmRole?}
  dataFlow: string                // prose description
  scale: {
    requestsPerDay: number        // RUNTIME baseline
    peakMultiplier: number
    usersPerDay?: number
    sessionsPerUserPerDay?: number
    monthlyDays?: number
  }
  buildAssumptions: {
    teamSize: number
    sprintWeeks: number
    iterationsPerFeature: number
  }
  phases: ConfirmedPhase[]        // FR-052: proposed by Enhance, verified/edited by the user; drive estimation and pre-selection
  constraints: string[]
  profileVersion: number          // monotonically incrementing on each Enhance run
  createdAt: ISO8601
  finalizedAt?: ISO8601
}
```

ConfirmedPhase {
  id: string                      // unique within the profile, e.g. "build-1"
  phaseTypeId: string             // MUST exist in the catalog Phase taxonomy (2d)
  track: "build" | "runtime"      // MUST equal the catalog phase type's track
  name: string                    // user-editable label
  source: "llm" | "user" | "taxonomy-suggestion"
  confirmed: boolean              // taxonomy suggestions start false; finalisation requires all true
}

**Finalisation guard**: a version can be finalised only if it has at least one phase, every
`phaseTypeId` exists in the catalog, and every phase is confirmed. Editing phases creates a new
draft version without an LLM call.

**Validation**: Zod schema in `packages/core/src/profile/schema.ts`.
**Storage**: `context.workspaceState.update("tokenOptimizer.profileHistory", ProfileHistoryEntry[])`.
**State transitions**: `draft` → `final` (one-way per version; new Enhance run creates v+1 in draft).

---

### 2. Catalog (read from Catalog API; cached locally)

#### 2a. Provider

```typescript
Provider {
  id: string                      // e.g. "anthropic"
  label: string                   // e.g. "Anthropic Claude"
  adapterType: "anthropic" | "openai" | "google" | "mistral" | "openai-compatible" | "host-lm"
  baseUrl: string                 // API base URL ("" for host-lm)
  hostLm?: { vendor: string, family?: string }   // adapterType "host-lm" only: selector for the host language-model API
  listModelsEndpoint?: string     // optional: relative path to list models
  keyFormatHint: string           // e.g. "sk-ant-..." shown during key entry
  enabled: boolean
}
```

DB collection: `providers` (migrated from existing schema; see research.md Decision 4).

#### 2b. Model

```typescript
Model {
  id: string                      // e.g. "gpt-4o-mini"
  providerId: string
  label: string
  contextWindow: number           // tokens
  maxOutput: number               // tokens
  tier: "economy" | "standard" | "advanced" | "frontier"
  supportsCaching: boolean
  supportsBatch: boolean
  supportsStructuredOutput: boolean
  tokenizer: {
    kind: "tiktoken" | "anthropic-endpoint" | "google-endpoint" | "char-approx"
    name?: string                 // e.g. "o200k_base"
  }
  status: "active" | "deprecated"
  addedAt: ISO8601
}
```

#### 2c. Pricing

Separate collection; active price = latest `effectiveFrom <= now`.

```typescript
Pricing {
  modelId: string
  currency: "USD"
  inputPerMTok: number
  outputPerMTok: number
  cachedInputPerMTok?: number
  cacheWriteMultiplier?: number    // multiplier on inputPerMTok for cache writes
  batchDiscount?: number           // fraction, e.g. 0.5 = 50% off
  effectiveFrom: ISO8601
  sourceUrl: string
  verifiedAt: ISO8601
}
```

#### 2d. Phase (catalog-defined taxonomy)

```typescript
Phase {
  id: string                       // e.g. "architecture", "embedding-ingestion"
  name: string
  track: "build" | "runtime"
  sortOrder: number
  description: string              // one or two sentences shown in the Estimate view (FR-018)
  archetypes: string[]             // project types this phase applies to
  defaultParams: {
    callsLow: number
    callsExpected: number
    callsHigh: number
    tokensPerCallLow: number
    tokensPerCallExpected: number
    tokensPerCallHigh: number
    retriesLow: number
    retriesExpected: number
    retriesHigh: number
    volumeMultiplierLow: number    // for RUNTIME: requests-per-day scaling factor
    volumeMultiplierExpected: number
    volumeMultiplierHigh: number
  }
  paramHints: Record<string, string>  // human-readable hint per param key
  cacheablePrefix?: number            // fraction of input that can be prefix-cached
  agentRole?: string
}
```

#### 2e. Strategy

```typescript
Strategy {
  id: string
  name: string
  group: "prompt-efficiency" | "caching" | "model-strategy" | "build-practices" | "batching" | "output-control"
  targets: ("build" | "runtime")[]
  summary: string
  applicability: ApplicabilityPredicate   // see contracts/webview-messages.ts
  reasonTemplate: string
  preconditions: Precondition[]
  savings: {
    min: number
    max: number
    unit: "percent"
    appliesTo: "input" | "output" | "total"
    basis: string
    sourceUrl?: string
  }
  conflicts: string[]              // strategy ids
  requires: string[]               // strategy ids
  preview: { kind: "tokenizer" | "llm-transform", params: Record<string, unknown> }
  implementation: {
    overview: string
    detection: DetectionRule[]
    steps: string[]
    transforms: TransformExample[]
    applyPrompt: string
    acceptanceCriteria: string[]
    verification: { metric: string, method: string }
    risks: string[]
    rollback: string
  }
  reviewStatus: "draft" | "pending" | "approved"
  reviewedBy?: string
  reviewedAt?: ISO8601
  version: number
}

ApplicabilityPredicate =
  | { all: ApplicabilityPredicate[] }
  | { any: ApplicabilityPredicate[] }
  | { not: ApplicabilityPredicate }
  | { path: string, eq: unknown }
  | { path: string, neq: unknown }
  | { path: string, gte: number }
  | { path: string, lte: number }
  | { path: string, includes: unknown }

DetectionRule {
  language: "typescript" | "javascript" | "python"
  kind: "regex" | "ast"
  query: string          // regex pattern or tree-sitter S-expression query
  description: string
}

TransformExample {
  language: "typescript" | "javascript" | "python"
  framework?: string
  before: string
  after: string
  notes: string
}
```

#### 2f. Platform

```typescript
Platform {
  id: string                       // e.g. "vscode", "cursor", "windsurf", "antigravity"
  label: string
  detect: {
    appNames: string[]             // substrings of vscode.env.appName
    uriSchemes: string[]           // vscode.env.uriScheme values
    markerFiles: string[]          // workspace-root-relative paths
  }
  artifactTargets: ArtifactTarget[]
  isDefault?: boolean             // exactly one platform; used when detection finds no match (no hard-coded id)
  agentInvocation?: AgentInvocation   // absent -> clipboard fallback (FR-057)
  docsUrl: string
  verifiedAt: ISO8601
}

ArtifactTarget {
  kind: "command" | "prompt" | "rule" | "instruction" | "skill"
  layout: "file" | "directory"   // "skill" targets use "directory": <pathTemplate>/SKILL.md + supporting files
  defaultEnabled: boolean         // shown pre-ticked in the install review list; user can untick
  pathTemplate: string   // e.g. ".cursorrules"; for skills include {{strategyId}}
  format: "markdown" | "yaml" | "json"
  frontmatterTemplate?: string
}

AgentInvocation {                 // how the IDE agent route works on this platform (FR-055)
  mechanisms: Array<                // ordered by preference; first one available on the host is used
    | { kind: "lm-edit", vendor: string, family?: string }   // extension calls host model API, applies reviewed edits
    | { kind: "chat-handoff", commandId: string, argsTemplate: Record<string, string> }   // submit is never set
    | { kind: "clipboard" }
  >
  verifiedAt: ISO8601
}
```

#### 2g. PromptTemplate

```typescript
PromptTemplate {
  id: string
  version: number
  purpose: "enhance" | "profile-extract" | "apply-edit" | "preview" | "handoff"
  template: string           // handlebars-style with {{variable}} slots
  outputSchemaRef: string    // reference to a Zod schema name in core
  active: boolean
}
```

#### 2h. CatalogMeta

```typescript
CatalogMeta {
  version: number            // monotonically incrementing integer
  publishedAt: ISO8601
  schemaVersion: string      // e.g. "1.0" — used for forward-compatibility check
}
```

---

### 3. EstimationResult

Output of `estimate(profile, catalog, userOverrides)`. Never stored long-term; re-derived
on every edit.

```typescript
EstimationResult {
  profileVersion: number
  catalogVersion: number
  build: TrackResult
  runtime: TrackResult
  generatedAt: ISO8601
}

TrackResult {
  phases: PhaseResult[]
  totalByModel: Record<ModelId, CostRange>
}

PhaseResult {
  phaseId: string
  phaseName: string
  params: ResolvedParams        // after user overrides applied
  tokensByModel: Record<ModelId, TokenBreakdown>
  costByModel: Record<ModelId, CostRange>
  explainTree: ExplainNode      // recursive formula tree for every number
}

TokenBreakdown {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  totalTokens: number
  label: "exact" | "approximate"
  approximationMargin?: string   // e.g. "±15%"
}

CostRange {
  low: number
  expected: number
  high: number
  currency: "USD"
  pricingVerifiedAt?: ISO8601
}

ExplainNode {
  label: string
  formula: string
  inputs: Record<string, number | string>
  result: number
  children?: ExplainNode[]
}
```

---

### 4. EditProposal

Output of Apply now planner; schema-validated by Zod before the diff view is shown.

```typescript
EditProposal {
  strategyId: string
  file: string            // workspace-relative path
  anchorHash: string      // SHA-256 of the original snippet content
  originalSnippet: string
  replacement: string
  rationale: string
  syntaxValid: boolean    // set by ValidatorService
  anchorMatched: boolean  // set by ValidatorService
}
```

---

### 5. Checkpoint

```typescript
Checkpoint {
  id: string              // UUID
  kind: "git-stash" | "backup"
  reference: string       // stash SHA or backup directory path
  affectedFiles: string[] // workspace-relative paths
  createdAt: ISO8601
}
```

Stored per-session in `workspaceState`. Referenced by the audit and rollback commands.

---

### 6. UserSetup

Non-secret setup restored on launch (FR-050). Key values are never part of this entity.

```typescript
UserSetup {
  platformId: string               // chosen or auto-detected platform id
  platformOverridden: boolean
  providers: Array<{
    providerId: string
    maskedKeys: Array<{ keySlot: number, maskedKey: string }>   // last 4 only
    enabledModels: string[]
  }>
  enhanceModel?: { providerId: string, modelId: string }
  copilotOnly: boolean
  updatedAt: ISO8601
}
```

**Storage**: `context.globalState` (on-device). No accounts, no server-side copy. Key values live in
SecretStorage only and are re-entered on a new device.

### 7. Stage contracts and ApplicabilityContext

```typescript
// Four stages. Only "enhance" and "implement" may call an LLM.
EnhanceStage    : (description, previousProfile?)            -> { narrative, profile }          // LLM
EstimateStage   : (profile, catalog, overrides?)             -> EstimationResult                // pure, no LLM
OptimizeStage   : (profile, estimation, catalog.strategies)  -> { preselected, notPreselected, conflicts, savings }   // pure, no LLM
ImplementStage  : (selection, platform, profile)             -> InstallPlan | IdeAgentRun       // LLM only via host model API / host chat

ApplicabilityContext {
  profile: ProjectProfile                 // paths such as "llm.usesRag"
  phaseTypes: string[]                    // confirmed phaseTypeIds, e.g. "embedding-ingestion"
  tokenShareByPhaseType: Record<string, number>   // expected-case share of its track's tokens, 0..1
}
```

Strategy `applicability` paths resolve against `ApplicabilityContext`, so a predicate can say
`{ path: "phaseTypes", includes: "embedding-ingestion" }` or
`{ path: "tokenShareByPhaseType.generation", gte: 0.4 }`.

### 8. HandoffPrompt

```typescript
HandoffPrompt {
  strategyIds: string[]
  profileVersion: number
  text: string                     // chat-handoff mechanism only; rendered from prompt template purpose="handoff", redacted per FR-048
  checkpointId?: string            // set once the user confirms
}
```

---

## State Transitions

```
ProfileHistory:  [draft v1] --Enhance--> [draft v2] --Finalize--> [final v2]
                                                               ↓
                                                        (unlocks Estimate)

EstimationResult: derived on demand from [final Profile] + [active Catalog]; re-derived
                  on every phase-assumption edit; never persisted.

Checkpoint:       created immediately before any WorkspaceEdit.apply()
                  can be used to rollback after apply or to compute audit diff.

Strategy:         draft --> pending --> approved   (catalog authoring workflow)
                  Only "approved" strategies are served by the API.
```
