import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-D046 / F-D044-03 on a REAL PostgreSQL 16 (disposable, unix socket directory in QA_D044_PGHOST, db QA_D044_PGDB=grc_qa):
 * every RatingScaleService write inserts its audit row in the same transaction; a failing audit insert rolls the write back.
 * Skipped otherwise. Prerequisite: migrations 001..058 applied.
 */
const HOST = process.env.QA_D044_PGHOST ?? "";
const DB = process.env.QA_D044_PGDB ?? "grc_qa";
const lv = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const PERMS = ["ratingscale.read", "ratingscale.create", "ratingscale.update", "ratingscale.delete"];

describe.skipIf(!HOST.startsWith("/"))("QA-D046 F-D044-03 RatingScale audit in the transaction (real PostgreSQL)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: DB, max: 6, application_name: "qa-d046-own" });
    await pool.query(`CREATE TABLE IF NOT EXISTS qa_d046_fail_audit (tenant_id uuid, entity_type text)`);
    await pool.query(`CREATE OR REPLACE FUNCTION qa_d046_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM qa_d046_fail_audit q WHERE q.tenant_id = NEW.tenant_id AND (q.entity_type IS NULL OR q.entity_type = NEW.entity_type))
        THEN RAISE EXCEPTION 'qa: audit insert refused'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`DROP TRIGGER IF EXISTS qa_d046_fail_audit_trg ON audit_log`);
    await pool.query(`CREATE TRIGGER qa_d046_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_d046_fail_audit_fn()`);
  });
  afterAll(async () => {
    await pool?.query(`DROP TRIGGER IF EXISTS qa_d046_fail_audit_trg ON audit_log`);
    await pool?.query(`DROP FUNCTION IF EXISTS qa_d046_fail_audit_fn()`);
    await pool?.query(`DROP TABLE IF EXISTS qa_d046_fail_audit`);
    await pool?.end();
  });

  async function world() {
    const t = (await pool.query<{ id: string }>(`INSERT INTO tenants (name) VALUES ('qa-d046') RETURNING id`)).rows[0]!.id;
    const u = (await pool.query<{ id: string }>(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'u') RETURNING id`, [t, `u-${t}@x`])).rows[0]!.id;
    const svc = new RatingScaleService(new PostgresRatingScaleRepository(pool), new PostgresAuditRepository(pool), { existsForRatingScale: async () => false });
    const actor = { userId: u, tenantId: t, email: "u@x", displayName: "u", roles: PERMS } as unknown as AuthenticatedUser;
    let n = 0;
    const create = (labels = false) => svc.create(actor, { name: "S", version: `v${++n}-${Math.random()}`, probabilityLevels: 3, impactLevels: 3,
      ...(labels ? { probabilityLabels: lv(3), impactLabels: lv(3) } : {}) }, "r-c");
    const fail = (entityType: string | null = null) => pool.query(`INSERT INTO qa_d046_fail_audit VALUES ($1, $2)`, [t, entityType]);
    const heal = () => pool.query(`DELETE FROM qa_d046_fail_audit WHERE tenant_id = $1`, [t]);
    const audits = async () => (await pool.query<{ a: string }>(`SELECT action AS a FROM audit_log WHERE tenant_id = $1 AND entity_type = 'RatingScale' ORDER BY timestamp`, [t])).rows.map((r) => r.a);
    const row = async (id: string) => (await pool.query(`SELECT * FROM rating_scales WHERE id = $1`, [id])).rows[0];
    return { t, svc, actor, create, fail, heal, audits, row };
  }

  const writes: Array<[string, string, (w: Awaited<ReturnType<typeof world>>, id: string) => Promise<unknown>, string]> = [
    ["updateThresholds", "criticality_thresholds", (w, id) => w.svc.updateThresholds(w.actor, id, { thresholds: [{ label: "Low", min: 1, max: 4 }] }, "r"), "UPDATE"],
    ["updateImpactAxes", "impact_axes", (w, id) => w.svc.updateImpactAxes(w.actor, id, { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: lv(3) }] }, "r"), "UPDATE"],
    ["updateVelocity", "velocity_levels", (w, id) => w.svc.updateVelocity(w.actor, id, { levels: lv(3) }, "r"), "UPDATE"],
    ["updatePersistence", "persistence_levels", (w, id) => w.svc.updatePersistence(w.actor, id, { levels: lv(3) }, "r"), "UPDATE"],
    ["updateMastery", "mastery_scale", (w, id) => w.svc.updateMastery(w.actor, id, { levels: lv(3), defenseLines: ["L1", "L2", "L3"] }, "r"), "UPDATE"],
  ];

  for (const [name, column, run, action] of writes) {
    it(`${name}: audit failure rolls the column back; success commits write + one audit row together`, async () => {
      const w = await world();
      const s = await w.create();
      const before = (await w.row(s.id))[column];
      const auditsBefore = await w.audits();
      await w.fail();
      await expect(run(w, s.id)).rejects.toThrow(/audit insert refused/);
      expect((await w.row(s.id))[column]).toEqual(before);
      expect(await w.audits()).toEqual(auditsBefore);
      await w.heal();
      await run(w, s.id);
      expect((await w.row(s.id))[column]).not.toEqual(before);
      expect(await w.audits()).toEqual([...auditsBefore, action]);
    });
  }

  it("create: audit failure leaves no scale (INSERT rolled back)", async () => {
    const w = await world();
    await w.fail();
    await expect(w.create()).rejects.toThrow(/audit insert refused/);
    expect(Number((await pool.query(`SELECT count(*) AS n FROM rating_scales WHERE tenant_id = $1`, [w.t])).rows[0].n)).toBe(0);
    await w.heal();
    const s = await w.create();
    expect(await w.audits()).toEqual(["CREATE"]);
    expect((await w.row(s.id)).status).toBe("DRAFT");
  });

  it("activate: audit failure leaves the new scale DRAFT and the previous ACTIVE scale ACTIVE", async () => {
    const w = await world();
    const a = await w.create(true);
    await w.svc.activateVersion(w.actor, a.id, "r");
    const b = await w.create(true);
    await w.fail();
    await expect(w.svc.activateVersion(w.actor, b.id, "r")).rejects.toThrow(/audit insert refused/);
    expect((await w.row(a.id)).status).toBe("ACTIVE");
    expect((await w.row(a.id)).archived_at).toBeNull();
    expect((await w.row(b.id)).status).toBe("DRAFT");
    await w.heal();
    await w.svc.activateVersion(w.actor, b.id, "r");
    expect((await w.row(a.id)).status).toBe("ARCHIVED");
    expect((await w.row(b.id)).status).toBe("ACTIVE");
    expect(await w.audits()).toEqual(["CREATE", "STATUS_CHANGE", "CREATE", "STATUS_CHANGE"]);
  });

  it("disable (soft delete): audit failure keeps the scale undeleted; success sets deleted_at + DELETE audit", async () => {
    const w = await world();
    const s = await w.create();
    await w.fail();
    await expect(w.svc.disable(w.actor, s.id, "why", "r")).rejects.toThrow(/audit insert refused/);
    expect((await w.row(s.id)).deleted_at).toBeNull();
    await w.heal();
    await w.svc.disable(w.actor, s.id, "why", "r");
    expect((await w.row(s.id)).deleted_at).not.toBeNull();
    expect(await w.audits()).toEqual(["CREATE", "DELETE"]);
  });

  it("non-DRAFT update refused inside the transaction: no audit row, pool not left in a transaction", async () => {
    const w = await world();
    const s = await w.create(true);
    await w.svc.activateVersion(w.actor, s.id, "r");
    const auditsBefore = await w.audits();
    await expect(w.svc.updateVelocity(w.actor, s.id, { levels: lv(3) }, "r")).rejects.toThrow(/active rating scale/);
    expect(await w.audits()).toEqual(auditsBefore);
    expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND application_name = 'qa-d046-own' AND state = 'idle in transaction'`, [DB])).rowCount).toBe(0);
  });

  it("audit failure only for another entity type does not block the write", async () => {
    const w = await world();
    await w.fail("SomethingElse");
    const s = await w.create();
    expect(await w.audits()).toEqual(["CREATE"]);
    expect(s.id).toBeTruthy();
  });
});
