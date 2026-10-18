import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_PERMISSIONS } from "../src/domain/permissions.js";
import {
  ADMIN_PERMISSIONS,
  FIXED_GROUP_PERMISSIONS,
  isAdministrator,
  isAuditGroupMember,
  isAuditGroupPermission,
  isCommitteeMember,
  isRiskManagerMember,
} from "../src/domain/fixedGroupPermissions.js";
import type { Role } from "../src/domain/entities/Role.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";

/** Lot D1 (DECISION-074): permissions, group predicates, audit marker. */
const role = (over: Partial<Role>): Role => ({ permissions: [], systemGroup: null, ...over }) as Role;

describe("D1 permissions and fixed groups", () => {
  it("both new permissions are known; the fixed groups read the panel; only the administrator sets the policy", () => {
    expect(ALL_PERMISSIONS).toContain("governancehealth.read");
    expect(ALL_PERMISSIONS).toContain("config.selfvalidation.set");
    for (const g of ["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"] as const) {
      expect(FIXED_GROUP_PERMISSIONS[g]).toContain("governancehealth.read");
      expect(FIXED_GROUP_PERMISSIONS[g]).not.toContain("config.selfvalidation.set");
    }
    expect(ADMIN_PERMISSIONS).toContain("config.selfvalidation.set");
    // reading the panel must not make someone an "administrator" (q63 cumul rules)
    expect(ADMIN_PERMISSIONS).not.toContain("governancehealth.read");
    expect(isAuditGroupPermission("governancehealth.read")).toBe(true);
  });

  it("group predicates moved out of RoleService behave as before", () => {
    expect(isAdministrator([role({ permissions: ["role.assign"] })])).toBe(true);
    expect(isAdministrator([role({ permissions: ["governancehealth.read"] })])).toBe(false);
    expect(isRiskManagerMember([role({ systemGroup: "RISK_MANAGER" })])).toBe(true);
    expect(isCommitteeMember([role({ permissions: ["governance.validate"] })])).toBe(true);
    expect(isCommitteeMember([role({ systemGroup: "AUDIT" })])).toBe(false);
    expect(isAuditGroupMember([role({ systemGroup: "AUDIT" })])).toBe(true);
    expect(isAuditGroupMember([role({ permissions: ["audit.read"] })])).toBe(false);
  });

  it("migration 066 grants the same lists as the TS constants (groups) and adds the admin grants", () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations/066_governance_exception.sql"), "utf8");
    expect(sql).toContain("'RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT'");
    expect(sql).toContain("governance_exception text");
    expect(sql).not.toMatch(/\b(DELETE FROM|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/UPDATE\s+audit_log/i);
    // every admin permission of the code (except the new one) is a catch-up criterion
    for (const p of ADMIN_PERMISSIONS.filter((x) => x !== "config.selfvalidation.set")) expect(sql).toContain(`'${p}'`);
  });
});

const HOST = process.env.QA_SWP_PGHOST ?? "";
const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations/066_governance_exception.sql");

describe.skipIf(!HOST.startsWith("/"))("audit_log.governance_exception (migration 066, real PostgreSQL)", () => {
  let pool: Pool; let c: PoolClient; let repo: PostgresAuditRepository;
  let tenant = ""; let user = "";

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 2 });
    await pool.query(readFileSync(MIGRATION, "utf8")); // idempotent
    c = await pool.connect();
    await c.query("BEGIN");
    repo = new PostgresAuditRepository(c as never);
    tenant = (await c.query(`INSERT INTO tenants (name) VALUES ('d1-audit') RETURNING id`)).rows[0].id;
    user = (await c.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, 'u@d1', 'u') RETURNING id`, [tenant])).rows[0].id;
  });
  afterAll(async () => { await c?.query("ROLLBACK"); c?.release(); await pool?.end(); });

  const rec = (governanceException?: string | null) => repo.record({
    tenantId: tenant, userId: user, entityType: "risk", entityId: "00000000-0000-4000-8000-000000000001", action: "UPDATE",
    oldValue: null, newValue: { a: 1 }, reason: null, requestId: "req", governanceException,
  });

  it("writes and reads the marker; an ordinary event reads null", async () => {
    await rec("noSelfValidation");
    await rec();
    const all = await repo.listRecent(tenant, 10);
    expect(all.map((e) => e.governanceException)).toHaveLength(2);
    expect(all.map((e) => e.governanceException)).toContain("noSelfValidation");
    expect(all.map((e) => e.governanceException)).toContain(null);
  });

  it("search filters on one rule, or on any marked row", async () => {
    await rec("riskappetite.adminAlone");
    expect((await repo.search(tenant, { governanceException: "noSelfValidation" }, 10)).length).toBe(1);
    expect((await repo.search(tenant, { governanceException: true }, 10)).length).toBe(2);
    expect((await repo.search(tenant, {}, 10)).length).toBe(3);
  });

  it("configs.self_validation_policy defaults to REFUSE and refuses other values", async () => {
    const col = await c.query(`SELECT column_default FROM information_schema.columns WHERE table_name = 'configs' AND column_name = 'self_validation_policy'`);
    expect(col.rows[0].column_default).toContain("REFUSE");
    await c.query("SAVEPOINT s");
    await expect(c.query(`INSERT INTO configs (tenant_id, self_validation_policy) VALUES ($1, 'ALLOW')`, [tenant])).rejects.toMatchObject({ code: "23514" });
    await c.query("ROLLBACK TO SAVEPOINT s");
  });

  it("audit_log stays append-only (UPDATE still refused)", async () => {
    await c.query("SAVEPOINT s");
    await expect(c.query(`UPDATE audit_log SET governance_exception = 'x' WHERE tenant_id = $1`, [tenant])).rejects.toBeTruthy();
    await c.query("ROLLBACK TO SAVEPOINT s");
  });
});
