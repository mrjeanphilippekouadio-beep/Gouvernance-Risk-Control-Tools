import { describe, expect, it } from "vitest";
import { emailLiterals, hasLocalPg, migrationSql, useMigrationTenant } from "./migrationHarness.js";
import { GOVERNANCE_DECISION_RIGHTS } from "../src/domain/fixedGroupPermissions.js";
import { SYSTEM_ACCOUNT_DOMAIN, isSystemAccount } from "../src/domain/systemAccounts.js";

/**
 * q186 (DECISION-096), migration 077: the 4 decision rights leave ordinary roles and direct users.roles, audited.
 * Static part always runs; the live part re-runs the (idempotent) 077 text on a disposable database
 * (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..077).
 */
const UP = migrationSql("077_governance_rights_ordinary_cleanup.sql");

describe("migration 077 (static)", () => {
  it("every ARRAY literal of 077 is exactly GOVERNANCE_DECISION_RIGHTS", () => {
    const arrays = [...UP.matchAll(/ARRAY\[([^\]]*)\]::text\[\]/g)].map((m) => m[1].split(",").map((s) => s.trim().replace(/'/g, "")));
    expect(arrays.length).toBeGreaterThanOrEqual(6);
    for (const a of arrays) expect(a).toEqual([...GOVERNANCE_DECISION_RIGHTS]);
  });

  it("its technical account uses the domain the services refuse to revive (SEC-077-01)", () => {
    const emails = emailLiterals(UP);
    expect(emails).toEqual([`migration-077${SYSTEM_ACCOUNT_DOMAIN}`]);
    expect(isSystemAccount({ email: emails[0] })).toBe(true);
  });
});

describe.skipIf(!hasLocalPg)("migration 077 (real PostgreSQL)", () => {
  const { ctx, one } = useMigrationTenant("q186");

  it("strips the decision rights from ordinary roles and users.roles, keeps the rest and fixed groups, audits each change, and is idempotent", async () => {
    const ordinary = (await one(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, 'Ordinaire', ARRAY['risk.read','orgprofile.approve','kri.read']) RETURNING id`, [ctx.tenant])).id;
    const deleted = (await one(`INSERT INTO roles (tenant_id, name, permissions, deleted_at) VALUES ($1, 'Supprimé', ARRAY['governanceexception.review','risk.read'], now()) RETURNING id`, [ctx.tenant])).id;
    const fixed = (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'RM', ARRAY['risk.read','config.selfvalidation.approve'], 'RISK_MANAGER') RETURNING id`, [ctx.tenant])).id;
    const user = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, 'U', ARRAY['governanceexception.review','risk.read']) RETURNING id`, [ctx.tenant, `u-${Math.random()}@q186`])).id;

    await ctx.pool.query(UP);
    await ctx.pool.query(UP); // idempotent: nothing left to strip, no second audit row, no second system account

    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [ordinary])).permissions).toEqual(["risk.read", "kri.read"]);
    // SEC-077-02: a deleted ordinary role is cleaned too, so restoring it never brings the right back.
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [deleted])).permissions).toEqual(["risk.read"]);
    expect((await one(`SELECT permissions FROM roles WHERE id = $1`, [fixed])).permissions).toEqual(["risk.read", "config.selfvalidation.approve"]);
    expect((await one(`SELECT roles FROM users WHERE id = $1`, [user])).roles).toEqual(["risk.read"]);

    const system = await ctx.pool.query(`SELECT id, deleted_at FROM users WHERE tenant_id = $1 AND email = 'migration-077@system.invalid'`, [ctx.tenant]);
    expect(system.rows).toHaveLength(1);
    expect(system.rows[0].deleted_at).not.toBeNull();
    const audit = await ctx.pool.query(
      `SELECT entity_type, entity_id::text AS entity_id, user_id::text AS user_id, old_value, new_value FROM audit_log
       WHERE tenant_id = $1 AND request_id = 'migration:077' ORDER BY entity_type, old_value->>'name'`, [ctx.tenant]);
    expect(audit.rows.map((r) => [r.entity_type, r.entity_id])).toEqual([["Role", ordinary], ["Role", deleted], ["User", user]]);
    expect(audit.rows.every((r) => r.user_id === system.rows[0].id)).toBe(true);
    expect(audit.rows[0].old_value.permissions).toContain("orgprofile.approve");
    expect(audit.rows[2].new_value.roles).toEqual(["risk.read"]);
  });
});
