import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

/**
 * Migration 062 on a REAL PostgreSQL 16 (disposable, local unix socket). Skipped unless QA_FB6B02_PGHOST is a unix
 * socket DIRECTORY. Database: QA_FB6B02_PGDB (default grc_qa), user postgres. Needs migrations 001..062.
 * One transaction rolled back; each probe in a savepoint.
 */
const HOST = process.env.QA_FB6B02_PGHOST ?? "";
const enabled = HOST.startsWith("/");

describe.skipIf(!enabled)("062 bootstrap end marker and activation guard on real PostgreSQL", () => {
  let pool: Pool;
  let c: PoolClient;
  const one = async (sql: string, p: unknown[] = []) => (await c.query<{ id: string }>(sql, p)).rows[0]!.id;
  async function probe(sql: string, p: unknown[] = []): Promise<string> {
    await c.query("SAVEPOINT p");
    try { await c.query(sql, p); await c.query("RELEASE SAVEPOINT p"); return "OK"; }
    catch (e) { await c.query("ROLLBACK TO SAVEPOINT p"); return (e as { code: string }).code; }
  }
  const ended = async (t: string) => (await c.query<{ e: Date | null }>(`SELECT risk_framework_bootstrap_ended_at AS e FROM tenants WHERE id = $1`, [t])).rows[0]!.e;

  interface World { t: string; admin: string; rm: string; roles: Record<"RISK_MANAGER" | "RISK_COMMITTEE" | "AUDIT", string> }
  let n = 0;
  async function world(): Promise<World> {
    n += 1;
    const t = await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`b6d-${n}`]);
    const user = (tag: string) => one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `${tag}${n}@b6d`]);
    const admin = await user("admin");
    const roles = {} as World["roles"];
    for (const g of ["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"] as const) {
      roles[g] = await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, '{}', $3) RETURNING id`, [t, `${g}-${n}`, g]);
    }
    const w = { t, admin, rm: "", roles };
    w.rm = await user("rm");
    await grant(w, "RISK_MANAGER", w.rm);
    return w;
  }
  const grant = (w: World, g: keyof World["roles"], u: string) =>
    one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4) RETURNING id`, [w.t, w.roles[g], u, w.admin]);
  const newUser = (w: World, tag: string) => one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [w.t, `${tag}${Math.random()}@b6d`]);

  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: process.env.QA_FB6B02_PGDB ?? "grc_qa", max: 1 });
    c = await pool.connect();
    await c.query("BEGIN");
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  it("a single Risk Manager leaves the bootstrap open; one Committee and one Audit member too", async () => {
    const w = await world();
    await grant(w, "RISK_COMMITTEE", await newUser(w, "cm"));
    await grant(w, "AUDIT", await newUser(w, "au"));
    expect(await ended(w.t)).toBeNull();
  });
  it("a second Risk Manager, a second Audit member or a second Committee member ends it", async () => {
    for (const g of ["RISK_MANAGER", "AUDIT", "RISK_COMMITTEE"] as const) {
      const w = await world();
      if (g !== "RISK_MANAGER") await grant(w, g, await newUser(w, "first"));
      expect(await ended(w.t)).toBeNull();
      await grant(w, g, await newUser(w, "second"));
      expect(await ended(w.t)).not.toBeNull();
    }
  });
  it("revoking the second member afterwards keeps the marker (q102); the marker cannot be changed (42501)", async () => {
    const w = await world();
    const second = await newUser(w, "second");
    const ur = await grant(w, "RISK_MANAGER", second);
    const at = await ended(w.t);
    expect(at).not.toBeNull();
    await c.query(`UPDATE user_roles SET revoked_at = now() WHERE id = $1`, [ur]);
    expect(await ended(w.t)).toEqual(at);
    expect(await probe(`UPDATE tenants SET risk_framework_bootstrap_ended_at = NULL WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET risk_framework_bootstrap_ended_at = now() + interval '1 day' WHERE id = $1`, [w.t])).toBe("42501");
    expect(await probe(`UPDATE tenants SET name = 'renamed' WHERE id = $1`, [w.t])).toBe("OK");
  });
  it("reactivating a suspended user who makes Audit reach 2 ends it", async () => {
    const w2 = await world();
    const susp2 = await newUser(w2, "susp");
    await c.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [susp2]);
    await grant(w2, "AUDIT", await newUser(w2, "first"));
    await grant(w2, "AUDIT", susp2);
    expect(await ended(w2.t)).toBeNull();
    await c.query(`UPDATE users SET deleted_at = NULL WHERE id = $1`, [susp2]);
    expect(await ended(w2.t)).not.toBeNull();
  });

  async function request(w: World, over: { selfDecided?: boolean } = {}) {
    const fw = await one(`INSERT INTO risk_frameworks (tenant_id, name) VALUES ($1, $2) RETURNING id`, [w.t, `fw-${Math.random()}`]);
    const scale = await one(`INSERT INTO rating_scales (tenant_id, name, version, probability_levels, impact_levels) VALUES ($1, 's', '1', 5, 5) RETURNING id`, [w.t]);
    const v = await one(`INSERT INTO risk_framework_versions (tenant_id, framework_id, version_number, rating_scale_id, committee_evaluation_min_score) VALUES ($1, $2, 1, $3, 15) RETURNING id`, [w.t, fw, scale]);
    await c.query(`UPDATE risk_framework_versions SET status = 'PENDING_APPROVAL' WHERE id = $1`, [v]);
    const r = await one(`INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, version_id, reason, requested_by) VALUES ($1, 'ACTIVATE_VERSION', $2, $3, 'r', $4) RETURNING id`, [w.t, fw, v, w.rm]);
    void over;
    return { fw, v, r };
  }
  const decideBootstrap = (r: string, rm: string) => probe(
    `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'ok',
       decision_regime = 'BOOTSTRAP', decider_group = 'RISK_MANAGER', bootstrap_justification = '{"outcome":"x"}'::jsonb WHERE id = $1`, [r, rm]);
  const activate = (v: string, r: string) => probe(`UPDATE risk_framework_versions SET status = 'ACTIVE', activated_at = now(), activation_request_id = $2 WHERE id = $1`, [v, r]);

  it("BOOTSTRAP activation: accepted for the first Dispositif of the tenant while the bootstrap is open", async () => {
    const w = await world();
    const q = await request(w);
    expect(await decideBootstrap(q.r, w.rm)).toBe("OK");
    expect(await activate(q.v, q.r)).toBe("OK");
  });
  it("BOOTSTRAP activation: refused once the end is marked, and for a second activation of the tenant", async () => {
    const ended1 = await world();
    const q1 = await request(ended1);
    await decideBootstrap(q1.r, ended1.rm);
    await grant(ended1, "AUDIT", await newUser(ended1, "a1"));
    await grant(ended1, "AUDIT", await newUser(ended1, "a2")); // ends the bootstrap
    expect(await activate(q1.v, q1.r)).toBe("42501");

    const w = await world();
    const first = await request(w);
    await decideBootstrap(first.r, w.rm);
    expect(await activate(first.v, first.r)).toBe("OK");
    const second = await request(w);
    await decideBootstrap(second.r, w.rm);
    expect(await activate(second.v, second.r)).toBe("42501");
  });
  it("BOOTSTRAP shape: justification mandatory, ratification refused, fallback_cause needs a pending FALLBACK", async () => {
    const w = await world();
    const q = await request(w);
    expect(await probe(
      `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'ok',
         decision_regime = 'BOOTSTRAP', decider_group = 'RISK_MANAGER' WHERE id = $1`, [q.r, w.rm])).toBe("23514");
    expect(await probe(
      `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'ok',
         decision_regime = 'BOOTSTRAP', decider_group = 'RISK_MANAGER', ratification_status = 'PENDING',
         bootstrap_justification = '{}'::jsonb WHERE id = $1`, [q.r, w.rm])).toBe("23514");
    expect(await probe(
      `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'ok',
         decision_regime = 'NORMAL', decider_group = 'RISK_MANAGER', fallback_cause = 'LEGACY_APPROVER_PRE_B12' WHERE id = $1`, [q.r, w.admin])).toBe("23514");
    expect(await probe(
      `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'ok',
         decision_regime = 'FALLBACK', decider_group = 'RISK_MANAGER', ratification_status = 'PENDING',
         fallback_cause = 'LEGACY_APPROVER_PRE_B12' WHERE id = $1`, [q.r, w.admin])).toBe("OK");
  });
});
