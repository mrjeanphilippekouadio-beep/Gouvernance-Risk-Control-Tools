import { describe, expect, it } from "vitest";
import { emailLiterals, hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";
import { FIXED_GROUP_PERMISSIONS, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import { SYSTEM_ACCOUNT_DOMAIN, isSystemAccount } from "../src/domain/systemAccounts.js";

/**
 * q187 (DECISION-097), migration 078: the Risk Manager group reads the rights matrix (role.read); the Audit group may
 * receive it through its own circuit (no code). Static part always runs; the live part re-runs the (idempotent) 078
 * text on a disposable database (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..078).
 */
const UP = migrationSql("078_risk_manager_role_read.sql");

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
    const emails = emailLiterals(UP);
    expect(emails).toEqual([`migration-078${SYSTEM_ACCOUNT_DOMAIN}`]);
    expect(isSystemAccount({ email: emails[0]! })).toBe(true);
  });
});

describe.skipIf(!hasLocalPg)("migration 078 (real PostgreSQL)", () => {
  const { ctx, one } = useMigrationTenant("q187");

  it("adds role.read to Risk Manager groups only, audits each change once, and is idempotent", async () => {
    const rm = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'RM', ARRAY['risk.read'], 'RISK_MANAGER') RETURNING id`, [ctx.tenant])).id;
    const audit = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'Audit', ARRAY['audit.read'], 'AUDIT') RETURNING id`, [ctx.tenant])).id;
    const ordinary = (await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'Ordinaire', ARRAY['risk.read']) RETURNING id`, [ctx.tenant])).id;

    await ctx.pool.query(UP);
    await ctx.pool.query(UP); // idempotent

    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [rm])).permissions).toEqual(["risk.read", "role.read"]);
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [audit])).permissions).toEqual(["audit.read"]);
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [ordinary])).permissions).toEqual(["risk.read"]);

    const system = await ctx.pool.query(`SELECT id, deleted_at FROM users WHERE tenant_id = $1 AND email = 'migration-078@system.invalid'`, [ctx.tenant]);
    expect(system.rows).toHaveLength(1);
    expect(system.rows[0].deleted_at).not.toBeNull();
    const rows = await ctx.pool.query(
      `SELECT user_id, action, old_value, new_value, request_id FROM audit_log WHERE tenant_id = $1 AND request_id = 'migration:078'`, [ctx.tenant]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ user_id: system.rows[0].id, action: "PERMISSION_CHANGE" });
    expect(rows.rows[0].old_value.permissions).toEqual(["risk.read"]);
    expect(rows.rows[0].new_value.permissions).toEqual(["risk.read", "role.read"]);
  });
});
