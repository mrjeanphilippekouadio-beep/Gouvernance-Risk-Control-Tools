import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

// QA edge cases of migration 063 (real PostgreSQL, local database only). Complements ScaleDeleteRace.test.ts.
const PGHOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!PGHOST.startsWith("/"))("migration 063 edge cases", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 }); });
  afterAll(async () => { await pool.end(); });

  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0].id as string;
  const code = async (sql: string, p: unknown[] = []) => { try { await pool.query(sql, p); return "OK"; } catch (e) { return (e as { code: string }).code; } };
  async function world() {
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`q063-${Math.random()}`]);
    const scale = await one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1,'s','1',4,4) RETURNING id`, [t]);
    const fw = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1,'f') RETURNING id`, [t]);
    return { t, scale, fw };
  }
  const draft = (w: { t: string; fw: string }, scale: string, n = 1) =>
    code(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1,$2,$3,$4,10)`, [w.t, w.fw, n, scale]);

  it("a version cannot reference another tenant's scale (insert and update of rating_scale_id): 23514", async () => {
    const a = await world(); const b = await world();
    expect(await draft(a, b.scale)).toBe("23514");
    expect(await draft(a, a.scale)).toBe("OK");
    expect(await code(`UPDATE risk_framework_versions SET rating_scale_id = $1 WHERE tenant_id = $2`, [b.scale, a.t])).toBe("23514");
  });

  it("a scale referenced by a non-DRAFT (activated then ARCHIVED) version cannot be soft-deleted: 23503 (not only drafts)", async () => {
    const w = await world();
    expect(await draft(w, w.scale)).toBe("OK");
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica"); // test-only shortcut to reach ARCHIVED, session-local
      await c.query(`UPDATE risk_framework_versions SET status = 'ARCHIVED', archived_at = now(), activated_at = now() WHERE tenant_id = $1`, [w.t]);
    } finally { await c.query("RESET session_replication_role"); c.release(); }
    expect(await code(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [w.scale])).toBe("23503");
  });

  it("legacy staging row (version already on a deleted scale): later writes unrelated to the scale still work, a new reference is refused", async () => {
    const w = await world();
    expect(await draft(w, w.scale)).toBe("OK");
    const c = await pool.connect();
    try {
      await c.query("SET session_replication_role = replica"); // reproduces data written before 063 (guards skipped)
      await c.query(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [w.scale]);
    } finally { await c.query("RESET session_replication_role"); c.release(); }
    expect(await code(`UPDATE risk_framework_versions SET committee_evaluation_min_score = 11 WHERE tenant_id = $1`, [w.t])).toBe("OK");
    expect(await code(`UPDATE risk_framework_versions SET rating_scale_id = rating_scale_id WHERE tenant_id = $1`, [w.t])).toBe("OK"); // unchanged value, no check
    expect(await code(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [w.scale])).toBe("OK"); // already deleted: guard only fires on NULL -> value
    const fw2 = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1,'f2') RETURNING id`, [w.t]);
    expect(await draft({ t: w.t, fw: fw2 }, w.scale)).toBe("23514"); // a new draft on the dead scale is refused
  });

  it("PostgresRatingScaleRepository.softDelete turns the trigger's 23503 into a ValidationError (not a raw pg error / 500), scale stays alive", async () => {
    const w = await world();
    const u = await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'x') RETURNING id`, [w.t, `q063-${Math.random()}@x`]);
    expect(await draft(w, w.scale)).toBe("OK");
    const err = await new PostgresRatingScaleRepository(pool).softDelete(w.t, w.scale, u, "r").then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((await pool.query(`SELECT deleted_at FROM rating_scales WHERE id = $1`, [w.scale])).rows[0].deleted_at).toBeNull();
  });

  it("both trigger functions pin search_path (pg_temp last)", async () => {
    const { rows } = await pool.query(`SELECT proname, proconfig FROM pg_proc WHERE proname IN ('risk_framework_versions_scale_alive','rating_scales_delete_guard')`);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });
});
