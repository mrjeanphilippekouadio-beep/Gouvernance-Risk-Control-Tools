import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

/**
 * QA-panel2 : migrations 066 to 073 (retest after the in-place hardening of 068-071, plus 072 and 073).
 * Oracle (written before running):
 *   - the series 066..073 is contiguous, each up has a down, every trigger function pins search_path (pg_temp last);
 *   - down(073..066) from the full schema gives EXACTLY the schema of a database built with 001..065 only (same columns,
 *     constraints, indexes, triggers, function bodies and settings, runtime grants, tracker rows);
 *   - up(066..073) then gives back EXACTLY the schema of a database built from scratch with 001..073;
 *   - replaying every up file, and every down file on an already-down schema, changes nothing.
 * Live part: DISPOSABLE databases only (name starts with grc_qa_panel). It needs
 *   QA_PANEL_MIGHOST (unix socket dir), QA_PANEL_MIGDB (= full 073 database) and QA_PANEL_REFDB (= database built with 001..065).
 */
const DIR = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const NUMBERS = ["066", "067", "068", "069", "070", "071", "072", "073", "074"] as const;
const files = readdirSync(DIR);
const up = (n: string) => files.find((f) => f.startsWith(`${n}_`) && !f.endsWith(".down.sql"))!;
const down = (n: string) => files.find((f) => f.startsWith(`${n}_`) && f.endsWith(".down.sql"))!;
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const stripComments = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("QA-panel2 migrations 066-073 (static)", () => {
  it("numbers 066..073 are contiguous (numerically, no hole), one up and one down each", () => {
    const nums = files.filter((f) => /^\d{3}_/.test(f) && !f.endsWith(".down.sql")).map((f) => Number(f.slice(0, 3)));
    for (let n = 66; n <= 74; n += 1) expect(nums.filter((x) => x === n), `number ${n}`).toHaveLength(1);
    expect(Math.max(...nums)).toBe(74);
    for (const n of NUMBERS) expect(down(n), n).toBeDefined();
  });

  it("072 and 073: no physical delete/truncate/drop in the up, delete only the own tracker row in the down", () => {
    for (const n of ["072", "073"] as const) {
      const upSql = stripComments(read(up(n)));
      expect(upSql, up(n)).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(upSql, up(n)).not.toMatch(/^\s*TRUNCATE\b/im);
      expect(upSql, up(n)).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
      const downSql = stripComments(read(down(n)));
      expect(downSql.match(/\bDELETE\s+FROM\s+\w+[^;]*;/gi) ?? [], down(n)).toEqual([`DELETE FROM schema_migrations WHERE filename = '${up(n)}';`]);
      expect(downSql.trim().startsWith("BEGIN;") && downSql.trim().endsWith("COMMIT;"), down(n)).toBe(true);
    }
  });

  it("073: every trigger function pins search_path = pg_catalog, public, pg_temp, and the new tables are not deletable by the runtime role", () => {
    const sql = stripComments(read(up("073")));
    const fns = [...sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\w+)\s*\(([\s\S]*?)\$\$[\s\S]*?\$\$\s*;/gi)];
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const m of fns) expect(m[0].slice(0, m[0].indexOf("$$")), m[1]).toMatch(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp\b/i);
    expect(sql).toMatch(/REVOKE\s+(UPDATE,\s*)?DELETE,\s*TRUNCATE\s+ON\s+governance_exception_reviews/i);
    expect(sql).toMatch(/REVOKE\s+DELETE,\s*TRUNCATE\s+ON\s+governance_principle_acceptances/i);
  });

  it("072 and 073 back-fills never give Audit a deciding right (config.selfvalidation.approve, acceptance.confirm, accept, orgprofile.approve)", () => {
    const text = stripComments(read(up("072")) + read(up("073")));
    for (const stmt of text.split(";")) {
      if (!/UPDATE\s+roles/i.test(stmt)) continue;
      if (/system_group\s*=\s*'AUDIT'/.test(stmt)) {
        expect(stmt).not.toMatch(/config\.selfvalidation\.approve|acceptance\.confirm|governanceprinciple\.accept'|orgprofile\.approve/);
      }
    }
  });
});

const HOST = process.env.QA_PANEL_MIGHOST ?? "";
const DB = process.env.QA_PANEL_MIGDB ?? "";
const REF = process.env.QA_PANEL_REFDB ?? "";
const live = HOST.startsWith("/") && DB.startsWith("grc_qa_panel") && REF.startsWith("grc_qa_panel") && DB !== REF;

const FINGERPRINT = `
  SELECT 'col ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || ' ' || c.is_nullable || ' ' || coalesce(c.column_default, '-') AS line
    FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name <> 'schema_migrations'
  UNION ALL SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
  UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL SELECT 'trg ' || pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE NOT tgisinternal
  UNION ALL SELECT 'fn ' || pg_get_functiondef(p.oid) FROM pg_proc p WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'grant ' || table_name || ' ' || privilege_type FROM information_schema.role_table_grants
    WHERE grantee = 'grc_app_runtime' AND table_schema = 'public' AND table_name <> 'schema_migrations'
  UNION ALL SELECT 'tbl ' || tablename FROM pg_tables WHERE schemaname = 'public'
  UNION ALL SELECT 'perm ' || coalesce(system_group, '-') || ' ' || p FROM roles, LATERAL unnest(permissions) p
    WHERE tenant_id NOT IN (SELECT id FROM tenants WHERE name LIKE 'mig2%')
  ORDER BY 1`;

describe.skipIf(!live)("QA-panel2 migrations 066-073 (live, disposable databases)", () => {
  let pool: Pool; let ref: Pool;
  beforeAll(async () => {
    const port = Number(process.env.QA_PANEL_MIGPORT ?? 5531);
    pool = new Pool({ host: HOST, port, user: "postgres", database: DB, max: 2 });
    ref = new Pool({ host: HOST, port, user: "postgres", database: REF, max: 2 });
    // QA-panel-migrations.test.ts replays the up files, which never write the tracker (the runner does): restore the rows so the fixture is the claimed state.
    for (const n of NUMBERS) await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [up(n)]);
  });
  afterAll(async () => {
    // leave the disposable database as found: the roles inserted by the back-fill test would otherwise be counted by QA-panel-migrations.test.ts
    await pool?.query(`DELETE FROM roles WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE 'mig2%')`).catch(() => undefined);
    await pool?.end(); await ref?.end();
  });

  const run = async (file: string) => { const c = await pool.connect(); try { await c.query(read(file)); } finally { c.release(); } };
  const downAll = async () => { for (const n of [...NUMBERS].reverse()) await run(down(n)); };
  const upAll = async () => { for (const n of NUMBERS) await run(up(n)); };
  const print = async (p: Pool) => (await p.query<{ line: string }>(FINGERPRINT)).rows.map((r) => r.line);
  const tracker = async (p: Pool) => (await p.query<{ filename: string }>(`SELECT filename FROM schema_migrations ORDER BY filename`)).rows.map((r) => r.filename);

  it("full database starts at 073 with every tracker row (the fixture is the state we claim)", async () => {
    expect((await tracker(pool)).filter((f) => f >= "066")).toEqual(NUMBERS.map(up));
    expect(await tracker(ref)).not.toContain(up("066"));
  });

  it("down 073..066 restores EXACTLY the 065 schema; up 066..073 restores EXACTLY the full schema; replays change nothing", async () => {
    const full = await print(pool);
    const fullTracker = await tracker(pool);
    const base = await print(ref);
    expect(full.length).toBeGreaterThan(base.length);

    await downAll();
    expect(await print(pool)).toEqual(base);
    expect(await tracker(pool)).toEqual(await tracker(ref));

    await upAll();
    expect(await print(pool)).toEqual(full);
    await upAll(); // replay of every up
    expect(await print(pool)).toEqual(full);

    await downAll(); await downAll(); // downs replayed on an already-down schema
    expect(await print(pool)).toEqual(base);
    await upAll();
    expect(await print(pool)).toEqual(full);
    // the up files do not touch the tracker (the runner does): put the rows back so the fixture stays the claimed state
    for (const f of fullTracker.filter((x) => x >= "066")) await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
  });

  it("each single top-of-stack migration goes down then up alone (073, then 072) without touching the others", async () => {
    const full = await print(pool);
    for (const n of ["073", "072"] as const) {
      await run(down(n));
      expect(await print(pool), `after down ${n}`).not.toEqual(full);
      await run(up(n));
      expect(await print(pool), `after up ${n}`).toEqual(full);
    }
    for (const n of ["072", "073"] as const) await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [up(n)]);
  });

  it("072 and 073 back-fills: re-running the up files never duplicates a permission, and Audit roles never receive a deciding right", async () => {
    const t = (await pool.query(`INSERT INTO tenants (name) VALUES ('mig2-' || gen_random_uuid()) RETURNING id`)).rows[0].id as string;
    for (const g of ["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"]) {
      await pool.query(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, '{risk.read}', $2)`, [t, g]);
    }
    await run(up("072")); await run(up("073")); await run(up("072")); await run(up("073"));
    const rows = (await pool.query<{ system_group: string; permissions: string[] }>(`SELECT system_group, permissions FROM roles WHERE tenant_id = $1`, [t])).rows;
    for (const r of rows) expect(new Set(r.permissions).size, r.system_group).toBe(r.permissions.length);
    const audit = rows.find((r) => r.system_group === "AUDIT")!.permissions;
    for (const p of ["config.selfvalidation.approve", "governanceprinciple.acceptance.confirm", "governanceprinciple.accept", "orgprofile.approve"]) expect(audit).not.toContain(p);
    expect(audit).toEqual(expect.arrayContaining(["governanceexception.review", "governanceprinciple.acceptance.revoke"]));
    const rm = rows.find((r) => r.system_group === "RISK_MANAGER")!.permissions;
    expect(rm).toEqual(expect.arrayContaining(["config.selfvalidation.approve", "governanceprinciple.accept", "governanceprinciple.acceptance.confirm"]));
    const committee = rows.find((r) => r.system_group === "RISK_COMMITTEE")!.permissions;
    expect(committee).not.toContain("governanceprinciple.accept"); // the Committee confirms, never accepts (q138)
  });

  it("down 072 / 073 on a database holding requests, reviews and acceptances: works, and the loss is the tables only (audit_log rows stay) -- documented loss", async () => {
    const t = (await pool.query(`INSERT INTO tenants (name) VALUES ('mig2b-' || gen_random_uuid()) RETURNING id`)).rows[0].id as string;
    const mk = async (e: string) => (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `${e}-${Math.random()}@mig2`])).rows[0].id as string;
    const a = await mk("a"); const b = await mk("b");
    const al = (await pool.query(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception)
      VALUES ($1,$2,'Finding',gen_random_uuid(),'CLOSE','r','noSelfValidation') RETURNING id`, [t, a])).rows[0].id as string;
    await pool.query(`INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by) VALUES ($1,'DOUBLE_CONFIRMATION','m',$2)`, [t, a]);
    await pool.query(`INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1,$2,'REVIEWED',$3,'ok')`, [t, al, b]);
    await run(down("073")); await run(down("072"));
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE id = $1`, [al])).rows[0].n).toBe(1);
    expect((await pool.query(`SELECT to_regclass('governance_exception_reviews')::text AS r, to_regclass('self_validation_policy_requests')::text AS s`)).rows[0]).toEqual({ r: null, s: null });
    await run(up("072")); await run(up("073"));
    for (const n of ["072", "073"] as const) await pool.query(`INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [up(n)]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM governance_exception_reviews`)).rows[0].n).toBe(0);
  });
});
