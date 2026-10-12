import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

/**
 * QA-B6bF on a REAL PostgreSQL 16 (disposable, local unix socket): PostgresRiskEvaluationRepository.recordInherentScoring
 * against migration 060. Skipped unless QA_FB6B02_PGHOST is a unix socket DIRECTORY (starts with "/"); never a TCP host / Neon.
 * Migrations 001..060 applied. One transaction rolled back; each repository query runs in a savepoint.
 */
const HOST = process.env.QA_FB6B02_PGHOST ?? "";
const enabled = HOST.startsWith("/");

describe.skipIf(!enabled)("recordInherentScoring vs the snapshot guard (real PostgreSQL)", () => {
  let pool: Pool; let c: PoolClient; let repo: PostgresRiskEvaluationRepository;
  const ids = {} as Record<"t" | "u" | "s1" | "s2" | "v" | "risk" | "frozen" | "legacy", string>;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  const input = (s: string) => ({ ratingScaleId: s, ratingScaleVersion: "1", probability: 2, impacts: [], impactRetained: 3, score: 6 });

  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: process.env.QA_FB6B02_PGDB ?? "grc_qa", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
    // repository over the single transaction; savepoint per query so a refused UPDATE does not abort the transaction
    const wrapped = { async query(sql: string, p?: unknown[]) {
      await c.query("SAVEPOINT q");
      try { const r = await c.query(sql, p); await c.query("RELEASE SAVEPOINT q"); return r; }
      catch (e) { await c.query("ROLLBACK TO SAVEPOINT q"); throw e; }
    } };
    repo = new PostgresRiskEvaluationRepository(wrapped as never);
    ids.t = await one(`INSERT INTO tenants (name) VALUES ('bf-a') RETURNING id`);
    ids.u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, 'u@bf', 'u') RETURNING id`, [ids.t]);
    const scale = (n: string) => one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1, $2, '1', 5, 5) RETURNING id`, [ids.t, n]);
    ids.s1 = await scale("s1"); ids.s2 = await scale("s2");
    const f = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1, 'fw') RETURNING id`, [ids.t]);
    ids.v = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1, $2, 1, $3, 15) RETURNING id`, [ids.t, f, ids.s1]);
    ids.risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1, 'p', 'd') RETURNING id`, [ids.t]);
    ids.frozen = await one(
      `INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, risk_framework_version_id, rating_scale_id, committee_evaluation_min_score, committee_evaluation_enforced)
       VALUES ($1, $2, 'AD_HOC', $3, 'x', $4, $5, 15, true) RETURNING id`, [ids.t, ids.risk, ids.u, ids.v, ids.s1]);
    ids.legacy = await one(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category) VALUES ($1, $2, 'AD_HOC', $3, 'x') RETURNING id`, [ids.t, ids.risk, ids.u]);
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("same scale on a frozen evaluation: accepted (re-scoring the inherent risk keeps working)", async () => {
    const e = await repo.recordInherentScoring(ids.t, ids.frozen, input(ids.s1));
    expect(e.ratingScaleId).toBe(ids.s1);
    expect(e.inherentScore).toBe(6);
  });
  it("different scale on a frozen evaluation: ValidationError (400), row unchanged", async () => {
    await expect(repo.recordInherentScoring(ids.t, ids.frozen, input(ids.s2))).rejects.toThrow(ValidationError);
    expect((await repo.getById(ids.t, ids.frozen))?.ratingScaleId).toBe(ids.s1);
  });
  it("legacy evaluation (NULL scale): first scoring sets it, a different scale afterwards is refused", async () => {
    expect((await repo.recordInherentScoring(ids.t, ids.legacy, input(ids.s2))).ratingScaleId).toBe(ids.s2);
    await expect(repo.recordInherentScoring(ids.t, ids.legacy, input(ids.s1))).rejects.toThrow(ValidationError);
  });
  it("another tenant's id: NotFound, nothing updated", async () => {
    await expect(repo.recordInherentScoring("00000000-0000-4000-8000-000000000000", ids.frozen, input(ids.s1))).rejects.toThrow(NotFoundError);
  });
  it("QA-B6bF-02 fixed: a real missing-privilege 42501 is not reported as 'frozen'", async () => {
    await c.query("SAVEPOINT r");
    await c.query("CREATE ROLE qa_b6bf_ro NOLOGIN");
    await c.query("GRANT SELECT ON risk_evaluations TO qa_b6bf_ro");
    await c.query("SET LOCAL ROLE qa_b6bf_ro");
    let err: unknown;
    try { await repo.recordInherentScoring(ids.t, ids.frozen, input(ids.s1)); } catch (e) { err = e; }
    await c.query("RESET ROLE");
    await c.query("ROLLBACK TO SAVEPOINT r");
    expect(err).not.toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/permission denied/);
  });
});
