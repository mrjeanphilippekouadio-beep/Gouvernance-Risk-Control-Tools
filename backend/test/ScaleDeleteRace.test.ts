import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";

// P2 Codex PR #186: scale soft-delete vs. a concurrent Dispositif draft that references it.
// Real PostgreSQL only (dedicated local database, never Neon). Applies migration 063 (idempotent) first.
const PGHOST = process.env.QA_SWP_PGHOST ?? "";
const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations/063_rating_scale_delete_race.sql");

describe.skipIf(!PGHOST.startsWith("/"))("scale soft-delete is atomic with draft references (migration 063)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 4 });
    if (process.env.QA_SKIP_063 !== "1") await pool.query(readFileSync(MIGRATION, "utf8"));
  });
  afterAll(async () => { await pool.end(); });

  async function seed() {
    const tenant = (await pool.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`scalerace-${Date.now()}-${Math.random()}`])).rows[0].id as string;
    const scale = (await pool.query(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1,'s','1',4,4) RETURNING id`, [tenant])).rows[0].id as string;
    const fw = (await pool.query(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1,'f') RETURNING id`, [tenant])).rows[0].id as string;
    const user = (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'x') RETURNING id`, [tenant, `scalerace-${Math.random()}@x`])).rows[0].id as string;
    return { tenant, scale, fw, user };
  }
  const insertDraft = (c: Pool | PoolClient, s: { tenant: string; scale: string; fw: string }) =>
    c.query(
      `INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, status, rating_scale_id, committee_evaluation_min_score)
       VALUES ($1,$2,1,'DRAFT',$3,10)`,
      [s.tenant, s.fw, s.scale],
    );
  const danglingDrafts = async (s: { tenant: string; scale: string }) =>
    (await pool.query(
      `SELECT count(*)::int AS n FROM risk_framework_versions v JOIN rating_scales r ON r.id = v.rating_scale_id
       WHERE v.tenant_id = $1 AND r.deleted_at IS NOT NULL`, [s.tenant])).rows[0].n as number;

  it("draft insert still uncommitted when the soft delete runs: the delete is refused, no dangling draft", async () => {
    const s = await seed();
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await insertDraft(writer, s); // the author passed getById and holds the draft, not yet committed
      const repo = new PostgresRatingScaleRepository(pool);
      // the disable check ran before the draft was visible: it now goes straight to softDelete
      const del = repo.softDelete(s.tenant, s.scale, s.user, "race").then(() => "deleted", (e: Error) => `refused: ${e.message}`);
      await new Promise((r) => setTimeout(r, 300));
      await writer.query("COMMIT");
      expect(await del).toMatch(/^refused/);
    } finally { writer.release(); }
    expect(await danglingDrafts(s)).toBe(0);
  });

  it("soft delete committed first: a later draft insert referencing the scale is refused", async () => {
    const s = await seed();
    await pool.query(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [s.scale]);
    await expect(insertDraft(pool, s)).rejects.toThrow(/does not exist or was disabled/);
    expect(await danglingDrafts(s)).toBe(0);
  });

  it("soft delete in flight (uncommitted) while a draft is inserted: the draft waits then is refused", async () => {
    const s = await seed();
    const deleter = await pool.connect();
    try {
      await deleter.query("BEGIN");
      await deleter.query(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [s.scale]);
      const ins = insertDraft(pool, s).then(() => "inserted", (e: Error) => `refused: ${e.message}`);
      await new Promise((r) => setTimeout(r, 300));
      await deleter.query("COMMIT");
      expect(await ins).toMatch(/^refused/);
    } finally { deleter.release(); }
    expect(await danglingDrafts(s)).toBe(0);
  });

  it("unreferenced scale can still be soft-deleted; a live scale accepts a draft (no regression)", async () => {
    const a = await seed();
    await insertDraft(pool, a);
    const b = await seed();
    const r = await pool.query(`UPDATE rating_scales SET deleted_at = now() WHERE id = $1`, [b.scale]);
    expect(r.rowCount).toBe(1);
  });
});
