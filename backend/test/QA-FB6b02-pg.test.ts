import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * F-B6b-02 on a REAL PostgreSQL 16 (disposable, local unix socket): frozen snapshot of risk_evaluations + tenant FK.
 * Skipped unless QA_FB6B02_PGHOST is a unix socket DIRECTORY (starts with "/"); a TCP host is refused on purpose.
 * Database: QA_FB6B02_PGDB (default grc_qa), user postgres. Prerequisite: migrations 001..061 (fixtures consistent with the 061 insert guard) applied.
 * Everything runs in one transaction that is rolled back; each probe in a savepoint.
 */
const HOST = process.env.QA_FB6B02_PGHOST ?? "";
const enabled = HOST.startsWith("/");

describe.skipIf(!enabled)("F-B6b-02 snapshot guard on real PostgreSQL", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids = {} as Record<"ta" | "tb" | "u" | "s1" | "s2" | "va" | "vb" | "risk" | "frozen" | "legacy", string>;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  /** SQLSTATE of a refused statement, or "OK". */
  async function probe(sql: string, p: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT p");
    try { await c.query(sql, p); await c.query("RELEASE SAVEPOINT p"); return "OK"; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT p"); return (e as { code: string }).code; }
  }
  const upd = (set: string, who: "frozen" | "legacy", p: unknown[] = []) =>
    probe(`UPDATE risk_evaluations SET ${set} WHERE id = $1`, [ids[who], ...p]);

  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: process.env.QA_FB6B02_PGDB ?? "grc_qa", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
    ids.ta = await one(`INSERT INTO tenants (name) VALUES ('fb6b02-a') RETURNING id`);
    ids.tb = await one(`INSERT INTO tenants (name) VALUES ('fb6b02-b') RETURNING id`);
    ids.u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, 'u@fb6b02', 'u') RETURNING id`, [ids.ta]);
    const scale = (n: string) => one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1, $2, '1', 5, 5) RETURNING id`, [ids.ta, n]);
    ids.s1 = await scale("s1"); ids.s2 = await scale("s2");
    const version = async (t: string) => {
      const f = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1, 'fw') RETURNING id`, [t]);
      return one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score, committee_treatment_min_score) VALUES ($1, $2, 1, $3, 15, 20) RETURNING id`, [t, f, ids.s1]);
    };
    ids.va = await version(ids.ta); ids.vb = await version(ids.tb);
    // 061: the insert guard needs an ACTIVE version; test-only shortcut (superuser, rolled back).
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`UPDATE risk_framework_versions SET status = 'ACTIVE' WHERE id = $1`, [ids.va]);
    await c.query("SET LOCAL session_replication_role = origin");
    ids.risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1, 'p', 'd') RETURNING id`, [ids.ta]);
    ids.frozen = await one(
      `INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, risk_framework_version_id, rating_scale_id, rating_scale_version,
         committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score)
       VALUES ($1, $2, 'AD_HOC', $3, 'x', $4, $5, '1', 15, true, 20) RETURNING id`, [ids.ta, ids.risk, ids.u, ids.va, ids.s1]);
    ids.legacy = await one(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category) VALUES ($1, $2, 'AD_HOC', $3, 'x') RETURNING id`, [ids.ta, ids.risk, ids.u]);
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("refuses a version of another tenant (061 insert guard, 42501; composite FK behind it)", async () => {
    expect(await probe(
      `INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, risk_framework_version_id) VALUES ($1, $2, 'AD_HOC', $3, 'x', $4)`,
      [ids.ta, ids.risk, ids.u, ids.vb])).toBe("42501");
  });
  it("freezes every snapshot column once set (42501), including back to NULL", async () => {
    expect(await upd("risk_framework_version_id = $2", "frozen", [ids.vb])).toBe("42501");
    expect(await upd("risk_framework_version_id = NULL", "frozen")).toBe("42501");
    expect(await upd("committee_evaluation_min_score = 10", "frozen")).toBe("42501");
    expect(await upd("committee_evaluation_enforced = false", "frozen")).toBe("42501");
    expect(await upd("committee_treatment_min_score = NULL", "frozen")).toBe("42501");
    expect(await upd("rating_scale_id = $2", "frozen", [ids.s2])).toBe("42501");
    expect(await upd("rating_scale_id = NULL", "frozen")).toBe("42501");
  });
  it("still allows the application paths", async () => {
    expect(await upd("rating_scale_id = $2, rating_scale_version = '1', inherent_score = 5, updated_at = now()", "frozen", [ids.s1])).toBe("OK");
    expect(await upd("status = 'VALIDATED', comment = 'c', updated_at = now()", "frozen")).toBe("OK");
    expect(await upd("rating_scale_id = $2, rating_scale_version = '1'", "legacy", [ids.s1])).toBe("OK"); // NULL -> value (spec 8.1)
  });
  it("once a legacy row got its scale it is frozen too; the other NULL snapshot fields cannot be fabricated", async () => {
    expect(await upd("rating_scale_id = $2", "legacy", [ids.s2])).toBe("42501");
    expect(await upd("risk_framework_version_id = $2", "legacy", [ids.va])).toBe("42501");
    expect(await upd("committee_evaluation_min_score = 15", "legacy")).toBe("42501");
    expect(await upd("committee_evaluation_enforced = true", "legacy")).toBe("42501");
  });
});
