import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";

/**
 * q145 / migration 065 on a REAL PostgreSQL (disposable, local unix socket). Skipped unless QA_SWP_PGHOST is a unix socket
 * DIRECTORY. Migrations 001..065 applied. One transaction rolled back.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("risk_evaluations.sub_category_id (migration 065)", () => {
  let pool: Pool; let c: PoolClient; let repo: PostgresRiskEvaluationRepository;
  const ids = {} as Record<"ta" | "tb" | "u" | "risk" | "sub" | "foreign", string>;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  const code = async (sql: string, p: unknown[] = []) => {
    await c.query("SAVEPOINT s");
    try { await c.query(sql, p); await c.query("RELEASE SAVEPOINT s"); return "OK"; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return (e as { code: string }).code; }
  };

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
    repo = new PostgresRiskEvaluationRepository(c as never);
    ids.ta = await one(`INSERT INTO tenants (name) VALUES ('q145-a') RETURNING id`);
    ids.tb = await one(`INSERT INTO tenants (name) VALUES ('q145-b') RETURNING id`);
    ids.u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, 'u@q145', 'u') RETURNING id`, [ids.ta]);
    ids.risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1, 'p', 'd') RETURNING id`, [ids.ta]);
    const root = await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1, 'Racine') RETURNING id`, [ids.ta]);
    ids.sub = await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1, 'Fraude', $2) RETURNING id`, [ids.ta, root]);
    ids.foreign = await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1, 'Autre') RETURNING id`, [ids.tb]);
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  const insert = (subId: string | null) => repo.create({
    tenantId: ids.ta, riskId: ids.risk, evaluationType: "AD_HOC", evaluatorId: ids.u, subCategory: "Fraude", subCategoryId: subId, evaluationMode: "CLASSIQUE",
  });

  it("the repository stores and reads back the id; a legacy row reads null", async () => {
    expect((await insert(ids.sub)).subCategoryId).toBe(ids.sub);
    expect((await insert(null)).subCategoryId).toBeNull();
  });
  it("a category of another tenant is refused by the composite FK", async () => {
    expect(await code(
      `INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, sub_category_id) VALUES ($1, $2, 'AD_HOC', $3, 'x', $4)`,
      [ids.ta, ids.risk, ids.u, ids.foreign],
    )).toBe("23503");
  });
  it("sub_category and sub_category_id are frozen (including NULL -> id on a legacy row)", async () => {
    const withId = (await insert(ids.sub)).id;
    const legacy = (await insert(null)).id;
    expect(await code(`UPDATE risk_evaluations SET sub_category = 'autre' WHERE id = $1`, [withId])).toBe("42501");
    expect(await code(`UPDATE risk_evaluations SET sub_category_id = NULL WHERE id = $1`, [withId])).toBe("42501");
    expect(await code(`UPDATE risk_evaluations SET sub_category_id = $2 WHERE id = $1`, [legacy, ids.sub])).toBe("42501");
  });
});
