import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { findAppetite } from "../src/domain/frameworkAppetite.js";
import { normalizeAppetite } from "../src/services/RiskFrameworkService.js";
import { PostgresRiskCategoryRepository } from "../src/infrastructure/database/postgres/PostgresRiskCategoryRepository.js";

// QA edge cases of q145 / migration 065. PG part: local database only (QA_SWP_PGHOST).
const PGHOST = process.env.QA_SWP_PGHOST ?? "";
const e = (subCategory: string, subCategoryId: string | null, threshold: number, entity: string | null = null) =>
  ({ subCategory, subCategoryId, entity, threshold, description: null });

describe("q145 matching edge cases (domain)", () => {
  it("id comparison ignores case", () => {
    expect(findAppetite([e("Fraude", "AAAA-1", 7)], "x", null, "aaaa-1")?.threshold).toBe(7);
  });
  it("evaluation with id vs a legacy entry (no id): label decides, a renamed category no longer matches it", () => {
    const legacy = [e("Fraude", null, 7)];
    expect(findAppetite(legacy, "Fraude", null, "id1")?.threshold).toBe(7);
    expect(findAppetite(legacy, "Fraude interne", null, "id1")).toBeNull();
  });
  it("evaluation with id never falls back to the label of an entry that HAS a different id", () => {
    expect(findAppetite([e("Fraude", "other", 7)], "Fraude", null, "id1")).toBeNull();
  });
  it("entity null and '' are the same key, entity mismatch never matches", () => {
    expect(findAppetite([e("F", "id1", 5, "")], "F", null, "id1")?.threshold).toBe(5);
    expect(findAppetite([e("F", "id1", 5, "BU")], "F", null, "id1")).toBeNull();
  });
  it("normalizeAppetite: the same id in different case is a duplicate", () => {
    expect(() => normalizeAppetite([e("A", "ABC", 5), e("B", "abc", 6)])).toThrow(/Duplicate/);
  });
  // INFO (not a defect today: every write since q133 carries an id): a legacy entry (no id) and an entry with id and the same label
  // are two distinct keys, so both are accepted and the first in the list wins in findAppetite.
  it("normalizeAppetite: legacy label entry + id entry with the same label coexist (documented)", () => {
    expect(normalizeAppetite([e("Fraude", null, 5), e("Fraude", "id1", 6)])).toHaveLength(2);
  });
});

describe.skipIf(!PGHOST.startsWith("/"))("migration 065 on real PostgreSQL", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 }); });
  afterAll(async () => { await pool.end(); });
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].id as string;
  const code = async (sql: string, p: unknown[] = []) => { try { await pool.query(sql, p); return "OK"; } catch (err) { return (err as { code: string }).code; } };
  async function world() {
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`q065-${Math.random()}`]);
    const u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'x') RETURNING id`, [t, `q065-${Math.random()}@x`]);
    const risk = await one(`INSERT INTO risks (tenant_id, process, description) VALUES ($1,'p','d') RETURNING id`, [t]);
    const root = await one(`INSERT INTO risk_categories (tenant_id, name) VALUES ($1,'R') RETURNING id`, [t]);
    const sub = await one(`INSERT INTO risk_categories (tenant_id, name, parent_id) VALUES ($1,'Fraude',$2) RETURNING id`, [t, root]);
    return { t, u, risk, root, sub };
  }
  const ins = (w: { t: string; risk: string; u: string }, label: string, subId: string | null) =>
    one(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, sub_category_id) VALUES ($1,$2,'AD_HOC',$3,$4,$5) RETURNING id`, [w.t, w.risk, w.u, label, subId]);

  it("rename or deactivation of the category after the evaluation does not touch or block the evaluation", async () => {
    const w = await world(); const ev = await ins(w, "Fraude", w.sub);
    expect(await code(`UPDATE risk_categories SET name='Fraude 2' WHERE id=$1`, [w.sub])).toBe("OK");
    expect(await code(`UPDATE risk_categories SET active=false WHERE id=$1`, [w.sub])).toBe("OK");
    expect(await code(`UPDATE risk_evaluations SET entity='BU' WHERE id=$1`, [ev])).toBe("OK"); // unrelated column: guard is column-scoped
    const r = (await pool.query(`SELECT sub_category, sub_category_id FROM risk_evaluations WHERE id=$1`, [ev])).rows[0];
    expect(r).toEqual({ sub_category: "Fraude", sub_category_id: w.sub });
  });
  it("physical DELETE of a referenced category is refused by the FK (no orphan id)", async () => {
    const w = await world(); await ins(w, "Fraude", w.sub);
    expect(await code(`DELETE FROM risk_categories WHERE id=$1`, [w.sub])).toMatch(/^(23503|42501)$/);
  });
  it("NOT VALID FK: a pre-existing orphan row does not block other writes, a new orphan is refused, and a no-op re-set of the same value passes the guard", async () => {
    const w = await world(); const ghost = "00000000-0000-4000-8000-000000000065";
    const c = await pool.connect(); let orphan: string;
    try {
      await c.query("SET session_replication_role = replica"); // reproduces data written without the FK check
      orphan = (await c.query(`INSERT INTO risk_evaluations (tenant_id, risk_id, evaluation_type, evaluator_id, sub_category, sub_category_id) VALUES ($1,$2,'AD_HOC',$3,'x',$4) RETURNING id`, [w.t, w.risk, w.u, ghost])).rows[0].id;
    } finally { await c.query("RESET session_replication_role"); c.release(); }
    expect(await code(`UPDATE risk_evaluations SET entity='BU' WHERE id=$1`, [orphan])).toBe("OK");
    expect(await code(`UPDATE risk_evaluations SET sub_category_id = sub_category_id WHERE id=$1`, [orphan])).toBe("OK");
    expect(await ins(w, "x", ghost).catch((err: { code: string }) => err.code)).toBe("23503");
  });
  it("uppercase UUID is resolved by the real category repository to the canonical id (what the service stores)", async () => {
    const w = await world();
    const cat = await new PostgresRiskCategoryRepository(pool).getById(w.t, w.sub.toUpperCase());
    expect(cat?.id).toBe(w.sub);
  });
  it("the guard function pins search_path (pg_temp last)", async () => {
    const { rows } = await pool.query(`SELECT proconfig FROM pg_proc WHERE proname='risk_evaluations_sub_category_guard'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });
});
