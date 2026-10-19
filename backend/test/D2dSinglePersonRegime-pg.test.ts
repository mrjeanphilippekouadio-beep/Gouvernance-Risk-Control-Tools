import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * Migration 068 (D2d, single-person regime) on a REAL PostgreSQL 16 (disposable, local unix socket). Skipped unless
 * QA_SWP_PGHOST is a unix socket DIRECTORY (port QA_SWP_PGPORT, db QA_SWP_PGDB, user postgres). Needs migrations 001..068.
 * One transaction rolled back; each probe in a savepoint.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("068 single-person regime columns, lift trigger and set-once guard", () => {
  let pool: Pool;
  let c: PoolClient;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  async function probe(sql: string, p: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT p");
    try { await c.query(sql, p); await c.query("RELEASE SAVEPOINT p"); return "OK"; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT p"); return (e as { code: string }).code; }
  }
  const row = async (t: string) => (await c.query(
    `SELECT single_person_regime_declared_at AS declared, single_person_regime_lifted_at AS lifted,
            single_person_regime_lift_ref AS ref, single_person_regime_lift_threshold AS thr FROM tenants WHERE id = $1`, [t])).rows[0]!;

  let n = 0;
  async function world(declare = true) {
    n += 1;
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`d2d-${n}`]);
    const role = await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, '{}') RETURNING id`, [t, `r-${n}`]);
    const user = (tag: string) => one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `${tag}${n}-${Math.random()}@d2d`]);
    const first = await user("first");
    const grant = (u: string) => one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [t, role, u, first]);
    await grant(first);
    if (declare) await c.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id = $1`, [t]);
    return { t, role, first, user, grant };
  }

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("defaults: not declared, not lifted, threshold 2; an undeclared tenant is never lifted", async () => {
    const w = await world(false);
    expect(await row(w.t)).toMatchObject({ declared: null, lifted: null, ref: null, thr: 2 });
    await w.grant(await w.user("second"));
    expect((await row(w.t)).lifted).toBeNull();
  });
  it("the second active person with a role lifts the regime and records the triggering row; later people change nothing", async () => {
    const w = await world();
    expect((await row(w.t)).lifted).toBeNull();
    const ur = await w.grant(await w.user("second"));
    const r = await row(w.t);
    expect(r.lifted).not.toBeNull();
    expect(r.ref).toBe(ur);
    await w.grant(await w.user("third"));
    expect((await row(w.t)).ref).toBe(ur);
  });
  it("the same person holding two roles does not lift", async () => {
    const w = await world();
    const role2 = await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'second-role', '{}') RETURNING id`, [w.t]);
    await c.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $3)`, [w.t, role2, w.first]);
    expect((await row(w.t)).lifted).toBeNull();
  });
  it("the threshold is configurable: 3 needs a third person", async () => {
    const w = await world(false);
    await c.query(`UPDATE tenants SET single_person_regime_declared_at = now(), single_person_regime_lift_threshold = 3 WHERE id = $1`, [w.t]);
    await w.grant(await w.user("second"));
    expect((await row(w.t)).lifted).toBeNull();
    await w.grant(await w.user("third"));
    expect((await row(w.t)).lifted).not.toBeNull();
  });
  it("a revoked assignment and a suspended user do not count; their reinstatement lifts", async () => {
    const w2 = await world();
    const ur2 = await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by, revoked_at) VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [w2.t, w2.role, await w2.user("second"), w2.first]);
    expect((await row(w2.t)).lifted).toBeNull();
    await c.query(`UPDATE user_roles SET revoked_at = NULL WHERE id = $1`, [ur2]);
    expect((await row(w2.t)).ref).toBe(ur2);

    const w3 = await world();
    const u3 = await w3.user("second");
    await c.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [u3]);
    await w3.grant(u3);
    expect((await row(w3.t)).lifted).toBeNull();
    await c.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [u3]);
    expect((await row(w3.t)).ref).toBe(u3);
  });
  it("a role reactivated with an active holder lifts", async () => {
    const w = await world();
    const role2 = await one(`INSERT INTO roles (tenant_id, name, permissions, deleted_at) VALUES ($1, 'dead', '{}', now()) RETURNING id`, [w.t]);
    await c.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [w.t, role2, await w.user("second"), w.first]);
    expect((await row(w.t)).lifted).toBeNull();
    await c.query(`UPDATE roles SET deleted_at = NULL WHERE id = $1`, [role2]);
    expect((await row(w.t)).ref).toBe(role2);
  });
  it("set-once guard: declaration, lift, ref and threshold are immutable once set; a lift is not undone by a revocation", async () => {
    const w = await world();
    const ur = await w.grant(await w.user("second"));
    expect(await probe(`UPDATE tenants SET single_person_regime_lifted_at = NULL, single_person_regime_lift_ref = NULL WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET single_person_regime_lift_ref = NULL WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET single_person_regime_lift_threshold = 5 WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET single_person_regime_declared_at = NULL WHERE id = $1`, [w.t])).toBe("42501");
    await c.query(`UPDATE user_roles SET revoked_at = now() WHERE id = $1`, [ur]);
    expect((await row(w.t)).lifted).not.toBeNull();
    const d = await world();
    expect(await probe(`UPDATE tenants SET single_person_regime_declared_at = now() + interval '1 day' WHERE id = $1`, [d.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET name = name || 'x' WHERE id = $1`, [d.t])).toBe("OK");
  });
  it("declaring is refused when the threshold is already reached; threshold lowered below 2 is refused", async () => {
    const w = await world(false);
    await w.grant(await w.user("second"));
    expect(await probe(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET single_person_regime_lift_threshold = 1 WHERE id = $1`, [w.t])).toBe("23514");
  });
  it("shape check: a lift without a declaration or a ref without a lift is refused", async () => {
    const w = await world(false);
    expect(await probe(`UPDATE tenants SET single_person_regime_lifted_at = now() WHERE id = $1`, [w.t])).toBe("23514");
    expect(await probe(`UPDATE tenants SET single_person_regime_lift_ref = gen_random_uuid() WHERE id = $1`, [w.t])).toBe("23514");
  });
  it("every function of 068 pins search_path with pg_temp last", async () => {
    const { rows } = await c.query<{ proname: string; proconfig: string[] | null }>(
      `SELECT proname, proconfig FROM pg_proc WHERE proname IN ('single_person_regime_people','single_person_regime_lift_mark','tenants_single_person_regime_guard')`);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.proconfig).toContain("search_path=pg_catalog, public, pg_temp");
  });
});
