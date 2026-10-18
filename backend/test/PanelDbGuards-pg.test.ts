import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * SEC-PNL-06 / F-PNL-07 / CMP-PNL-10: database guards of migrations 068 to 071 on a REAL PostgreSQL 16 (disposable, local
 * unix socket). Skipped unless QA_SWP_PGHOST is a unix socket DIRECTORY (port QA_SWP_PGPORT, db QA_SWP_PGDB, user postgres).
 * Needs migrations 001..071 and the role grc_app_runtime. One transaction rolled back; each probe in a savepoint.
 * Probes marked "runtime" run under SET LOCAL ROLE grc_app_runtime.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("068-071 database guards (tenant-bound users, designations, profile insert, regime)", () => {
  let pool: Pool;
  let c: PoolClient;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  async function probe(sql: string, p: unknown[] = [], runtime = false): Promise<string> {
    await c.query("SAVEPOINT p");
    try {
      if (runtime) await c.query("SET LOCAL ROLE grc_app_runtime");
      await c.query(sql, p);
      if (runtime) await c.query("RESET ROLE");
      await c.query("RELEASE SAVEPOINT p");
      return "OK";
    } catch (e) { await c.query("ROLLBACK TO SAVEPOINT p"); return (e as { code: string }).code; }
  }

  let n = 0;
  async function world() {
    n += 1;
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`pnl-${n}`]);
    const user = (tag: string, tenant = t) =>
      one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [tenant, `${tag}${n}-${Math.random()}@pnl`]);
    const [admin, other] = [await user("admin"), await user("other")] as [string, string];
    const t2 = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`pnl-x-${n}`]);
    const foreign = await user("foreign", t2);
    return { t, t2, admin, other, foreign, user };
  }

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  describe("070 governance_designations", () => {
    const insert = `INSERT INTO governance_designations (tenant_id, kind, user_id, reason, valid_until, designated_by)
                    VALUES ($1, $2, $3, 'r', $4, $5) RETURNING id`;
    const future = "2100-01-01T00:00:00Z";

    it("refuses DELETE and TRUNCATE, to the runtime role (privilege) and to the owner (trigger)", async () => {
      const w = await world();
      const id = await one(insert, [w.t, "MANAGER", w.other, null, w.admin]);
      expect(await probe(`DELETE FROM governance_designations WHERE id = $1`, [id], true)).toBe("42501");
      expect(await probe(`TRUNCATE governance_designations`, [], true)).toBe("42501");
      expect(await probe(`DELETE FROM governance_designations WHERE id = $1`, [id])).toBe("42501");
      expect(await probe(`TRUNCATE governance_designations`)).toBe("42501");
    });
    it("refuses a user of another tenant as designee, designator or ender (composite FK)", async () => {
      const w = await world();
      expect(await probe(insert, [w.t, "MANAGER", w.foreign, null, w.admin])).toBe("23503");
      expect(await probe(insert, [w.t, "MANAGER", w.other, null, w.foreign])).toBe("23503");
      const id = await one(insert, [w.t, "MANAGER", w.other, null, w.admin]);
      expect(await probe(`UPDATE governance_designations SET ended_at = now(), ended_by = $2, end_reason = 'x' WHERE id = $1`, [id, w.foreign])).toBe("23503");
    });
    it("content is immutable (kind, user, reason, valid_until, designator, creation date)", async () => {
      const w = await world();
      const id = await one(insert, [w.t, "RISK_MANAGER_INTERIM", w.other, future, w.admin]);
      for (const set of ["reason = 'y'", "valid_until = valid_until + interval '1 year'", `user_id = '${w.admin}'`,
        `designated_by = '${w.other}'`, "created_at = now() + interval '1 day'", "kind = 'MANAGER'"]) {
        expect(await probe(`UPDATE governance_designations SET ${set} WHERE id = $1`, [id])).toBe("42501");
      }
    });
    it("an interim is used once and cannot be re-armed; activation needs both columns, an active unexpired interim", async () => {
      const w = await world();
      const id = await one(insert, [w.t, "RISK_MANAGER_INTERIM", w.other, future, w.admin]);
      expect(await probe(`UPDATE governance_designations SET activated_at = now() WHERE id = $1`, [id])).toBe("23514");
      expect(await probe(`UPDATE governance_designations SET activated_at = now(), activated_ref = gen_random_uuid() WHERE id = $1`, [id], true)).toBe("OK");
      expect(await probe(`UPDATE governance_designations SET activated_at = NULL, activated_ref = NULL, valid_until = valid_until + interval '100 years' WHERE id = $1`, [id])).toBe("42501");
      expect(await probe(`UPDATE governance_designations SET activated_at = now() + interval '1 second' WHERE id = $1`, [id])).toBe("42501");
      expect(await probe(`UPDATE governance_designations SET activated_ref = gen_random_uuid() WHERE id = $1`, [id])).toBe("42501");

      const w2 = await world();
      const expired = await one(insert, [w2.t, "RISK_MANAGER_INTERIM", w2.other, "2000-01-01T00:00:00Z", w2.admin]);
      expect(await probe(`UPDATE governance_designations SET activated_at = now(), activated_ref = gen_random_uuid() WHERE id = $1`, [expired])).toBe("42501");
      const manager = await one(insert, [w2.t, "MANAGER", w2.other, null, w2.admin]);
      expect(await probe(`UPDATE governance_designations SET activated_at = now(), activated_ref = gen_random_uuid() WHERE id = $1`, [manager])).toBe("42501");
      await c.query(`UPDATE governance_designations SET ended_at = now(), ended_by = $2, end_reason = 'fin' WHERE id = $1`, [expired, w2.admin]);
      expect(await probe(`UPDATE governance_designations SET activated_at = now(), activated_ref = gen_random_uuid() WHERE id = $1`, [expired])).toBe("42501");
    });
    it("the end is set once (the application path: end then read)", async () => {
      const w = await world();
      const id = await one(insert, [w.t, "MANAGER", w.other, null, w.admin]);
      expect(await probe(`UPDATE governance_designations SET ended_at = now(), ended_by = $2, end_reason = 'fin' WHERE id = $1`, [id, w.admin], true)).toBe("OK");
      expect(await probe(`UPDATE governance_designations SET end_reason = 'autre' WHERE id = $1`, [id])).toBe("42501");
      expect(await probe(`UPDATE governance_designations SET ended_at = NULL, ended_by = NULL, end_reason = NULL WHERE id = $1`, [id])).toBe("42501");
    });
    it("every trigger function pins search_path with pg_temp last", async () => {
      const { rows } = await c.query<{ proconfig: string[] }>(
        `SELECT proconfig FROM pg_proc WHERE proname IN ('governance_designations_guard','governance_designations_truncate_guard','organization_profiles_guard','tenants_single_person_regime_guard')`);
      expect(rows).toHaveLength(4);
      for (const r of rows) expect(r.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
    });
  });

  describe("071 organization_profiles insert guard", () => {
    const ins = (cols = "") => `INSERT INTO organization_profiles (tenant_id, version, questionnaire_version, answers, reason, status, regime, submitted_by${cols})
                                VALUES ($1, $2, 'v1', '{}', 'r', $3, $4, $5`;
    it("accepts the application insert paths (PENDING, ACTIVE with no regime or ALONE)", async () => {
      const w = await world();
      expect(await probe(`${ins()})`, [w.t, 1, "ACTIVE", null, w.admin], true)).toBe("OK");
      const w2 = await world();
      expect(await probe(`${ins()})`, [w2.t, 1, "ACTIVE", "ALONE", w2.admin], true)).toBe("OK");
      expect(await probe(`${ins()})`, [w2.t, 2, "PENDING", null, w2.admin], true)).toBe("OK");
    });
    it("refuses a row born decided: ACTIVE/CONFIRMED with a forged confirmer, REJECTED, SUPERSEDED, decision columns", async () => {
      const w = await world();
      const withDecision = `${ins(", decided_by, decided_at")}, $6, now())`;
      expect(await probe(withDecision, [w.t, 1, "ACTIVE", "CONFIRMED", w.admin, w.other], true)).toBe("42501");
      expect(await probe(withDecision, [w.t, 1, "ACTIVE", "CONFIRMED", w.admin, w.foreign], true)).toBe("42501");
      expect(await probe(`${ins()})`, [w.t, 1, "ACTIVE", "CONFIRMED", w.admin])).toBe("42501");
      expect(await probe(`${ins()})`, [w.t, 1, "SUPERSEDED", null, w.admin])).toBe("42501");
      expect(await probe(`${ins(", decided_by, decided_at, decision_reason")}, $6, now(), 'x')`, [w.t, 1, "REJECTED", null, w.admin, w.other])).toBe("42501");
    });
    it("refuses a submitter or confirmer of another tenant (composite FK), the PENDING -> ACTIVE confirmation stays possible in-tenant", async () => {
      const w = await world();
      expect(await probe(`${ins()})`, [w.t, 1, "PENDING", null, w.foreign])).toBe("23503");
      const id = await one(`${ins()}) RETURNING id`, [w.t, 1, "PENDING", null, w.admin]);
      const confirm = `UPDATE organization_profiles SET status = 'ACTIVE', regime = 'CONFIRMED', decided_by = $2, decided_at = now() WHERE id = $1`;
      expect(await probe(confirm, [id, w.foreign], true)).toBe("23503");
      expect(await probe(confirm, [id, w.other], true)).toBe("OK");
    });
  });

  describe("068 single-person regime: not declarable by the runtime role", () => {
    it("runtime cannot declare, change the threshold, or create a tenant already declared; owner can", async () => {
      const w = await world();
      expect(await probe(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id = $1`, [w.t], true)).toBe("42501");
      expect(await probe(`UPDATE tenants SET single_person_regime_lift_threshold = 5 WHERE id = $1`, [w.t], true)).toBe("42501");
      expect(await probe(`INSERT INTO tenants (name, single_person_regime_declared_at) VALUES ('forged', now())`, [], true)).toBe("42501");
      expect(await probe(`INSERT INTO tenants (name) VALUES ('plain')`, [], true)).toBe("OK");
      expect(await probe(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id = $1`, [w.t])).toBe("OK");
    });
    it("the lift still works when triggered by the runtime role (second person with a role)", async () => {
      const w = await world();
      const role = await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'r', '{}') RETURNING id`, [w.t]);
      const grant = `INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`;
      await c.query(grant, [w.t, role, w.admin, w.admin]);
      await c.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id = $1`, [w.t]);
      expect(await probe(grant, [w.t, role, w.other, w.admin], true)).toBe("OK");
      const { rows } = await c.query(`SELECT single_person_regime_lifted_at AS l FROM tenants WHERE id = $1`, [w.t]);
      expect(rows[0]!.l).not.toBeNull();
    });
  });

  describe("069 process responsibilities bound to the tenant", () => {
    it("refuses an owner, champion or deputy of another tenant; accepts same-tenant and NULL", async () => {
      const w = await world();
      const ins = (col: string) => `INSERT INTO processes (tenant_id, level, name, ${col}) VALUES ($1, 'PROCESS', 'p' || random()::text, $2)`;
      for (const col of ["owner_user_id", "risk_champion_user_id", "deputy_user_id"]) {
        expect(await probe(ins(col), [w.t, w.foreign], true)).toBe("23503");
        expect(await probe(ins(col), [w.t, w.other], true)).toBe("OK");
        expect(await probe(ins(col), [w.t, null], true)).toBe("OK");
      }
      const pid = await one(`INSERT INTO processes (tenant_id, level, name) VALUES ($1, 'PROCESS', 'q') RETURNING id`, [w.t]);
      expect(await probe(`UPDATE processes SET owner_user_id = $2 WHERE id = $1`, [pid, w.foreign], true)).toBe("23503");
    });
  });
});
