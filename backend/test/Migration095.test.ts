import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { AuditLogService } from "../src/services/AuditLogService.js";

// Migration 095 (q245, conservation L1): 10-year logical masking of the audit journal, by a SQL function only the DB owner can run.
// Static part always runs; live part needs a disposable LOCAL database at 095: MIG095_LIVE=1 MIG095_DB=grc_... (127.0.0.1:55442). Never Neon.
const up = readFileSync("../database/postgresql/migrations/095_audit_log_retention_marks.sql", "utf8");
const repoSrc = readFileSync("src/infrastructure/database/postgres/PostgresAuditRepository.ts", "utf8");

describe("095 (static)", () => {
  it("adds one append-only table and two functions, all with a pinned search_path (pg_temp last); no delete, no change to audit_log", () => {
    expect(up.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)/gi)).toEqual([
      "CREATE OR REPLACE FUNCTION audit_log_retention_marks_guard",
      "CREATE OR REPLACE FUNCTION mark_expired_audit_log",
    ]);
    expect(up.match(/SET search_path = pg_catalog, public, pg_temp/g)).toHaveLength(4);
    expect(up).toMatch(/BEFORE UPDATE OR DELETE ON audit_log_retention_marks/);
    expect(up).toMatch(/BEFORE TRUNCATE ON audit_log_retention_marks/);
    expect(up).toMatch(/REVOKE ALL ON FUNCTION mark_expired_audit_log\(uuid, interval\) FROM PUBLIC/);
    expect(up).toMatch(/REVOKE ALL ON FUNCTION mark_expired_audit_log\(uuid, interval\) FROM grc_app_runtime/);
    expect(up).not.toMatch(/DELETE\s+FROM/i);
    expect(up).not.toMatch(/(ALTER|UPDATE|INSERT INTO)\s+(TABLE\s+)?audit_log\b(?!_)/i);
  });

  it("only the three consultation reads filter on the marks", () => {
    expect(repoSrc.match(/\$\{NOT_MARKED\}|NOT_MARKED\]/g)).toHaveLength(3);
    expect(repoSrc.match(/audit_log_retention_marks/g)).toHaveLength(1);
  });
});

const live = process.env["MIG095_LIVE"] === "1" && /^grc_/.test(process.env["MIG095_DB"] ?? "");

describe.skipIf(!live)("095 on a real local database", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  let tenant: string;
  let other: string;
  let user: string;
  const ids: Record<string, string> = {};
  const ent = { old: randomUUID(), recent: randomUUID() };
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const row = async (t: string, entityId: string, age: string) => (await q(
    `INSERT INTO audit_log (tenant_id, "timestamp", user_id, entity_type, entity_id, action, request_id)
     VALUES ($1, now() - $2::interval, $3, 'Risk', $4, 'CREATE', 'r') RETURNING id`, [t, age, user, entityId]))[0]!["id"] as string;
  const refused = async (sql: string, code: string) => { await expect(pool.query(sql)).rejects.toMatchObject({ code }); };

  beforeAll(async () => {
    pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG095_PORT"] ?? 55442), user: "postgres", database: process.env["MIG095_DB"]!, max: 2 });
    tenant = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T095-${tag}`]))[0]!["id"];
    other = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T095b-${tag}`]))[0]!["id"];
    user = (await q(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [tenant, `u-${tag}@x.test`]))[0]!["id"];
    ids["old"] = await row(tenant, ent.old, "11 years");
    ids["recent"] = await row(tenant, ent.recent, "9 years");
    ids["otherOld"] = await row(other, ent.old, "11 years");
  });
  afterAll(async () => { await pool?.end(); });

  it("refuses a duration under 10 years (and NULL), marks nothing", async () => {
    for (const d of ["9 years", "3650 days", "1 day", "0"]) {
      await expect(pool.query(`SELECT * FROM mark_expired_audit_log($1, $2::interval)`, [tenant, d]), d).rejects.toMatchObject({ code: "22023" });
    }
    await expect(pool.query(`SELECT * FROM mark_expired_audit_log($1, NULL)`, [tenant])).rejects.toMatchObject({ code: "22023" });
    await expect(pool.query(`SELECT * FROM mark_expired_audit_log(NULL)`)).rejects.toMatchObject({ code: "22023" });
    expect(await q(`SELECT 1 FROM audit_log_retention_marks WHERE tenant_id = $1`, [tenant])).toHaveLength(0);
  });

  it("marks only this tenant's rows older than 10 years, returns count + run_id, a replay marks nothing, audit_log is untouched", async () => {
    const r = (await q(`SELECT * FROM mark_expired_audit_log($1)`, [tenant]))[0]!;
    expect(Number(r["marked_count"])).toBe(1);
    const marks = await q(`SELECT * FROM audit_log_retention_marks WHERE tenant_id = $1`, [tenant]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ audit_log_id: ids["old"], run_id: r["out_run_id"], marked_by: "postgres" });
    expect(Number((await q(`SELECT * FROM mark_expired_audit_log($1)`, [tenant]))[0]!["marked_count"])).toBe(0);
    expect(await q(`SELECT 1 FROM audit_log_retention_marks WHERE audit_log_id = $1`, [ids["otherOld"]])).toHaveLength(0);
    expect(await q(`SELECT 1 FROM audit_log WHERE id = ANY($1)`, [Object.values(ids)])).toHaveLength(3);
  });

  it("the mark table is append-only (UPDATE, DELETE, TRUNCATE refused, even for the owner); audit_log keeps its own guard", async () => {
    await refused(`UPDATE audit_log_retention_marks SET marked_by = 'x'`, "42501");
    await refused(`DELETE FROM audit_log_retention_marks`, "42501");
    await refused(`TRUNCATE audit_log_retention_marks`, "42501");
    await refused(`UPDATE audit_log SET reason = 'x'`, "42501");
  });

  it("the marked row is absent from the three consultation reads and from the service behind GET /audit-logs; the other rows stay", async () => {
    const repo = new PostgresAuditRepository(pool);
    const service = new AuditLogService(repo);
    const actor = { userId: user, tenantId: tenant, email: "a@x.test", displayName: "A", roles: ["audit.read"] };
    const entityIds = (events: Array<{ entityId: string }>) => events.map((e) => e.entityId);
    expect(await repo.listForEntity(tenant, "Risk", ent.old)).toHaveLength(0);
    expect(entityIds(await repo.listForEntity(tenant, "Risk", ent.recent))).toEqual([ent.recent]);
    expect(entityIds(await repo.listRecent(tenant, 500))).not.toContain(ent.old);
    expect(entityIds(await repo.listRecent(tenant, 500))).toContain(ent.recent);
    expect(await repo.search(tenant, { entityId: ent.old }, 10)).toHaveLength(0);
    expect(entityIds(await service.search(actor, {}, 500))).not.toContain(ent.old);
    expect(entityIds(await service.listRecent(actor))).not.toContain(ent.old);
    // The other tenant's equally old row is not marked: still readable by that tenant.
    expect(entityIds(await repo.search(other, { entityId: ent.old }, 10))).toEqual([ent.old]);
  });

  it("the application role can read the marks but cannot run the function nor write the table", async () => {
    const c = await pool.connect();
    try {
      await c.query("SET ROLE grc_app_runtime");
      expect((await c.query(`SELECT count(*)::int AS n FROM audit_log_retention_marks`)).rows[0].n).toBeGreaterThanOrEqual(1);
      for (const sql of [
        `SELECT * FROM mark_expired_audit_log('${tenant}')`,
        `INSERT INTO audit_log_retention_marks (audit_log_id, tenant_id, run_id) VALUES ('${ids["recent"]}', '${tenant}', gen_random_uuid())`,
        `UPDATE audit_log_retention_marks SET marked_by = 'x'`,
        `DELETE FROM audit_log_retention_marks`,
      ]) {
        await expect(c.query(sql), sql).rejects.toMatchObject({ code: "42501" });
      }
    } finally {
      await c.query("RESET ROLE").catch(() => undefined);
      c.release();
    }
  });
});
