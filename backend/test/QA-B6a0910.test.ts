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
    default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: null, committee_evaluation_enforced: false,
    committee_treatment_min_score: null, appetite_thresholds: [], change_approver: "RISK_MANAGER", self_proposal_allowed: false,
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

describe("QA-B6a0910 F-B6a-10 smallest ceiling of the scales left ACTIVE", () => {
  // Own scale Big6 (36). Two other scales stay ACTIVE (each referenced by another ACTIVE version): 25 and 16.
  const base = (cfg: number): Opts => ({
    scales: [{ id: "own", status: "DRAFT", n: 36 }, { id: "a25", status: "ACTIVE", n: 25 }, { id: "a16", status: "ACTIVE", n: 16 }],
    own: "own", referenced: ["a25", "a16"], cfgEval: cfg,
  });

  it("several scales stay ACTIVE: the MINIMUM (16) is used, not the first or the own one", async () => {
    const f = pool(base(17));
    await expect(run(f)).rejects.toThrow(/smallest maximum score \(16\).*seuil Comité évaluation \(configs\) \(17\)/);
    expect(ended(f)).toBe("ROLLBACK");
  });

  it("threshold exactly equal to the minimum (16) is accepted and committed; min + 1 is refused", async () => {
    const ok = pool(base(16));
    await run(ok);
    expect(ended(ok)).toBe("COMMIT");
    const ko = pool(base(17));
    await expect(run(ko)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a scale ARCHIVED by the stray-scale statement no longer counts (unreferenced 9 is archived: min stays 25)", async () => {
    const f = pool({ scales: [{ id: "own", status: "DRAFT", n: 36 }, { id: "a25", status: "ACTIVE", n: 25 }, { id: "stray9", status: "ACTIVE", n: 9 }], own: "own", referenced: ["a25"], cfgEval: 25 });
    await run(f);
    expect(ended(f)).toBe("COMMIT");
  });

  it("DRAFT, ARCHIVED and soft-deleted scales never lower the minimum", async () => {
    const f = pool({
      scales: [
        { id: "own", status: "DRAFT", n: 36 }, { id: "a25", status: "ACTIVE", n: 25 },
        { id: "d9", status: "DRAFT", n: 9 }, { id: "z4", status: "ARCHIVED", n: 4 }, { id: "x1", status: "ACTIVE", n: 1, deleted: true },
      ],
      own: "own", referenced: ["a25", "x1"], cfgEval: 25,
    });
    await run(f);
    expect(ended(f)).toBe("COMMIT");
  });

  it("no other ACTIVE scale: the minimum is the own ceiling (36), a threshold of 36 passes, 37 is caught by the own-ceiling check", async () => {
    const ok = pool({ scales: [{ id: "own", status: "DRAFT", n: 36 }], own: "own", cfgEval: 36 });
    await run(ok);
    expect(ended(ok)).toBe("COMMIT");
    const ko = pool({ scales: [{ id: "own", status: "DRAFT", n: 36 }], own: "own", cfgEval: 37 });
    await expect(run(ko)).rejects.toThrow(/maximum score of the scale \(36\)/);
  });

  it("min() returning NULL (no ACTIVE row) falls back to the own ceiling instead of blocking or crashing", async () => {
    const f = pool({ scales: [{ id: "own", status: "DRAFT", n: 25 }], own: "own", cfgEval: 25, minCeilingNull: true });
    await run(f);
    expect(ended(f)).toBe("COMMIT");
  });

  it("own scale is the smallest (9) and others are bigger: own ceiling wins, message names the own-scale check", async () => {
    const f = pool({ scales: [{ id: "own", status: "DRAFT", n: 9 }, { id: "a36", status: "ACTIVE", n: 36 }], own: "own", referenced: ["a36"], cfgEval: 10 });
    await expect(run(f)).rejects.toThrow(/maximum score of the scale \(9\)/);
  });

  it("inactive and soft-deleted appetites are ignored; an active one above the minimum is refused with its sub-category", async () => {
    const mk = (apps: NonNullable<Opts["appetites"]>) => pool({ ...base(1), appetites: apps });
    const ok = mk([{ sub_category: "Fraude", threshold: 36, active: false }, { sub_category: "Cyber", threshold: 30, active: true, deleted: true }]);
    await run(ok);
    expect(ended(ok)).toBe("COMMIT");
    const ko = mk([{ sub_category: "Fraude", threshold: 17, active: true }, { sub_category: "Cyber", threshold: 16, active: true }]);
    await expect(run(ko)).rejects.toThrow(/smallest maximum score \(16\).*appétence "Fraude" \(17\)/);
    const msg = await run(mk([{ sub_category: "Fraude", threshold: 17, active: true }, { sub_category: "Cyber", threshold: 16, active: true }])).catch((e: Error) => e.message);
    expect(msg).not.toMatch(/Cyber/); // 16 == minimum: not listed
  });

  it("version-level thresholds (Comité evaluation / treatment, appetite array) are checked against the minimum; null ones are skipped", async () => {
    const f = pool({
      ...base(1),
      version: { committee_evaluation_min_score: 20, committee_treatment_min_score: null, appetite_thresholds: [{ subCategory: "Liquidité", threshold: 30 }] },
    });
    const msg = await run(f).catch((e: Error) => e.message);
    expect(msg).toMatch(/smallest maximum score \(16\)/);
    expect(msg).toMatch(/seuil Comité évaluation de la version \(20\)/);
    expect(msg).toMatch(/appétence "Liquidité" de la version \(30\)/);
    expect(msg).not.toMatch(/traitement/);
    expect(ended(f)).toBe("ROLLBACK");
  });

  it("all offending thresholds are listed in one message (configs eval + treatment)", async () => {
    const f = pool({ ...base(30), cfgTreat: 28 });
    const msg = await run(f).catch((e: Error) => e.message);
    expect(msg).toMatch(/seuil Comité évaluation \(configs\) \(30\)/);
    expect(msg).toMatch(/seuil Comité traitement \(configs\) \(28\)/);
  });

  it("refusal leaves no COMMIT; the whole decision (request UPDATE included) is in the rolled-back transaction", async () => {
    const f = pool(base(30));
    await expect(run(f)).rejects.toBeInstanceOf(ValidationError);
    expect(f.log.map((l) => l.sql)).not.toContain("COMMIT");
    const iUpd = f.log.findIndex((l) => /^UPDATE risk_framework_change_requests/.test(l.sql));
    const iRb = f.log.findIndex((l) => l.sql === "ROLLBACK");
    expect(iUpd).toBeGreaterThan(-1);
    expect(iRb).toBeGreaterThan(iUpd);
  });

  it("the min query is tenant-scoped, parameterised, filters ACTIVE + not deleted, and runs AFTER the scale is activated and strays archived", async () => {
    const f = pool(base(16));
    await run(f);
    const i = f.log.findIndex((l) => /^SELECT min\(/.test(l.sql));
    expect(i).toBeGreaterThan(-1);
    expect(f.log[i]!.params).toEqual(["t1"]);
    expect(f.log[i]!.sql).toMatch(/WHERE tenant_id = \$1 AND status = 'ACTIVE' AND deleted_at IS NULL/);
    expect(f.log[i]!.sql).toMatch(/min\(probability_levels \* impact_levels\)/);
    expect(i).toBeGreaterThan(f.log.findIndex((l) => /^UPDATE rating_scales SET status = 'ACTIVE'/.test(l.sql)));
    expect(i).toBeGreaterThan(f.log.findIndex((l) => /^UPDATE rating_scales SET status = 'ARCHIVED'/.test(l.sql)));
  });

  it("REJECTED decision never runs the min query", async () => {
    const f = pool(base(30));
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", { ...decision, outcome: "REJECTED", comment: "non" });
    expect(f.log.some((l) => /min\(/.test(l.sql))).toBe(false);
  });
});

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
    expect(r.length).toBe(1);
    expect(r[0]).not.toMatch(/\bstatus\b|decided_by|decided_at|decision_comment|decision_regime|decider_group|ratification_status/);
    expect(r[0]).toMatch(/requested_by/);
  });

  it("057 guards exactly those columns, with BEFORE INSERT triggers distinct from the 055/056 ones", () => {
    for (const col of ["activation_request_id", "activated_at", "archived_at", "archived_by", "archive_reason"]) expect(sql).toContain(`NEW.${col} IS NOT NULL`);
    for (const col of ["decided_by", "decided_at", "decision_comment", "decision_regime", "decider_group", "ratification_status"]) expect(sql).toContain(`NEW.${col} IS NOT NULL`);
    expect(sql).toMatch(/BEFORE INSERT ON risk_framework_versions/);
    expect(sql).toMatch(/BEFORE INSERT ON risk_framework_change_requests/);
    expect(sql).not.toMatch(/DELETE FROM|TRUNCATE|DROP TABLE/);
  });
});
