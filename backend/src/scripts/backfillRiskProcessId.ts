import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { Risk } from "../domain/entities/Risk.js";
import type { Process } from "../domain/entities/Process.js";

/**
 * DECISION-006 / DIV-05 (.claude/agent-context/ACTION_ITEMS.md): `risks.process_id`
 * (migration 029) was added Expand-only and deliberately never backfilled —
 * `risks.process` is free text with no reliable 1:1 correspondence to
 * `processes.name` (typos, renamed processes, abbreviations, and — confirmed
 * in session — `processes.name` carries no UNIQUE constraint at all, so the
 * same name can legitimately exist at different levels or under different
 * parents). A text match here is therefore structurally ambiguous, not a
 * mechanical mass UPDATE.
 *
 * This script only *proposes* a backfill. It classifies every risk with a
 * null `processId` and a non-empty `process` text into one of three buckets:
 *
 *   - unique    exactly one Process (same tenant) whose name matches
 *               `risk.process` case/whitespace-insensitively — candidate
 *               for backfill.
 *   - ambiguous more than one Process matches (e.g. the same name exists
 *               under two different parents, or at two different levels) —
 *               excluded, reported for manual review.
 *   - unmatched no Process matches at all — excluded, reported with the raw
 *               text for manual review.
 *
 * No fuzzy matching. Dry-run by default: it only writes a report (console +
 * JSON file). `--apply` is required to actually write `process_id`, and
 * even then only for `unique` matches — `ambiguous` and `unmatched` risks
 * are never touched by this script, under any flag.
 *
 * Usage:
 *   tsx src/scripts/backfillRiskProcessId.ts --tenant <tenantId> [--apply] [--out <path>]
 */

export interface RiskLite {
  id: string;
  process: string;
}

export interface ProcessLite {
  id: string;
  name: string;
  level: string;
  parentId: string | null;
}

export interface UniqueMatch {
  kind: "unique";
  riskId: string;
  rawProcessText: string;
  processId: string;
  processName: string;
}

export interface AmbiguousMatch {
  kind: "ambiguous";
  riskId: string;
  rawProcessText: string;
  candidates: ProcessLite[];
}

export interface UnmatchedRisk {
  kind: "unmatched";
  riskId: string;
  rawProcessText: string;
}

export type ClassificationResult = UniqueMatch | AmbiguousMatch | UnmatchedRisk;

export interface BackfillReport {
  tenantId: string;
  generatedAt: string;
  totalCandidateRisks: number;
  unique: UniqueMatch[];
  ambiguous: AmbiguousMatch[];
  unmatched: UnmatchedRisk[];
}

/** Case/whitespace-insensitive, never fuzzy — exact match after normalization only. */
export function normalizeProcessText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pure classification — no I/O, fully unit-testable with hand-built
 * fixtures. `risks` must already be pre-filtered to `processId === null`
 * and non-empty `process` text (see `buildBackfillReport`).
 */
export function classifyRisksForBackfill(
  risks: readonly RiskLite[],
  processes: readonly ProcessLite[],
): ClassificationResult[] {
  const byNormalizedName = new Map<string, ProcessLite[]>();
  for (const process of processes) {
    const key = normalizeProcessText(process.name);
    const bucket = byNormalizedName.get(key);
    if (bucket) bucket.push(process);
    else byNormalizedName.set(key, [process]);
  }

  return risks.map((risk): ClassificationResult => {
    const key = normalizeProcessText(risk.process);
    const candidates = byNormalizedName.get(key) ?? [];
    if (candidates.length === 0) {
      return { kind: "unmatched", riskId: risk.id, rawProcessText: risk.process };
    }
    if (candidates.length === 1) {
      const match = candidates[0];
      if (!match) throw new Error("unreachable: candidates.length === 1 but no element");
      return {
        kind: "unique",
        riskId: risk.id,
        rawProcessText: risk.process,
        processId: match.id,
        processName: match.name,
      };
    }
    return { kind: "ambiguous", riskId: risk.id, rawProcessText: risk.process, candidates };
  });
}

/**
 * Fetches the candidate risks + processes for `tenantId` through the real
 * repository interfaces (works against the Postgres implementations in
 * production, and against in-memory test doubles in unit tests) and
 * produces the full report.
 */
export async function buildBackfillReport(
  riskRepository: RiskRepository,
  processRepository: ProcessRepository,
  tenantId: string,
): Promise<BackfillReport> {
  const [allRisks, allProcesses] = await Promise.all([
    riskRepository.list(tenantId, { includeArchived: true }),
    processRepository.list(tenantId, { includeInactive: true }),
  ]);

  const candidateRisks: Risk[] = allRisks.filter(
    (r) => r.processId === null && r.process.trim().length > 0,
  );

  const riskLites: RiskLite[] = candidateRisks.map((r) => ({ id: r.id, process: r.process }));
  const processLites: ProcessLite[] = allProcesses.map((p: Process) => ({
    id: p.id,
    name: p.name,
    level: p.level,
    parentId: p.parentId,
  }));

  const results = classifyRisksForBackfill(riskLites, processLites);

  const unique: UniqueMatch[] = [];
  const ambiguous: AmbiguousMatch[] = [];
  const unmatched: UnmatchedRisk[] = [];
  for (const result of results) {
    if (result.kind === "unique") unique.push(result);
    else if (result.kind === "ambiguous") ambiguous.push(result);
    else unmatched.push(result);
  }

  return {
    tenantId,
    generatedAt: new Date().toISOString(),
    totalCandidateRisks: candidateRisks.length,
    unique,
    ambiguous,
    unmatched,
  };
}

/**
 * Applies the backfill — `unique` matches only, one `RiskRepository.update`
 * call per match. Never touches `ambiguous`/`unmatched`. Caller is
 * responsible for gating this behind `--apply`.
 */
export async function applyUniqueMatches(
  riskRepository: RiskRepository,
  tenantId: string,
  matches: readonly UniqueMatch[],
): Promise<{ applied: number; failed: { riskId: string; error: string }[] }> {
  let applied = 0;
  const failed: { riskId: string; error: string }[] = [];
  for (const match of matches) {
    try {
      await riskRepository.update(tenantId, match.riskId, { processId: match.processId });
      applied++;
    } catch (err) {
      failed.push({ riskId: match.riskId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { applied, failed };
}

function printReport(report: BackfillReport, applied: boolean): void {
  console.log(`\n=== Backfill risks.process_id — tenant ${report.tenantId} ===`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Total candidate risks (process_id IS NULL, process non-empty): ${report.totalCandidateRisks}`);
  console.log(`  Unique matches:    ${report.unique.length}${applied ? " (applied)" : " (dry-run, not applied)"}`);
  console.log(`  Ambiguous matches: ${report.ambiguous.length} (excluded, needs manual review)`);
  console.log(`  Unmatched:         ${report.unmatched.length} (excluded, needs manual review)`);

  if (report.unique.length > 0) {
    console.log("\n--- Unique matches (risk.id -> process.id) ---");
    for (const m of report.unique) {
      console.log(`  ${m.riskId} -> ${m.processId}  ("${m.rawProcessText}" == "${m.processName}")`);
    }
  }

  if (report.ambiguous.length > 0) {
    console.log("\n--- Ambiguous (excluded) ---");
    for (const m of report.ambiguous) {
      const candidateList = m.candidates
        .map((c) => `${c.id} [${c.level}${c.parentId ? `, parent=${c.parentId}` : ", no parent"}]`)
        .join("; ");
      console.log(`  risk ${m.riskId} "${m.rawProcessText}" -> ${m.candidates.length} candidates: ${candidateList}`);
    }
  }

  if (report.unmatched.length > 0) {
    console.log("\n--- Unmatched (excluded) ---");
    for (const m of report.unmatched) {
      console.log(`  risk ${m.riskId} raw text: "${m.rawProcessText}"`);
    }
  }
}

function parseArgs(argv: string[]): { tenantId: string; apply: boolean; out: string | null } {
  let tenantId: string | null = null;
  let apply = false;
  let out: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") {
      tenantId = argv[++i] ?? null;
    } else if (arg === "--apply") {
      apply = true;
    } else if (arg === "--out") {
      out = argv[++i] ?? null;
    }
  }

  if (!tenantId) {
    console.error(
      "Usage: tsx src/scripts/backfillRiskProcessId.ts --tenant <tenantId> [--apply] [--out <path>]",
    );
    process.exit(1);
  }

  return { tenantId, apply, out };
}

async function main(): Promise<void> {
  const { tenantId, apply, out } = parseArgs(process.argv.slice(2));

  // Dynamic import: pool.ts validates required env vars (DATABASE_URL etc.)
  // at module load and exits if they're missing. Keeping it out of this
  // file's static imports means importing this module for its pure/testable
  // exports (see the unit test) never triggers that validation — only
  // actually running the CLI (this function) does.
  const { pool } = await import("../infrastructure/database/pool.js");
  const { PostgresRiskRepository } = await import(
    "../infrastructure/database/postgres/PostgresRiskRepository.js"
  );
  const { PostgresProcessRepository } = await import(
    "../infrastructure/database/postgres/PostgresProcessRepository.js"
  );

  const riskRepository = new PostgresRiskRepository(pool);
  const processRepository = new PostgresProcessRepository(pool);

  const report = await buildBackfillReport(riskRepository, processRepository, tenantId);

  let applied = false;
  if (apply) {
    if (report.unique.length === 0) {
      console.log("\n--apply passed but there are 0 unique matches — nothing to do.");
    } else {
      console.log(`\n--apply passed: writing process_id for ${report.unique.length} unique match(es)...`);
      const result = await applyUniqueMatches(riskRepository, tenantId, report.unique);
      applied = true;
      console.log(`Applied: ${result.applied}/${report.unique.length}`);
      if (result.failed.length > 0) {
        console.error(`Failed (${result.failed.length}):`);
        for (const f of result.failed) console.error(`  risk ${f.riskId}: ${f.error}`);
      }
    }
  } else {
    console.log("\nDry-run (default) — no writes performed. Pass --apply to write the unique matches above.");
  }

  printReport(report, applied);

  const outPath = out ?? `backfill-risk-process-id-${tenantId}-${Date.now()}.json`;
  writeFileSync(outPath, JSON.stringify({ ...report, applied }, null, 2), "utf-8");
  console.log(`\nReport written to ${outPath}`);

  await pool.end();
}

// Only run main() when executed directly (tsx src/scripts/...), not when
// imported by the unit test — same guard shape as the rest of this
// scripts/ folder relies on the entrypoint being invoked via the CLI, but
// this file is also imported for its pure/testable exports.
const isMainModule = process.argv[1]?.endsWith("backfillRiskProcessId.ts") || process.argv[1]?.endsWith("backfillRiskProcessId.js");
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
