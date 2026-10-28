import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { FIXED_GROUP_PERMISSIONS, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import { SYSTEM_ACCOUNT_DOMAIN, isSystemAccount } from "../src/domain/systemAccounts.js";

/**
 * q187 (DECISION-097), migration 078: the Risk Manager group reads the rights matrix (role.read); the Audit group may
 * receive it through its own circuit (no code). Static part always runs; the live part re-runs the (idempotent) 078
 * text on a disposable database (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..078).
 */
const DIR = join(__dirname, "..", "..", "database", "postgresql", "migrations");
const UP = readFileSync(join(DIR, "078_risk_manager_role_read.sql"), "utf8");

describe("q187 rights matrix (static)", () => {
  it("role.read belongs to the Risk Manager group, not to Committee nor Audit by default", () => {
    expect(FIXED_GROUP_PERMISSIONS.RISK_MANAGER).toContain("role.read");
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).not.toContain("role.read");
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).not.toContain("role.read");
  });

  it("the Audit circuit accepts role.read (read-only right, q187)", () => {
    expect(isAuditGroupPermission("role.read")).toBe(true);
  });

  it("078 only touches the Risk Manager group and signs with a technical account the services refuse to revive", () => {
    expect([...UP.matchAll(/system_group = '([A-Z_]+)'/g)].map((m) => m[1])).toEqual(["RISK_MANAGER", "RISK_MANAGER"]);
    const emails = [...new Set([...UP.matchAll(/'([^']+@[^']+)'/g)].map((m) => m[1]))];
    expect(emails).toEqual([`migration-078${SYSTEM_ACCOUNT_DOMAIN}`]);
    expect(isSystemAccount({ email: emails[0]! })).toBe(true);
  });
});

const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("migration 078 (real PostgreSQL)", () => {
  let pool: Pool;
  let tenant = "";
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 });
    tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`q187-${Date.now()}`])).id;
  });
  afterAll(async () => { await pool?.end(); });

  it("adds role.read to Risk Manager groups only, audits each change once, and is idempotent", async () => {
    const rm = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'RM', ARRAY['risk.read'], 'RISK_MANAGER') RETURNING id`, [tenant])).id;
    const audit = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'Audit', ARRAY['audit.read'], 'AUDIT') RETURNING id`, [tenant])).id;
    const ordinary = (await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'Ordinaire', ARRAY['risk.read']) RETURNING id`, [tenant])).id;

    await pool.query(UP);
    await pool.query(UP); // idempotent

    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [rm])).permissions).toEqual(["risk.read", "role.read"]);
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [audit])).permissions).toEqual(["audit.read"]);
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [ordinary])).permissions).toEqual(["risk.read"]);

    const system = await pool.query(`SELECT id, deleted_at FROM users WHERE tenant_id = $1 AND email = 'migration-078@system.invalid'`, [tenant]);
    expect(system.rows).toHaveLength(1);
    expect(system.rows[0].deleted_at).not.toBeNull();
    const rows = await pool.query(
      `SELECT user_id, action, old_value, new_value, request_id FROM audit_log WHERE tenant_id = $1 AND request_id = 'migration:078'`, [tenant]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ user_id: system.rows[0].id, action: "PERMISSION_CHANGE" });
    expect(rows.rows[0].old_value.permissions).toEqual(["risk.read"]);
    expect(rows.rows[0].new_value.permissions).toEqual(["risk.read", "role.read"]);
  });
});
