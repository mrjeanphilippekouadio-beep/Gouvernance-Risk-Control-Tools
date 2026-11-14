import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client, Pool } from "pg";
import { PG_HOST, hasLocalPg } from "./migrationHarness.js";

/**
 * QA-L2b (migration 097), data-migration test on a database built at state 096 WITH inherited rows.
 * Oracle (written before running, from the header of 097 and the cadrage 8.3 I-1):
 *  - a reason cited by nominatif grants ends at max(revoked_at) only when EVERY grant citing it is revoked; one live grant keeps it NULL;
 *  - a reason of a REJECTED / REVOKED widened-view request ends at COALESCE(revoked_at, decided_at); APPROVED live and PENDING stay NULL;
 *  - a reason cited by nobody, and every opening reason (RACI, owner, group, designation), stays NULL (fail-closed);
 *  - never an end before the creation of the reason; nothing erased; replaying 097 or down/up/down changes no date;
 *  - `retention.purge` goes to the live custom roles and the accounts that already hold an administrator permission, nothing else;
 *  - the down puts the 096 guard back, drops the column and the permission, keeps the dates.
 * `it.fails` documents a CONFIRMED defect (turn it into `it` when fixed).
 * Live part: QA_SWP_PGHOST=<socket dir> QA_SWP_PGPORT=<port> (local disposable cluster, never Neon). Each scenario clones a template.
 */
const MIGRATIONS = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const file = (name: string) => readFileSync(join(MIGRATIONS, name), "utf8");
const UP = "097_visibility_reasons_retention.sql";
const DOWN = "097_visibility_reasons_retention.down.sql";
const upTo096 = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && !f.endsWith(".down.sql") && f < UP).sort((a, b) => a.localeCompare(b));

const PORT = Number(process.env["QA_SWP_PGPORT"] ?? 55442);
const tag = randomUUID().replaceAll("-", "").slice(0, 8);
const TEMPLATE = `grc_qa_l2bm_${tag}`;
const connect = (database: string, max = 1) => new Pool({ host: PG_HOST, port: PORT, user: "postgres", database, max });
const id = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TENANT = id(1);
const U = [1, 2, 3, 4, 5].map((n) => id(100 + n));
const RISK = id(500);
const D = (n: number) => `2026-0${n}-10T10:00:00Z`; // D(2) .. D(9)
const CREATED = "2026-01-05T10:00:00Z";
const reasonIds = { a1: id(601), a1b: id(602), a2: id(603), a3: id(604), a4: id(605), openRaci: id(606), openOwner: id(607), current: id(608), sq1: id(611), sd1: id(612), sq2: id(613), sd2: id(614), sv2: id(615), sq3: id(616), sq4: id(617), early: id(618) };
const SRC: Record<string, string> = { sq1: "SENSITIVE_VIEW_REQUEST", sd1: "SENSITIVE_VIEW_DECISION", sq2: "SENSITIVE_VIEW_REQUEST", sd2: "SENSITIVE_VIEW_DECISION", sv2: "SENSITIVE_VIEW_REVOCATION", sq3: "SENSITIVE_VIEW_REQUEST", sq4: "SENSITIVE_VIEW_REQUEST", openRaci: "RACI_OPENING", openOwner: "RISK_DESIGNATION_OPENING" };

const grantRow = (gid: number, resource: string, user: string, ref: string) =>
  `INSERT INTO resource_access_grants (id, tenant_id, resource_type, resource_id, user_id, granted_by, granted_at, grant_reason, grant_reason_ref, expires_at)
   VALUES ('${id(gid)}', '${TENANT}', 'RISK', '${resource}', '${user}', '${U[0]}', '${CREATED}', NULL, '${ref}', now() + interval '10 days')`;
const revokeRow = (gid: number, at: string, ref: string) =>
  `UPDATE resource_access_grants SET revoked_at = '${at}', revoked_by = '${U[0]}', revoke_reason_ref = '${ref}' WHERE id = '${id(gid)}'`;

/** Rows as 096 left them: motifs by reference, effect_ended_at NULL everywhere. created_at is back-dated (guard off for the seed only). */
const SEED = [
  `INSERT INTO tenants (id, name) VALUES ('${TENANT}', 'QA L2b')`,
  ...U.map((u, i) => `INSERT INTO users (id, tenant_id, email, display_name) VALUES ('${u}', '${TENANT}', 'u${i}@l2b.test', 'U${i}')`),
  `INSERT INTO risks (id, tenant_id, process, description, visibility) VALUES ('${RISK}', '${TENANT}', 'p', 'Risque', 'NOMINATIF')`,
  `ALTER TABLE visibility_reasons DISABLE TRIGGER visibility_reasons_guard`,
  ...Object.entries(reasonIds).map(([k, v]) => `INSERT INTO visibility_reasons (id, tenant_id, source, text, created_at) VALUES ('${v}', '${TENANT}', '${SRC[k] ?? "VISIBILITY_CHANGE"}', 'Motif ${k}', '${k === "early" ? "2026-09-30T10:00:00Z" : CREATED}')`),
  `ALTER TABLE visibility_reasons ENABLE TRIGGER visibility_reasons_guard`,
  // N1: one grant, revoked: a1 (grant reason) and a1b (revoke reason) both end at D(3)
  grantRow(901, RISK, U[1], reasonIds.a1), revokeRow(901, D(3), reasonIds.a1b),
  // N2: a2 cited by a revoked grant AND a live one: stays NULL
  grantRow(902, RISK, U[2], reasonIds.a2), revokeRow(902, D(4), reasonIds.a1b),
  grantRow(903, RISK, U[3], reasonIds.a2),
  // N3: a3 cited by two grants revoked at D(5) and D(6): ends at D(6) (the latest)
  grantRow(904, RISK, U[1], reasonIds.a3), revokeRow(904, D(5), reasonIds.a1b),
  grantRow(905, RISK, U[4], reasonIds.a3), revokeRow(905, D(6), reasonIds.a1b),
  // N5: "early" is created AFTER the revocation date of its only grant (D(2) < created 2026-09-30): never an end before creation
  grantRow(906, id(501), U[1], reasonIds.early), revokeRow(906, D(2), reasonIds.early),
  // the still-current restriction: the revocation reason of the LAST visibility change of a resource that stays restricted
  `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id, reason_ref)
   VALUES ('${TENANT}', '${U[0]}', 'Risk', '${RISK}', 'PERMISSION_CHANGE', '{}', '{}', NULL, 'l2b-current', '${reasonIds.current}')`,
  grantRow(907, RISK, U[2], reasonIds.current), revokeRow(907, D(7), reasonIds.current),
  // widened-view requests
  ...[
    [801, "REJECTED", U[0]], [802, "REVOKED", U[1]], [803, "APPROVED", U[2]], [804, "PENDING", U[3]],
  ].map(([n, , u]) => `INSERT INTO sensitive_view_grants (id, tenant_id, user_id, reason, reason_ref, requested_by, requested_at) VALUES ('${id(n as number)}', '${TENANT}', '${u}', NULL, '${[reasonIds.sq1, reasonIds.sq2, reasonIds.sq3, reasonIds.sq4][(n as number) - 801]}', '${U[4]}', '${CREATED}')`),
  `UPDATE sensitive_view_grants SET status = 'REJECTED', decided_by = '${U[1]}', decided_at = '${D(8)}', decision_reason_ref = '${reasonIds.sd1}' WHERE id = '${id(801)}'`,
  `UPDATE sensitive_view_grants SET status = 'APPROVED', decided_by = '${U[0]}', decided_at = '${D(3)}', decision_reason_ref = '${reasonIds.sd2}', access_expires_at = now() + interval '10 days' WHERE id = '${id(802)}'`,
  `UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = '${U[0]}', revoked_at = '${D(9)}', revoke_reason_ref = '${reasonIds.sv2}' WHERE id = '${id(802)}'`,
  `UPDATE sensitive_view_grants SET status = 'APPROVED', decided_by = '${U[0]}', decided_at = '${D(3)}', decision_reason_ref = '${reasonIds.sd2}', access_expires_at = now() + interval '10 days' WHERE id = '${id(803)}'`,
];

describe.skipIf(!hasLocalPg)("QA-L2b migration 097 on a database at state 096 with inherited rows (real PostgreSQL, local only)", () => {
  let admin: Pool;
  const clones: string[] = [];
  const failures: string[] = [];

  async function runFile(database: string, sql: string): Promise<string | null> {
    const c = new Client({ host: PG_HOST, port: PORT, user: "postgres", database });
    await c.connect();
    try { await c.query(sql); return null; } catch (e) { return `${(e as { code?: string }).code ?? ""} ${(e as Error).message}`; } finally { await c.end(); }
  }
  async function clone() {
    const name = `grc_qa_l2bm_c${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE}`);
    clones.push(name);
    const pool = connect(name, 2);
    const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { name, pool, q };
  }
  const ends = async (q: (s: string) => Promise<Array<Record<string, any>>>) => // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.fromEntries((await q(`SELECT id, effect_ended_at AS e FROM visibility_reasons ORDER BY id`)).map((r) => [Object.entries(reasonIds).find(([, v]) => v === r["id"])?.[0] ?? r["id"], r["e"] ? (r["e"] as Date).toISOString() : null]));

  beforeAll(async () => {
    admin = connect("postgres", 2);
    await admin.query(`CREATE DATABASE ${TEMPLATE}`);
    const setup = new Client({ host: PG_HOST, port: PORT, user: "postgres", database: TEMPLATE });
    await setup.connect();
    try {
      await setup.query("CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
      for (const f of upTo096()) await setup.query(file(f));
      for (const stmt of SEED) await setup.query(stmt).catch((e: Error) => { throw new Error(`${e.message} :: ${stmt.slice(0, 200)}`); });
    } finally { await setup.end(); }
  }, 280000);

  afterAll(async () => {
    for (const n of [...clones, TEMPLATE]) await admin?.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    await admin?.end();
    expect(failures).toEqual([]);
  }, 60000);

  it("the template is at 096 (no retention column, no reason ended) with the inherited rows", async () => {
    const c = await clone();
    try {
      expect(await c.q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'configs' AND column_name = 'visibility_reason_retention_days'`)).toHaveLength(0);
      expect(Object.values(await ends(c.q))).toEqual(Object.values(reasonIds).map(() => null));
      expect(await c.q(`SELECT 1 FROM resource_access_grants`)).toHaveLength(7);
      expect(await c.q(`SELECT 1 FROM sensitive_view_grants`)).toHaveLength(4);
    } finally { await c.pool.end(); }
  });

  it("up: the catch-up dates match the oracle (nominatif max(revoked_at) only if all revoked; widened-view COALESCE; the rest NULL)", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      const e = await ends(c.q);
      const iso = (d: string) => new Date(d).toISOString();
      expect(e["a1"]).toBe(iso(D(3)));
      expect(e["a2"]).toBeNull(); // one live grant still cites it
      expect(e["a3"]).toBe(iso(D(6)));
      expect(e["a4"]).toBeNull(); // cited by nobody
      expect(e["openRaci"]).toBeNull();
      expect(e["openOwner"]).toBeNull();
      expect(e["sq1"]).toBe(iso(D(8)));
      expect(e["sd1"]).toBe(iso(D(8)));
      for (const k of ["sq2", "sd2", "sv2"]) expect(e[k], k).toBe(iso(D(9))); // REVOKED: revoked_at
      expect(e["sq3"]).toBeNull();
      expect(e["sq4"]).toBeNull();
      // never an end before the creation of the reason: GREATEST(revoked_at, created_at)
      expect(e["early"]).toBe(iso("2026-09-30T10:00:00Z"));
      // a1b is cited as revoke reason by four grants (D(3), D(4), D(5), D(6)): all revoked, latest wins (the live a2 grant does not cite it)
      expect(e["a1b"]).toBe(iso(D(6)));
      expect(await c.q(`SELECT 1 FROM visibility_reasons WHERE erased_at IS NOT NULL OR text IS NULL`)).toHaveLength(0);
    } finally { await c.pool.end(); }
  });

  // QA-L2B-01: a reason that still justifies a CURRENT restriction is ended by the catch-up (the rule looks at the grants only).
  it.fails("up: the reason of the last visibility change of a resource that is STILL restricted stays active (NULL), even if its grants are revoked", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect((await ends(c.q))["current"]).toBeNull();
    } finally { await c.pool.end(); }
  });

  it("replay: 097 twice, then down / up / down / down: no date moves, no permission is duplicated, the 096 guard is back", async () => {
    const c = await clone();
    try {
      await c.q(`INSERT INTO roles (tenant_id, name, permissions) VALUES ('${TENANT}', 'Admin QA', ARRAY['user.update','risk.read'])`);
      await c.q(`UPDATE users SET roles = ARRAY['user.update'] WHERE id = '${U[0]}'`);
      expect(await runFile(c.name, file(UP))).toBeNull();
      const first = await ends(c.q);
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect(await ends(c.q)).toEqual(first);
      const perms = async () => ({
        role: (await c.q(`SELECT permissions FROM roles WHERE name = 'Admin QA'`))[0]!["permissions"] as string[],
        user: (await c.q(`SELECT roles FROM users WHERE id = '${U[0]}'`))[0]!["roles"] as string[],
      });
      const p1 = await perms();
      expect(p1.role.filter((x) => x === "retention.purge")).toHaveLength(1);
      expect(p1.user.filter((x) => x === "retention.purge")).toHaveLength(1);
      expect(await runFile(c.name, file(DOWN))).toBeNull();
      expect(await ends(c.q)).toEqual(first); // dates are facts: kept
      const p2 = await perms();
      expect(p2.role).not.toContain("retention.purge");
      expect(p2.user).not.toContain("retention.purge");
      expect(await c.q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'configs' AND column_name = 'visibility_reason_retention_days'`)).toHaveLength(0);
      // 096 guard back: a young, never-ended reason is erasable again (the L2b fail-closed guard is gone), documents the rollback scope
      expect(await runFile(c.name, file(DOWN))).toBeNull(); // replayable
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect(await ends(c.q)).toEqual(first);
      expect((await perms()).role.filter((x) => x === "retention.purge")).toHaveLength(1);
    } finally { await c.pool.end(); }
  });

  it("permission retention.purge: live custom roles and accounts holding an administrator permission only (not deleted roles, not group roles, not plain roles)", async () => {
    const c = await clone();
    try {
      await c.q(`INSERT INTO roles (tenant_id, name, permissions) VALUES ('${TENANT}', 'Admin', ARRAY['role.assign']), ('${TENANT}', 'Plain', ARRAY['risk.read','audit.read'])`);
      await c.q(`INSERT INTO roles (tenant_id, name, permissions, deleted_at) VALUES ('${TENANT}', 'Deleted', ARRAY['user.update'], now())`);
      await c.q(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ('${TENANT}', 'Groupe', ARRAY['user.update'], 'AUDIT')`);
      await c.q(`UPDATE users SET roles = ARRAY['config.governancedelays.set'] WHERE id = '${U[0]}'`);
      await c.q(`UPDATE users SET roles = ARRAY['risk.read'] WHERE id = '${U[1]}'`);
      expect(await runFile(c.name, file(UP))).toBeNull();
      const has = async (name: string) => ((await c.q(`SELECT permissions FROM roles WHERE name = $1`, [name]))[0]!["permissions"] as string[]).includes("retention.purge");
      expect([await has("Admin"), await has("Plain"), await has("Deleted"), await has("Groupe")]).toEqual([true, false, false, false]);
      const userHas = async (u: string) => ((await c.q(`SELECT roles FROM users WHERE id = $1`, [u]))[0]!["roles"] as string[]).includes("retention.purge");
      expect([await userHas(U[0]!), await userHas(U[1]!)]).toEqual([true, false]);
    } finally { await c.pool.end(); }
  });

  it("configs: default 365 on an existing row, CHECK 365..3650 (364 and 3651 refused, 365, 3650 and NULL accepted)", async () => {
    const c = await clone();
    try {
      await c.q(`INSERT INTO configs (tenant_id) VALUES ('${TENANT}')`).catch(() => null);
      expect(await runFile(c.name, file(UP))).toBeNull();
      expect((await c.q(`SELECT visibility_reason_retention_days AS d FROM configs WHERE tenant_id = '${TENANT}'`))[0]!["d"]).toBe(365);
      const set = (v: string) => c.pool.query(`UPDATE configs SET visibility_reason_retention_days = ${v} WHERE tenant_id = '${TENANT}'`).then(() => null, (e: Error) => e.message);
      expect(await set("364")).toMatch(/check constraint/);
      expect(await set("3651")).toMatch(/check constraint/);
      for (const v of ["365", "3650", "NULL"]) expect(await set(v), v).toBeNull();
    } finally { await c.pool.end(); }
  });

  it("guard after 097: erasure is refused for NULL retention (even very old), for a 364-day end, and accepted at 366 days; a config row removed means 365", async () => {
    const c = await clone();
    try {
      expect(await runFile(c.name, file(UP))).toBeNull();
      const own = new Client({ host: PG_HOST, port: PORT, user: "postgres", database: c.name });
      await own.connect();
      const refused = (sql: string, p: unknown[] = []) => own.query(sql, p).then(() => null, (e: Error) => e.message);
      const age = async (rid: string, days: number) => {
        await own.query(`ALTER TABLE visibility_reasons DISABLE TRIGGER visibility_reasons_guard`);
        await own.query(`UPDATE visibility_reasons SET created_at = now() - make_interval(days => $2 + 1), effect_ended_at = now() - make_interval(days => $2) WHERE id = $1`, [rid, days]);
        await own.query(`ALTER TABLE visibility_reasons ENABLE TRIGGER visibility_reasons_guard`);
      };
      try {
        const erase = (rid: string) => refused(`UPDATE visibility_reasons SET text = NULL, erased_at = clock_timestamp() WHERE id = $1`, [rid]);
        await own.query(`INSERT INTO configs (tenant_id, visibility_reason_retention_days) VALUES ($1, NULL) ON CONFLICT (tenant_id) DO UPDATE SET visibility_reason_retention_days = NULL`, [TENANT]);
        await age(reasonIds.a4, 4000);
        expect(await erase(reasonIds.a4)).toMatch(/retention period/); // NULL = never
        await own.query(`UPDATE configs SET visibility_reason_retention_days = 365 WHERE tenant_id = $1`, [TENANT]);
        await age(reasonIds.a4, 364);
        expect(await erase(reasonIds.a4)).toMatch(/retention period/);
        await age(reasonIds.a4, 366);
        await own.query(`DELETE FROM configs WHERE tenant_id = $1`, [TENANT]); // no row: 365 (the floor), not "never"
        await age(reasonIds.openRaci, 364);
        expect(await erase(reasonIds.openRaci)).toMatch(/retention period/);
        expect(await erase(reasonIds.a4)).toBeNull();
        // a reason whose effect was never ended (NULL) is never erasable, however old its creation
        expect(await erase(reasonIds.a2)).toMatch(/effect has ended/);
        // the CHECK of 096 still stands for an aged reason: the text cannot go to NULL without erased_at
        await age(reasonIds.sq4, 400);
        expect(await refused(`UPDATE visibility_reasons SET text = NULL WHERE id = $1`, [reasonIds.sq4])).toMatch(/check constraint/);
        // the date of an erasure is not in the future
        await age(reasonIds.sq3, 400);
        expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() + interval '2 days' WHERE id = $1`, [reasonIds.sq3])).toMatch(/never in the future/);
      } finally { await own.end(); }
    } finally { await c.pool.end(); }
  });
});
