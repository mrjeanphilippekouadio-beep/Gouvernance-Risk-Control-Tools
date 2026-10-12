import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";

// F-B6a-10: the threshold check must hold against the smallest ceiling of ALL scales that stay ACTIVE.
// A (fw1) ACTIVE on Small5 (5x5), B (fw2) ACTIVE on Big6 (6x6, newest); configs = 30; B's v2 goes on Old6 (6x6).
function pool(cfg: number) {
  const log: string[] = [];
  const res = (rows: unknown[]) => ({ rows, rowCount: rows.length });
  const scales = [
    { id: "small5", status: "ACTIVE", n: 25 }, { id: "big6", status: "ACTIVE", n: 36 }, { id: "old6", status: "DRAFT", n: 36 },
  ];
  const ver = {
    id: "v2", tenant_id: "t1", framework_id: "fw2", version_number: 2, status: "PENDING_APPROVAL", rating_scale_id: "old6",
    default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: cfg, committee_evaluation_enforced: false, // B-6b: the threshold now lives on the version (configs is no longer read)
    committee_treatment_min_score: null, appetite_thresholds: [], change_approver: "RISK_MANAGER", self_proposal_allowed: false,
  };
  const client = {
    async query(sql: string) {
      const s = sql.replace(/\s+/g, " ").trim();
      log.push(s);
      if (/FROM risk_framework_change_requests .*FOR UPDATE/.test(s)) return res([{ id: "r1", status: "PENDING", kind: "ACTIVATE_VERSION", version_id: "v2", framework_id: "fw2" }]);
      if (/^UPDATE risk_framework_change_requests/.test(s)) return res([{ id: "r1", status: "APPROVED" }]);
      if (/status = 'ACTIVE' FOR UPDATE/.test(s)) return res([]);
      if (/^UPDATE risk_framework_versions .*'ACTIVE'/.test(s)) return res([{ ...ver, status: "ACTIVE" }]);
      if (/^SELECT status, probability_levels/.test(s)) return res([{ status: "DRAFT", probability_levels: 6, impact_levels: 6 }]);
      if (/FROM configs/.test(s)) return res([{ e: cfg, t: null }]);
      if (/FROM risk_appetites/.test(s)) return res([]);
      if (/^UPDATE rating_scales SET status = 'ACTIVE'/.test(s)) scales.find((x) => x.id === "old6")!.status = "ACTIVE";
      if (/^UPDATE rating_scales SET status = 'ARCHIVED'/.test(s)) scales.find((x) => x.id === "big6")!.status = "ARCHIVED"; // only the unreferenced one
      if (/^SELECT min\(/.test(s)) return res([{ ceiling: Math.min(...scales.filter((x) => x.status === "ACTIVE").map((x) => x.n)) }]);
      return { rows: [], rowCount: 1 };
    },
    release() { /* noop */ },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}
const decision = { outcome: "APPROVED" as const, decidedBy: "u2", comment: null, decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null };

describe("F-B6a-10 mirrorScale checks the smallest ceiling of the scales left ACTIVE", () => {
  it("configs 30 with Small5 still ACTIVE: refused, names the threshold, full ROLLBACK", async () => {
    const f = pool(30);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision))
      .rejects.toThrow(/smallest maximum score \(25\).*seuil Comité évaluation de la version \(30\)/);
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it("configs 25 fits every remaining scale: committed", async () => {
    const f = pool(25);
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision("t1", "r1", decision);
    expect(f.log.at(-1)).toBe("COMMIT");
  });
});
