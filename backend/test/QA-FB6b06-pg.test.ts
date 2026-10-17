import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * Migration 061 on a REAL PostgreSQL 16 (disposable, local unix socket). Skipped unless QA_FB6B02_PGHOST is a unix
 * socket DIRECTORY (starts with "/"). Database: QA_FB6B02_PGDB (default grc_qa), user postgres. Needs migrations 001..061.
 * One transaction rolled back; each probe in a savepoint.
 */
const HOST = process.env.QA_FB6B02_PGHOST ?? "";
const enabled = HOST.startsWith("/");

describe.skipIf(!enabled)("061 insert guard / composite FKs on real PostgreSQL", () => {
  let pool: Pool;
  let c: PoolClient;
  const ids = {} as Record<"ta" | "tb" | "u" | "s1" | "s2" | "sb" | "va" | "draft" | "risk", string>;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  async function probe(sql: string, p: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT p");
    try { await c.query(sql, p); await c.query("RELEASE SAVEPOINT p"); return "OK"; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT p"); return (e as { code: string }).code; }
  }
  const ins = (cols: string, vals: string, p: unknown[]) =>
    probe(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category${cols}) VALUES ($1, $2, 'AD_HOC', $3, 'x'${vals})`, [ids.ta, ids.risk, ids.u, ...p]);
  const FULL = ", risk_framework_version_id, rating_scale_id, rating_scale_version, committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score";

  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: process.env.QA_FB6B02_PGDB ?? "grc_qa", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
    ids.ta = await one(`INSERT INTO tenants (name) VALUES ('fb6b06-a') RETURNING id`);
    ids.tb = await one(`INSERT INTO tenants (name) VALUES ('fb6b06-b') RETURNING id`);
    ids.u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, 'u@fb6b06', 'u') RETURNING id`, [ids.ta]);
    const scale = (t: string, n: string, v: string) => one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1, $2, $3, 5, 5) RETURNING id`, [t, n, v]);
    ids.s1 = await scale(ids.ta, "s1", "3"); ids.s2 = await scale(ids.ta, "s2", "4"); ids.sb = await scale(ids.tb, "sb", "1");
    const f = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1, 'fw') RETURNING id`, [ids.ta]);
    ids.va = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score, committee_treatment_min_score) VALUES ($1, $2, 1, $3, 15, 20) RETURNING id`, [ids.ta, f, ids.s1]);
    // ACTIVE without the approval workflow: test-only, user triggers off for this one statement (superuser, rolled back).
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(`UPDATE risk_framework_versions SET status = 'ACTIVE' WHERE id = $1`, [ids.va]);
    await c.query("SET LOCAL session_replication_role = origin");
    ids.draft = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1, $2, 2, $3, 15) RETURNING id`, [ids.ta, f, ids.s1]);
    ids.risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1, 'p', 'd') RETURNING id`, [ids.ta]);
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("accepts exactly what the service writes, and legacy rows without any snapshot", async () => {
    expect(await ins(FULL, ", $4, $5, '3', 15, true, 20", [ids.va, ids.s1])).toBe("OK");
    expect(await ins("", "", [])).toBe("OK");
  });
  it("refuses a fabricated snapshot (42501)", async () => {
    expect(await ins(FULL, ", $4, $5, '3', 99, true, 20", [ids.va, ids.s1])).toBe("42501"); // threshold
    expect(await ins(FULL, ", $4, $5, '3', 15, false, 20", [ids.va, ids.s1])).toBe("42501"); // enforced
    expect(await ins(FULL, ", $4, $5, '3', 15, true, NULL", [ids.va, ids.s1])).toBe("42501"); // treatment
    expect(await ins(FULL, ", $4, $5, '9', 15, true, 20", [ids.va, ids.s1])).toBe("42501"); // scale version
    expect(await ins(FULL, ", $4, $5, '4', 15, true, 20", [ids.va, ids.s2])).toBe("42501"); // other scale
    expect(await ins(FULL, ", $4, $5, '3', 15, true, 20", [ids.draft, ids.s1])).toBe("42501"); // not ACTIVE
    expect(await ins(", rating_scale_id", ", $4", [ids.s1])).toBe("42501"); // scale without version
    expect(await ins(", committee_evaluation_min_score", ", 15", [])).toBe("42501");
  });
  it("tenant consistency: foreign version / scale refused", async () => {
    await c.query("SAVEPOINT x");
    const r = await probe(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, risk_framework_version_id) VALUES ($1, $2, 'AD_HOC', $3, 'x', $4)`, [ids.tb, ids.risk, ids.u, ids.va]);
    expect(["42501", "23503"]).toContain(r);
    expect(await probe(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, rating_scale_id) VALUES ($1, $2, 'AD_HOC', $3, 'x', $4)`, [ids.ta, ids.risk, ids.u, ids.sb])).toBe("42501");
    // composite FK alone, behind the guard: user trigger off on this table for this probe only (takes a table lock:
    // run this file alone or with --no-file-parallelism against the same database).
    await c.query("ALTER TABLE risk_evaluations DISABLE TRIGGER risk_evaluations_snapshot_insert_guard");
    try {
      expect(await probe(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, rating_scale_id) VALUES ($1, $2, 'AD_HOC', $3, 'x', $4)`, [ids.ta, ids.risk, ids.u, ids.sb])).toBe("23503");
    } finally { await c.query("ALTER TABLE risk_evaluations ENABLE TRIGGER risk_evaluations_snapshot_insert_guard"); }
    await c.query("RELEASE SAVEPOINT x");
  });
  it("rating_scale_version is frozen once set; NULL -> value stays allowed", async () => {
    const ev = await one(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category) VALUES ($1, $2, 'AD_HOC', $3, 'x') RETURNING id`, [ids.ta, ids.risk, ids.u]);
    expect(await probe(`UPDATE risk_evaluations SET rating_scale_id = $2, rating_scale_version = '3' WHERE id = $1`, [ev, ids.s1])).toBe("OK");
    expect(await probe(`UPDATE risk_evaluations SET rating_scale_version = '4' WHERE id = $1`, [ev])).toBe("42501");
    expect(await probe(`UPDATE risk_evaluations SET rating_scale_version = NULL WHERE id = $1`, [ev])).toBe("42501");
    expect(await probe(`UPDATE risk_evaluations SET rating_scale_version = '3', comment = 'c' WHERE id = $1`, [ev])).toBe("OK");
  });
  it("risk_categories parent must be in the same tenant (composite FK, 23503); same-tenant parent OK", async () => {
    const parent = await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1, 'p') RETURNING id`, [ids.ta]);
    expect(await probe(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1, 'c', $2)`, [ids.ta, parent])).toBe("OK");
    expect(await probe(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1, 'c', $2)`, [ids.tb, parent])).toBe("23503");
  });
});
