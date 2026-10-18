import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresGovernanceDesignationRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceDesignationRepository.js";
import { ConflictError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// D2c on real PostgreSQL. Needs a DEDICATED database that already has migration 070 (never the shared QA base, never Neon):
//   QA_D2C_PGDB=grc_d2c QA_SWP_PGHOST=/tmp/claude-0/pgsock QA_SWP_PGPORT=5531
const PGHOST = process.env.QA_SWP_PGHOST ?? "";
const PGDB = process.env.QA_D2C_PGDB ?? "";

describe.skipIf(!PGHOST.startsWith("/") || !PGDB)("D2c: designations and hand-over of the last Risk Manager (real PostgreSQL)", () => {
  let pool: pg.Pool;
  const one = async (sql: string, p: unknown[] = []) => ((await pool.query(sql, p)).rows[0] ?? {}) as Record<string, string>;
  beforeAll(() => { pool = new pg.Pool({ host: PGHOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: PGDB, max: 3 }); });
  afterAll(async () => { await pool.end(); });

  async function world() {
    const tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`d2c-${Date.now()}-${Math.random()}`]))["id"] as string;
    const mkUser = async (n: string) =>
      (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,$3) RETURNING id`, [tenant, `${n}-${Math.random()}@x`, n]))["id"] as string;
    const [admin, leaving, interim] = [await mkUser("admin"), await mkUser("leaving"), await mkUser("interim")] as [string, string, string];
    const rm = (await one(
      `INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,'Risk Manager','{risk.read}','RISK_MANAGER') RETURNING id`, [tenant],
    ))["id"] as string;
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [tenant, rm, leaving, admin]);
    const designations = new PostgresGovernanceDesignationRepository(pool);
    const roles = new PostgresRoleRepository(pool);
    const event = (entityId: string, reason: string) => ({
      tenantId: tenant, userId: admin, entityType: "Role", entityId, action: "ROLE_CHANGE" as const,
      oldValue: null, newValue: null, reason, requestId: "r",
    });
    return { tenant, admin, leaving, interim, rm, designations, roles, event };
  }
  const activeMembers = async (tenant: string, rm: string) =>
    (await pool.query(`SELECT user_id FROM user_roles WHERE tenant_id=$1 AND role_id=$2 AND revoked_at IS NULL`, [tenant, rm])).rows.map((r) => r.user_id as string);

  it("table rules: interim needs an end date, no self-designation, one active per kind, soft end only", async () => {
    const w = await world();
    const base = { tenantId: w.tenant, kind: "RISK_MANAGER_INTERIM" as const, userId: w.interim, reason: "x", designatedBy: w.admin };
    await expect(w.designations.create({ ...base, validUntil: null })).rejects.toThrow();
    await expect(w.designations.create({ ...base, userId: w.admin, validUntil: new Date(Date.now() + 1e9) })).rejects.toThrow();
    const d = await w.designations.create({ ...base, validUntil: new Date(Date.now() + 1e9) });
    await expect(w.designations.create({ ...base, validUntil: new Date(Date.now() + 1e9) })).rejects.toThrow(ConflictError);
    expect(await w.designations.getActive(w.tenant, "RISK_MANAGER_INTERIM")).toMatchObject({ id: d.id });
    expect(await w.designations.end("00000000-0000-4000-8000-000000000000", d.id, w.admin, "x")).toBeNull(); // other tenant
    expect(await w.designations.end(w.tenant, d.id, w.admin, "fin")).toMatchObject({ endReason: "fin" });
    expect(await w.designations.end(w.tenant, d.id, w.admin, "again")).toBeNull();
    expect(await w.designations.getActive(w.tenant, "RISK_MANAGER_INTERIM")).toBeNull();
  });

  it("hand-over: leaving revoked, interim assigned, designation activated, both audits, exactly one member", async () => {
    const w = await world();
    const d = await w.designations.create({ tenantId: w.tenant, kind: "RISK_MANAGER_INTERIM", userId: w.interim, reason: "x", validUntil: new Date(Date.now() + 1e9), designatedBy: w.admin });
    const a = await w.roles.handOverLastRiskManager!({
      tenantId: w.tenant, roleId: w.rm, leavingUserId: w.leaving, interimUserId: w.interim, designationId: d.id, grantedBy: w.admin,
      audit: (assignment) => [w.event(w.rm, "départ"), { ...w.event(w.rm, "départ"), newValue: assignment }],
    });
    expect(await activeMembers(w.tenant, w.rm)).toEqual([w.interim]);
    expect(a.grantedBy).toBe(w.admin);
    const after = await w.designations.getById(w.tenant, d.id);
    expect(after?.activatedAt).not.toBeNull();
    expect(after?.activatedRef).toBe(a.id);
    expect(Number((await one(`SELECT count(*) AS c FROM audit_log WHERE tenant_id=$1 AND entity_id=$2`, [w.tenant, w.rm]))["c"])).toBe(2);
    // revoke-then-assign order: 062's trigger never saw two Risk Managers, so the bootstrap is not ended by the hand-over
    expect((await one(`SELECT risk_framework_bootstrap_ended_at AS e FROM tenants WHERE id=$1`, [w.tenant]))["e"] ?? null).toBeNull();
    // the designation is used: a second hand-over with it is refused
    await expect(w.roles.handOverLastRiskManager!({
      tenantId: w.tenant, roleId: w.rm, leavingUserId: w.interim, interimUserId: w.interim, designationId: d.id, grantedBy: w.admin, audit: () => [],
    })).rejects.toThrow(ConflictError);
  });

  it("hand-over refused (and rolled back) when the group has another member, or the designation is expired", async () => {
    const w = await world();
    const other = (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,'o') RETURNING id`, [w.tenant, `o-${Math.random()}@x`]))["id"] as string;
    const d = await w.designations.create({ tenantId: w.tenant, kind: "RISK_MANAGER_INTERIM", userId: w.interim, reason: "x", validUntil: new Date(Date.now() + 1e9), designatedBy: w.admin });
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4)`, [w.tenant, w.rm, other, w.admin]);
    const input = { tenantId: w.tenant, roleId: w.rm, leavingUserId: w.leaving, interimUserId: w.interim, designationId: d.id, grantedBy: w.admin, audit: () => [w.event(w.rm, "x")] };
    await expect(w.roles.handOverLastRiskManager!(input)).rejects.toThrow(ConflictError);
    expect((await activeMembers(w.tenant, w.rm)).sort()).toEqual([w.leaving, other].sort());
    await pool.query(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id=$1 AND user_id=$2`, [w.tenant, other]);
    // 070 makes valid_until immutable: forge the expiry with the guard switched off (owner session), then back on.
    await pool.query(`ALTER TABLE governance_designations DISABLE TRIGGER governance_designations_guard`);
    try { await pool.query(`UPDATE governance_designations SET valid_until = now() - interval '1 second' WHERE id=$1`, [d.id]); }
    finally { await pool.query(`ALTER TABLE governance_designations ENABLE TRIGGER governance_designations_guard`); }
    await expect(w.roles.handOverLastRiskManager!(input)).rejects.toThrow(ConflictError);
    expect(await activeMembers(w.tenant, w.rm)).toEqual([w.leaving]);
  });

  it("vacancy exit: revoke with its audit (governance_exception) in one transaction; without the audit option the guard still holds", async () => {
    const w = await world();
    await expect(w.roles.revokeFromUser(w.tenant, w.rm, w.leaving, { minRemaining: 1 })).rejects.toThrow(ValidationError);
    await w.roles.revokeFromUser(w.tenant, w.rm, w.leaving, { auditEvents: [{ ...w.event(w.rm, "démission"), governanceException: "riskManager.vacancy" }] });
    expect(await activeMembers(w.tenant, w.rm)).toEqual([]);
    expect((await one(`SELECT governance_exception AS g FROM audit_log WHERE tenant_id=$1 AND entity_id=$2`, [w.tenant, w.rm]))["g"]).toBe("riskManager.vacancy");
  });
});
