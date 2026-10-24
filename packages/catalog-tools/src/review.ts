/**
 * Human review workflow for strategies: draft report and named-reviewer approval (Principle VIII).
 *
 * Exports: ReviewReportResult, generateReviewReport, approveStrategy
 * Feature: catalog
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, type Db } from "mongodb";
import { loadEnv } from "./env.js";
import {
  StrategySchema,
  type Strategy,
} from "@token-optimizer/core";

export interface ReviewReportResult {
  reportPath: string;
  draftCount: number;
}

const DISALLOWED_BOT_NAMES = [
  "bot",
  "github-actions",
  "github-actions[bot]",
  "dependabot",
  "llm",
  "ai",
  "copilot",
  "automated",
  "system",
];

export async function generateReviewReport(
  db: Db,
  options: { outputDir?: string; date?: string } = {}
): Promise<ReviewReportResult> {
  const col = db.collection("strategies");
  const drafts = await col.find({ reviewStatus: "draft" }).toArray();

  const dateStr = options.date || new Date().toISOString().slice(0, 10);
  const targetDir =
    options.outputDir ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../reports");

  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = path.join(targetDir, `review-${dateStr}.md`);

  const lines: string[] = [
    `# Strategy Review Report: ${dateStr}`,
    "",
    `**Total Draft Strategies Awaiting Human Review**: ${drafts.length}`,
    "",
    "## Maintainer Review Checklist (Principle VIII)",
    "Before approving any strategy, a human maintainer MUST verify:",
    "1. [ ] **Savings Range & Basis**: Stated `[min%, max%]` interval has documented empirical basis.",
    "2. [ ] **Preconditions & Targets**: Targets (`build`, `runtime`) and preconditions are accurate.",
    "3. [ ] **Detection Rules**: Query and AST patterns target real call sites without false positives.",
    "4. [ ] **Rollback**: Rollback instructions are safe and verifiable.",
    "5. [ ] **Human Accountability**: Approval MUST be performed by a named human maintainer (bots prohibited).",
    "",
    "---",
    "",
  ];

  if (drafts.length === 0) {
    lines.push("No draft strategies currently awaiting review.\n");
  } else {
    for (const draft of drafts) {
      lines.push(`### Strategy: \`${draft.id}\` - ${draft.name}`);
      lines.push(`- **Group**: \`${draft.group}\``);
      lines.push(`- **Targets**: ${(draft.targets || []).join(", ")}`);
      lines.push(`- **Summary**: ${draft.summary}`);
      if (draft.savings) {
        lines.push(
          `- **Savings**: ${draft.savings.minPercent}% - ${draft.savings.maxPercent}% (Basis: ${draft.savings.basis})`
        );
      }
      lines.push("- **Verification Status**: `draft`");
      lines.push("- **Approval Command**:");
      lines.push(
        `  \`pnpm --filter @token-optimizer/catalog-tools exec tsx src/review.ts --approve ${draft.id} --reviewer "<Your Name>"\``
      );
      lines.push("");
      lines.push("#### Verification Checklist:");
      lines.push("- [ ] Preconditions and applicability predicate tested against project profiles");
      lines.push("- [ ] Savings claim verified against provider rate cards or benchmarks");
      lines.push("- [ ] Code transform examples and detection queries validated");
      lines.push("- [ ] Approved by named human maintainer");
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
  return { reportPath, draftCount: drafts.length };
}

export async function approveStrategy(
  db: Db,
  strategyId: string,
  reviewerName: string
): Promise<Strategy> {
  const cleanName = (reviewerName || "").trim();
  if (!cleanName) {
    throw new Error(
      "Principle VIII violation: Reviewer name is required and cannot be empty."
    );
  }

  const lower = cleanName.toLowerCase();
  if (DISALLOWED_BOT_NAMES.some((b) => lower === b || lower.includes(`[${b}]`))) {
    throw new Error(
      `Principle VIII violation: Strategy approval must be performed by a named human maintainer. '${cleanName}' is a recognized bot/automated identity.`
    );
  }

  const col = db.collection("strategies");
  const doc = await col.findOne({ id: strategyId });

  if (!doc) {
    throw new Error(`Strategy '${strategyId}' not found in catalog.`);
  }

  const now = new Date().toISOString();
  const { _id, ...cleanDoc } = doc;

  const candidateDoc = {
    ...cleanDoc,
    reviewStatus: "approved" as const,
    reviewedBy: cleanName,
    reviewedAt: now,
  };

  // Validate complete document with Zod (including Principle VIII refinement)
  const validStrategy = StrategySchema.parse(candidateDoc);

  await col.updateOne(
    { id: strategyId },
    {
      $set: {
        reviewStatus: "approved",
        reviewedBy: cleanName,
        reviewedAt: now,
      },
    }
  );

  return validStrategy;
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  let isReport = false;
  let approveId = "";
  let reviewer = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--report") {
      isReport = true;
    } else if (args[i] === "--approve" && args[i + 1]) {
      approveId = args[i + 1];
      i++;
    } else if (args[i] === "--reviewer" && args[i + 1]) {
      reviewer = args[i + 1];
      i++;
    }
  }

  loadEnv();
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("Error: MONGODB_URI environment variable is required.");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  client
    .connect()
    .then(async () => {
      const db = client.db(process.env.MONGODB_DB || "token_optimizer");

      if (isReport) {
        console.log("Generating strategy review report...");
        const res = await generateReviewReport(db);
        console.log(
          `Report generated with ${res.draftCount} draft strategies: ${res.reportPath}`
        );
      } else if (approveId) {
        if (!reviewer) {
          console.error("Error: --reviewer \"<Your Name>\" is required to approve a strategy.");
          process.exit(1);
        }
        console.log(`Approving strategy '${approveId}' by reviewer '${reviewer}'...`);
        const approved = await approveStrategy(db, approveId, reviewer);
        console.log(`Strategy '${approved.id}' successfully approved!`);
      } else {
        console.log("Usage:");
        console.log("  tsx src/review.ts --report");
        console.log("  tsx src/review.ts --approve <id> --reviewer \"<Name>\"");
      }
    })
    .then(() => client.close())
    .catch((err) => {
      console.error("Review workflow failed:", err);
      client.close().finally(() => process.exit(1));
    });
}
