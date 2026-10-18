import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresOrganizationProfileRepository } from "../src/infrastructure/database/postgres/PostgresOrganizationProfileRepository.js";
import { ConflictError, NotFoundError } from "../src/domain/errors/DomainErrors.js";

/**
 * Real-PostgreSQL checks of migration 071. Gated on an EXPLICIT disposable database (D3_PGDB): the table is append-only,
 * so the rows this test writes cannot be removed. Never point it at the shared QA database.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const DB = process.env.D3_PGDB ?? "";
const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations/071_organization_profiles.sql");
const answers = { Q1: 40, Q2: 1, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO" } as const;

describe.skipIf(!HOST.startsWith("/") || !DB)("organization_profiles (migration 071, real PostgreSQL)", () => {
  let pool: Pool; let repo: PostgresOrganizationProfileRepository;
  let tenant = ""; let author = ""; let checker = ""; let rm2 = "";
  const noAudit = () => [];
  const input = (status: "ACTIVE" | "PENDING", by = author) => ({
    tenantId: tenant, questionnaireVersion: "0.3", answers: { ...answers }, reason: "test", submittedBy: by, status, regime: null,
  });

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: DB, max: 4 });
    await pool.query(readFileSync(MIGRATION, "utf8")); // idempotent
    repo = new PostgresOrganizationProfileRepository(pool);
    tenant = (await pool.query(`INSERT INTO tenants (name) VALUES ('d3-pg') RETURNING id`)).rows[0].id;
    const mk = async (e: string) => (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [tenant, e])).rows[0].id as string;
    author = await mk("a@d3"); checker = await mk("c@d3"); rm2 = await mk("r@d3");
    const role = (await pool.query(`INSERT INTO roles (tenant_id, name, system_group, permissions) VALUES ($1, 'RM', 'RISK_MANAGER', '{}') RETURNING id`, [tenant])).rows[0].id;
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [tenant, role, rm2, author]);
  });
  afterAll(async () => { await pool?.end(); });

  it("observes active accounts and group members; counts the third parties other than the author", async () => {
    expect(await repo.observe(tenant)).toEqual({ activeAccounts: 3, riskManagers: 1, committeeMembers: 0, auditMembers: 0 });
    expect(await repo.countOtherGovernanceMembers(tenant, author)).toBe(1);
    expect(await repo.countOtherGovernanceMembers(tenant, rm2)).toBe(0);
    // q157: an Audit member is observed but is not a possible approver
    const auditRole = (await pool.query(`INSERT INTO roles (tenant_id, name, system_group, permissions) VALUES ($1, 'AU', 'AUDIT', '{}') RETURNING id`, [tenant])).rows[0].id;
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [tenant, auditRole, checker, author]);
    expect(await repo.countOtherGovernanceMembers(tenant, author)).toBe(1);
  });

  it("numbers versions, keeps one ACTIVE and writes the audit in the same transaction", async () => {
    const audit = ({ profile }: { profile: { id: string } }) => [{
      tenantId: tenant, userId: author, entityType: "OrganizationProfile", entityId: profile.id, action: "SUBMIT" as const,
      oldValue: null, newValue: null, reason: "test", requestId: "r", governanceException: null,
    }];
    const a = await repo.insertVersion(input("ACTIVE"), audit);
    const b = await repo.insertVersion(input("ACTIVE"), audit);
    expect([a.profile.version, b.profile.version]).toEqual([1, 2]);
    expect(b.superseded?.id).toBe(a.profile.id);
    expect((await repo.getActive(tenant))!.id).toBe(b.profile.id);
    const n = await pool.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1 AND action = 'SUBMIT'`, [tenant]);
    expect(n.rows[0].n).toBe(2);
  });

  it("allows a single PENDING; approval by someone else supersedes the active; the author cannot decide (CHECK)", async () => {
    const p = await repo.insertVersion(input("PENDING"), noAudit);
    await expect(repo.insertVersion(input("PENDING"), noAudit)).rejects.toThrow(ConflictError);
    await expect(pool.query(`UPDATE organization_profiles SET status = 'ACTIVE', regime = 'CONFIRMED', decided_by = submitted_by, decided_at = now() WHERE id = $1`, [p.profile.id]))
      .rejects.toMatchObject({ code: "23514" });
    const before = await repo.getActive(tenant);
    const done = await repo.approve(tenant, p.profile.id, checker, noAudit);
    expect(done.profile).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", decidedBy: checker });
    expect(done.superseded?.id).toBe(before!.id);
    // second approval: nothing pending -> NotFound, and the supersede is rolled back
    await expect(repo.approve(tenant, p.profile.id, checker, noAudit)).rejects.toThrow(NotFoundError);
    expect((await repo.getActive(tenant))!.id).toBe(p.profile.id);
  });

  it("rejection is kept with its reason", async () => {
    const p = await repo.insertVersion(input("PENDING"), noAudit);
    const r = await repo.reject(tenant, p.profile.id, checker, "non", () => []);
    expect(r).toMatchObject({ status: "REJECTED", decisionReason: "non" });
  });

  it("content is immutable, rows are never deleted or truncated, statuses only move forward", async () => {
    const id = (await repo.getActive(tenant))!.id;
    await expect(pool.query(`UPDATE organization_profiles SET answers = '{}' WHERE id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`UPDATE organization_profiles SET status = 'PENDING' WHERE id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`DELETE FROM organization_profiles WHERE id = $1`, [id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`TRUNCATE organization_profiles`)).rejects.toMatchObject({ code: "42501" });
  });
});
