import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

// Migration 093 (q279 A, INFO-12, SEC-B13-01, rebind audit). Level 1: happy path + the guards this migration adds.
// Static part always runs; the live part needs a disposable LOCAL database with migrations up to 093:
//   MIG093_LIVE=1 MIG093_DB=<db> (host 127.0.0.1, port MIG093_PORT or 55442). Never Neon.
const sql093 = readFileSync("../database/postgresql/migrations/093_sole_rm_set_default_hardening.sql", "utf8");

describe("093 (static)", () => {
  it("pins search_path on every function it defines and keeps the guards whole", () => {
    const fns = [...sql093.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(\)[^$]*\$\$/g)].map((m) => m[0]);
    expect(fns).toHaveLength(3);
    for (const f of fns) expect(f).toMatch(/SET search_path = pg_catalog, public, pg_temp/);
    expect(sql093).toMatch(/UPDATE OF risk_framework_id, tenant_id, deleted_at ON processes/);
    expect(sql093).toMatch(/NEW\.sole_rm_at_request\)/);
    expect(sql093).toMatch(/kind IN \('ASSIGN_PROCESS', 'SET_DEFAULT'\) AND status = 'APPROVED' AND decided_by = requested_by AND sole_rm_at_request/);
  });

  it("the rebind trigger only fires from a bound identity (no duplicate of the first binding) and never copies the subject", () => {
    expect(sql093).toMatch(/WHEN \(OLD\.identity_subject IS NOT NULL/);
    const fn = sql093.slice(sql093.indexOf("FUNCTION users_identity_rebind_audit"), sql093.indexOf("DROP TRIGGER IF EXISTS users_identity_rebind_audit"));
    expect(fn).not.toMatch(/OLD\.identity_subject|NEW\.identity_subject,/);
  });
});

const live = process.env["MIG093_LIVE"] === "1" && /^grc_/.test(process.env["MIG093_DB"] ?? "");

describe.skipIf(!live)("093 on a real local database", () => {
  let pool: Pool;
  let tenant: string;
  const tag = randomUUID().slice(0, 8);
  const code = async (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "ERR");

  beforeAll(async () => {
    pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG093_PORT"] ?? 55442), user: "postgres", database: process.env["MIG093_DB"]!, max: 2 });
    tenant = (await pool.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T093-${tag}`])).rows[0].id;
  });
  afterAll(async () => { await pool?.end(); });

  const user = async (email: string): Promise<string> =>
    (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [tenant, `${email}-${tag}@x.test`])).rows[0].id;
  const rebindRows = async (id: string) =>
    (await pool.query(`SELECT user_id, old_value, new_value FROM audit_log WHERE entity_id = $1 AND request_id = 'identity-rebind' ORDER BY "timestamp", id`, [id])).rows;

  it("rebind audit: first binding writes nothing, a change and a clearing write one row each (account as actor, no subject), a no-op writes nothing", async () => {
    const u = await user("rebind");
    await pool.query(`UPDATE users SET identity_provider = 'google', identity_subject = $2 WHERE id = $1`, [u, `sub-a-${tag}`]);
    expect(await rebindRows(u)).toHaveLength(0);
    await pool.query(`UPDATE users SET identity_subject = identity_subject WHERE id = $1`, [u]);
    expect(await rebindRows(u)).toHaveLength(0);
    await pool.query(`UPDATE users SET identity_subject = $2 WHERE id = $1`, [u, `sub-b-${tag}`]);
    await pool.query(`UPDATE users SET identity_provider = NULL, identity_subject = NULL WHERE id = $1`, [u]);
    const rows = await rebindRows(u);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.user_id === u)).toBe(true);
    expect(rows[1].new_value).toEqual({ identityLinked: false, identityProvider: null });
    expect(JSON.stringify(rows)).not.toContain(`sub-`);
    // Rebinding from NULL again is the application's first-binding path: still no extra row.
    await pool.query(`UPDATE users SET identity_provider = 'google', identity_subject = $2 WHERE id = $1`, [u, `sub-c-${tag}`]);
    expect(await rebindRows(u)).toHaveLength(2);
    expect(await code(pool.query(`UPDATE audit_log SET reason = 'x' WHERE entity_id = $1`, [u]))).toBe("42501");
  });

  it("SEC-B13-01: a deleted process cannot be restored; a normal soft delete still works", async () => {
    const p = (await pool.query(`INSERT INTO processes (tenant_id, level, name) VALUES ($1, 'PROCESS', $2) RETURNING id`, [tenant, `P-${tag}`])).rows[0].id;
    await pool.query(`UPDATE processes SET deleted_at = now() WHERE id = $1`, [p]);
    expect(await code(pool.query(`UPDATE processes SET deleted_at = NULL WHERE id = $1`, [p]))).toBe("42501");
    expect(await code(pool.query(`UPDATE processes SET risk_framework_id = NULL, deleted_at = NULL WHERE id = $1`, [p]))).toBe("42501");
  });

  it("INFO-12 + q279: sole_rm_at_request is frozen on a decision; SOLE_RM needs the flag and now covers SET_DEFAULT", async () => {
    const u = await user("rm");
    // One Dispositif per request: only one PENDING request per Dispositif.
    const request = async (flag: boolean): Promise<string> => {
      const fw = (await pool.query(`INSERT INTO risk_frameworks (tenant_id, name, created_by) VALUES ($1, $2, $3) RETURNING id`, [tenant, `FW-${randomUUID()}`, u])).rows[0].id;
      return (await pool.query(
        `INSERT INTO risk_framework_change_requests (tenant_id, kind, framework_id, previous_value, reason, requested_by, sole_rm_at_request)
         VALUES ($1, 'SET_DEFAULT', $2, '{"frameworkId":null}', 'motif', $3, $4) RETURNING id`, [tenant, fw, u, flag])).rows[0].id;
    };
    const decide = (id: string, extra: string) => pool.query(
      `UPDATE risk_framework_change_requests SET status = 'APPROVED', decided_by = $2, decided_at = now(), decision_comment = 'seul',
         decision_regime = 'SOLE_RM', decider_group = 'RISK_MANAGER' ${extra} WHERE id = $1`, [id, u]);

    const notSole = await request(false);
    expect(await code(decide(notSole, ""))).toBe("23514"); // the CHECK now requires the flag
    expect(await code(decide(notSole, ", sole_rm_at_request = true"))).toBe("42501"); // and the guard freezes it
    const sole = await request(true);
    expect(await code(decide(sole, ""))).toBeNull(); // happy path: SET_DEFAULT under SOLE_RM
    const { rows } = await pool.query(`SELECT decision_regime, sole_rm_at_request FROM risk_framework_change_requests WHERE id = $1`, [sole]);
    expect(rows[0]).toEqual({ decision_regime: "SOLE_RM", sole_rm_at_request: true });
  });
});
