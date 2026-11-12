import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

// QA F-B6a-10 (mirrorScale: thresholds vs the smallest n x n among ALL scales left ACTIVE). Edge cases on top of B6aFix10.
// The fake honours the filters of the SQL it receives (status / deleted_at / active), so a dropped filter changes the outcome.
type Scale = { id: string; status: string; n: number; deleted?: boolean };
type Opts = {
  scales: Scale[];
  own: string; // rating_scale_id of the version being activated
  referenced?: string[]; // scales referenced by another ACTIVE version (kept ACTIVE by the archive statement)
  cfgEval?: number | null;
  cfgTreat?: number | null;
  appetites?: Array<{ sub_category: string; threshold: number; active: boolean; deleted?: boolean }>;
  version?: { committee_evaluation_min_score?: number | null; committee_treatment_min_score?: number | null; appetite_thresholds?: unknown[] };
  minCeilingNull?: boolean;
};

function pool(o: Opts) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const scales = o.scales.map((s) => ({ ...s }));
  const ver = {
    id: "v2", tenant_id: "t1", framework_id: "fw2", version_number: 2, status: "PENDING_APPROVAL", rating_scale_id: o.own,
    default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: o.cfgEval ?? null, committee_evaluation_enforced: false, // B-6b: configs/risk_appetites are no longer read by mirrorScale; the former "legacy" thresholds are now carried by the version
    committee_treatment_min_score: o.cfgTreat ?? null, appetite_thresholds: (o.appetites ?? []).filter((a) => a.active && !a.deleted).map((a) => ({ subCategory: a.sub_category, threshold: a.threshold })), change_approver: "RISK_MANAGER", self_proposal_allowed: false,
    ...o.version,
  };
  const client = {
    async query(sql: string, params: unknown[] = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      log.push({ sql: s, params });
      if (/FROM risk_framework_change_requests .*FOR UPDATE/.test(s)) return res([{ id: "r1", status: "PENDING", kind: "ACTIVATE_VERSION", version_id: "v2", framework_id: "fw2" }]);
      if (/^UPDATE risk_framework_change_requests/.test(s)) return res([{ id: "r1", status: "APPROVED" }]);
      if (/status = 'ACTIVE' FOR UPDATE/.test(s)) return res([]);
      if (/^UPDATE risk_framework_versions SET status = 'DRAFT'/.test(s)) return res([{ ...ver, status: "DRAFT" }]);
      if (/^UPDATE risk_framework_versions .*'ACTIVE'/.test(s)) return res([{ ...ver, status: "ACTIVE" }]);
      if (/^SELECT status, probability_levels/.test(s)) {
        const x = scales.find((y) => y.id === o.own)!;
        return res([{ status: x.status, probability_levels: x.n, impact_levels: 1 }]); // n x 1 = n: only the product matters
      }
      if (/FROM configs/.test(s)) return res([{ e: o.cfgEval === undefined ? 1 : o.cfgEval, t: o.cfgTreat ?? null }]);
      if (/FROM risk_appetites/.test(s)) {
        const filtered = o.appetites?.filter((a) => (!/\bactive\b/.test(s) || a.active) && (!/deleted_at IS NULL/.test(s) || !a.deleted)) ?? [];
        return res(filtered);
      }
      if (/^UPDATE rating_scales SET status = 'ACTIVE'/.test(s)) scales.find((x) => x.id === o.own)!.status = "ACTIVE";
      if (/^UPDATE rating_scales SET status = 'ARCHIVED'/.test(s)) {
        for (const x of scales) if (x.id !== o.own && x.status === "ACTIVE" && !x.deleted && !(o.referenced ?? []).includes(x.id)) x.status = "ARCHIVED";
      }
      if (/^SELECT min\(/.test(s)) {
        const live = scales.filter((x) => (!/status = 'ACTIVE'/.test(s) || x.status === "ACTIVE") && (!/deleted_at IS NULL/.test(s) || !x.deleted));
        return res([{ ceiling: o.minCeilingNull || live.length === 0 ? null : Math.min(...live.map((x) => x.n)) }]);
      }
      return { rows: [], rowCount: 1 };
    },
    release() { /* noop */ },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}
const decision = { outcome: "APPROVED" as const, decidedBy: "u2", comment: null, decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null };
const run = (f: ReturnType<typeof pool>) => new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision);
const ended = (f: ReturnType<typeof pool>) => f.log.at(-1)!.sql;


// Honesty check on the A06 edits of the QA fakes (QA-B6abis / B6abis): the handlers must stay faithful.
import { readFileSync } from "node:fs";
describe("QA-B6a0910 A06 handler in the older fake pools", () => {
  it("both fakes answer the min query; the stateful one derives it from the scales, the other pins 25 (all its scales are 5x5)", () => {
    const qa = readFileSync("test/QA-B6abis.test.ts", "utf8");
    const b = readFileSync("test/B6abis.test.ts", "utf8");
    expect(qa).toMatch(/SELECT min\\\(probability_levels\/\.test\(s\)\) \{\s*const n = db\.scales\.filter\(\(x\) => x\.tenant_id === t && x\.status === "ACTIVE" && !x\.deleted_at\)/);
    expect(b).toMatch(/SELECT min\\\(\/\.test\(log\.at\(-1\)!\)\) return row\(\[\{ ceiling: 25 \}\]\)/);
    expect(b).not.toMatch(/probability_levels: (?!5\b)\d+/); // B6abis only ever builds 5x5 scales
  });
});

// F-B6a-09: static pin of the compatibility between 057 and every INSERT of the repository. The real execution
// (disposable Postgres 16, 24 cases) is reported in the QA run; this keeps the contract from drifting.
describe("QA-B6a0910 migration 057 vs repository INSERTs", () => {
  const repo = readFileSync("src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts", "utf8");
  const sql = readFileSync("../database/postgresql/migrations/057_risk_framework_insert_guard.sql", "utf8");
  const inserts = (table: string) => [...repo.matchAll(new RegExp(`INSERT INTO ${table}\\b[\\s\\S]*?RETURNING`, "g"))].map((m) => m[0]);

  it("every version INSERT writes status 'DRAFT' and none of the activation/archive columns", () => {
    const v = inserts("risk_framework_versions");
    expect(v.length).toBe(2);
    for (const q of v) {
      expect(q).toMatch(/'DRAFT'/);
      expect(q).not.toMatch(/activation_request_id|activated_at|archived_at|archived_by|archive_reason/);
    }
  });

  it("every change-request INSERT omits status and every decision column (defaults to PENDING / NULL)", () => {
    const r = inserts("risk_framework_change_requests");
    expect(r.length).toBe(3); // B-6c: + the ASSIGN_PROCESS insert; B-13: + the SET_DEFAULT insert
    for (const q of r) expect(q).not.toMatch(/\bstatus\b|decided_by|decided_at|decision_comment|decision_regime|decider_group|ratification_status/);
    for (const q of r) expect(q).toMatch(/requested_by/);
  });

  it("057 guards exactly those columns, with BEFORE INSERT triggers distinct from the 055/056 ones", () => {
    for (const col of ["activation_request_id", "activated_at", "archived_at", "archived_by", "archive_reason"]) expect(sql).toContain(`NEW.${col} IS NOT NULL`);
    for (const col of ["decided_by", "decided_at", "decision_comment", "decision_regime", "decider_group", "ratification_status"]) expect(sql).toContain(`NEW.${col} IS NOT NULL`);
    expect(sql).toMatch(/BEFORE INSERT ON risk_framework_versions/);
    expect(sql).toMatch(/BEFORE INSERT ON risk_framework_change_requests/);
    expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/);
  });
});
