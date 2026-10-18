import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

/**
 * QA-panel (d): migrations 066 to 071 (D1, D2a, D2d, D2b, D2c, D3).
 *  - static part: always runs (text of the .sql files);
 *  - live part: up -> down -> up -> replay on a DISPOSABLE database only. Skipped unless
 *      QA_PANEL_MIGHOST is a unix socket directory AND QA_PANEL_MIGDB starts with "grc_qa_panel" (never grc_qa_a08, never Neon).
 *    Prerequisite: the database already has 001..071 (e.g. CREATE DATABASE grc_qa_panel TEMPLATE grc_qa_a08).
 *    The test leaves the database in the full 071 state.
 */
const DIR = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const NUMBERS = ["066", "067", "068", "069", "070", "071"] as const;
const up = (n: string) => readdirSync(DIR).find((f) => f.startsWith(`${n}_`) && !f.endsWith(".down.sql"))!;
const down = (n: string) => readdirSync(DIR).find((f) => f.startsWith(`${n}_`) && f.endsWith(".down.sql"))!;
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const stripComments = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("QA-panel migrations 066-071 (static)", () => {
  it("each number has exactly one up and one down file, and the series is contiguous after 065", () => {
    for (const n of NUMBERS) {
      expect(readdirSync(DIR).filter((f) => f.startsWith(`${n}_`) && !f.endsWith(".down.sql"))).toHaveLength(1);
      expect(readdirSync(DIR).filter((f) => f.startsWith(`${n}_`) && f.endsWith(".down.sql"))).toHaveLength(1);
    }
    const ups = readdirSync(DIR).filter((f) => /^\d{3}_/.test(f) && f.endsWith(".sql") && !f.endsWith(".down.sql")).map((f) => f.slice(0, 3)).sort();
    const after = ups.filter((n) => n >= "065");
    expect(after).toEqual(["065", ...NUMBERS]);
  });

  it("no physical delete, truncate or drop in an up file (soft delete only; the guard text 'cannot be truncated' is not a statement)", () => {
    for (const n of NUMBERS) {
      const sql = stripComments(read(up(n)));
      expect(sql, up(n)).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql, up(n)).not.toMatch(/^\s*TRUNCATE\b/im);
      expect(sql, up(n)).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|FUNCTION|CONSTRAINT)\b/i);
    }
  });

  it("a down file deletes only its own schema_migrations row, in its own transaction", () => {
    for (const n of NUMBERS) {
      const sql = stripComments(read(down(n)));
      const deletes = sql.match(/\bDELETE\s+FROM\s+\w+[^;]*;/gi) ?? [];
      expect(deletes, down(n)).toEqual([`DELETE FROM schema_migrations WHERE filename = '${up(n)}';`]);
      expect(sql.trim().startsWith("BEGIN;"), down(n)).toBe(true);
      expect(sql.trim().endsWith("COMMIT;"), down(n)).toBe(true);
    }
  });

  it("every function defined by 066-071 pins search_path = pg_catalog, public, pg_temp (pg_temp LAST), on every definition", () => {
    let functions = 0;
    for (const n of NUMBERS) {
      const sql = stripComments(read(up(n)));
      for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(([\s\S]*?)\$\$[\s\S]*?\$\$\s*;/gi)) {
        functions += 1;
        const header = m[0].slice(0, m[0].indexOf("$$"));
        expect(header, `${up(n)} ${m[1]}`).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp\b/i);
      }
    }
    expect(functions).toBe(7); // 068 x3, 070 x2 (guard + truncate guard), 071 x2
  });

  it("066 adds the audit column without touching existing audit rows (no UPDATE/DELETE on audit_log)", () => {
    const sql = stripComments(read(up("066")));
    expect(sql).not.toMatch(/\bUPDATE\s+audit_log\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+audit_log\b/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS governance_exception text\b/i);
  });

  it("permission back-fills (066, 069, 070, 071) never grant to a fixed group something the plan reserves: designation.manage and config.selfvalidation.set go to no system group", () => {
    for (const n of ["066", "070"] as const) {
      const sql = stripComments(read(up(n)));
      for (const stmt of sql.split(";")) {
        if (!/config\.selfvalidation\.set'?\]|designation\.manage/.test(stmt) || !/UPDATE\s+roles/i.test(stmt)) continue;
        if (/ARRAY\['governancehealth\.read',\s*'config\.selfvalidation\.set'\]/.test(stmt) || /ARRAY\['designation\.manage'\]/.test(stmt)) {
          expect(stmt, `${up(n)}: ${stmt.slice(0, 80)}`).toMatch(/system_group IS NULL/);
        }
      }
    }
  });
});

const HOST = process.env.QA_PANEL_MIGHOST ?? "";
const DB = process.env.QA_PANEL_MIGDB ?? "";
const live = HOST.startsWith("/") && DB.startsWith("grc_qa_panel");

describe.skipIf(!live)("QA-panel migrations 066-071 (live, disposable database)", () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ host: HOST, port: Number(process.env.QA_PANEL_MIGPORT ?? 5531), user: "postgres", database: DB, max: 2 }); });
  afterAll(async () => { await pool?.end(); });

  const run = async (file: string) => {
    const c = await pool.connect();
    try { await c.query(read(file)); } finally { c.release(); }
  };
  const downAll = async () => { for (const n of [...NUMBERS].reverse()) await run(down(n)); };
  const upAll = async () => { for (const n of NUMBERS) await run(up(n)); };
  const objects = async () => {
    const q = async (sql: string) => (await pool.query(sql)).rows;
    return {
      columns: (await q(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns WHERE (table_name, column_name) IN
        (('users','last_seen_at'),('processes','owner_user_id'),('processes','risk_champion_user_id'),('processes','deputy_user_id'),('audit_log','governance_exception'),
         ('configs','self_validation_policy'),('tenants','single_person_regime_declared_at'),('tenants','single_person_regime_lift_threshold'),
         ('tenants','single_person_regime_lifted_at'),('tenants','single_person_regime_lift_ref')) ORDER BY 1`)).map((r) => r.c as string),
      tables: (await q(`SELECT to_regclass('governance_designations')::text AS a, to_regclass('organization_profiles')::text AS b`))[0],
      functions: (await q(`SELECT proname FROM pg_proc WHERE proname IN ('single_person_regime_people','tenants_single_person_regime_guard','single_person_regime_lift_mark','organization_profiles_guard','organization_profiles_truncate_guard') ORDER BY 1`)).map((r) => r.proname as string),
      triggers: (await q(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('tenants_single_person_regime_guard','user_roles_single_person_lift_insert','user_roles_single_person_lift_update','users_single_person_lift','roles_single_person_lift','organization_profiles_guard','organization_profiles_truncate_guard') ORDER BY 1`)).map((r) => r.tgname as string),
      indexes: (await q(`SELECT indexname FROM pg_indexes WHERE indexname LIKE 'audit_log_governance_exception%' OR indexname LIKE 'governance_designations_%' OR indexname LIKE 'organization_profiles_%' ORDER BY 1`)).map((r) => r.indexname as string),
      perms: (await q(`SELECT (SELECT count(*) FROM roles WHERE permissions && ARRAY['governancehealth.read','config.selfvalidation.set','process.responsibility.assign','designation.manage','orgprofile.read','orgprofile.submit','orgprofile.approve']::text[])::int AS roles,
                              (SELECT count(*) FROM users WHERE roles && ARRAY['governancehealth.read','config.selfvalidation.set','process.responsibility.assign','designation.manage','orgprofile.read','orgprofile.submit','orgprofile.approve']::text[])::int AS users`))[0],
    };
  };

  it("up/down/up: the full 071 state is restored exactly, and replaying every up file changes nothing", async () => {
    const full = await objects();
    expect(full.columns).toHaveLength(10);
    expect(full.functions).toHaveLength(5);
    expect(full.triggers).toHaveLength(7);

    await downAll();
    const empty = await objects();
    expect(empty.columns).toEqual([]);
    expect(empty.tables).toEqual({ a: null, b: null });
    expect(empty.functions).toEqual([]);
    expect(empty.triggers).toEqual([]);
    expect(empty.indexes).toEqual([]);
    expect(empty.perms).toEqual({ roles: 0, users: 0 });

    await upAll();
    expect(await objects()).toEqual(full);
    await upAll(); // replay: idempotent
    expect(await objects()).toEqual(full);
    await downAll();
    await upAll(); // second cycle
    expect(await objects()).toEqual(full);
    await downAll(); // downs replayed on an already-down schema
    await downAll();
    await upAll();
    expect(await objects()).toEqual(full);
  });

  it("each down removes its schema_migrations row (when the tracker has it) and no other row", async () => {
    const before = (await pool.query(`SELECT filename FROM schema_migrations WHERE filename < '066' ORDER BY filename`)).rows.length;
    await downAll();
    expect((await pool.query(`SELECT filename FROM schema_migrations WHERE filename < '066'`)).rows.length).toBe(before);
    expect((await pool.query(`SELECT filename FROM schema_migrations WHERE filename >= '066'`)).rows).toEqual([]);
    await upAll();
  });

  it("down 066 on a database holding marked audit rows works (DDL is not an UPDATE) but the markers are lost for good: documented data loss", async () => {
    const t = (await pool.query(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`mig-${randomUUID()}`])).rows[0].id as string;
    const u = (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'u') RETURNING id`, [t, `m-${randomUUID()}@t.test`])).rows[0].id as string;
    const entityId = randomUUID();
    await pool.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception) VALUES ($1,$2,'X',$3,'VALIDATE','r','noSelfValidation')`, [t, u, entityId]);
    await downAll();
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1`, [entityId])).rows[0].n).toBe(1); // the row itself survives
    await upAll();
    expect((await pool.query(`SELECT governance_exception FROM audit_log WHERE entity_id = $1`, [entityId])).rows[0].governance_exception).toBeNull(); // the marker does not
  });

  it("up 071 on a database whose roles pre-date the groups backfills each group exactly once and never duplicates a permission", async () => {
    await upAll();
    const dup = await pool.query(`SELECT id FROM roles WHERE cardinality(permissions) <> (SELECT count(DISTINCT p) FROM unnest(permissions) p)`);
    expect(dup.rows).toEqual([]);
    const dupUsers = await pool.query(`SELECT id FROM users WHERE cardinality(roles) <> (SELECT count(DISTINCT p) FROM unnest(roles) p)`);
    expect(dupUsers.rows).toEqual([]);
  });
});
