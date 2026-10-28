import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { PostgresGovernancePrincipleAcceptanceRepository } from "../src/infrastructure/database/postgres/PostgresGovernancePrincipleAcceptanceRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { ConflictError, ForbiddenError } from "../src/domain/errors/DomainErrors.js";

/**
 * Real-PostgreSQL checks of migration 073. Gated on an EXPLICIT disposable database (D5_PGDB): both tables are
 * append-only, so the rows written here cannot be removed. Never the shared QA database.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const DB = process.env.D5_PGDB ?? "";
const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations/073_governance_reviews_acceptances.sql");

describe.skipIf(!HOST.startsWith("/") || !DB)("migration 073 (real PostgreSQL)", () => {
  let pool: Pool;
  let tenant = ""; let other = ""; let author = ""; let rev = ""; let outsider = ""; let auditId = "";
  const day = 86_400_000;

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: DB, max: 4 });
    await pool.query(readFileSync(MIGRATION, "utf8"));
    tenant = (await pool.query(`INSERT INTO tenants (name) VALUES ('d5') RETURNING id`)).rows[0].id;
    other = (await pool.query(`INSERT INTO tenants (name) VALUES ('d5-other') RETURNING id`)).rows[0].id;
    const mk = async (t: string, e: string) => (await pool.query(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, e])).rows[0].id as string;
    author = await mk(tenant, "a@d5"); rev = await mk(tenant, "r@d5"); outsider = await mk(other, "o@d5");
    auditId = (await pool.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception)
       VALUES ($1, $2, 'Finding', gen_random_uuid(), 'CLOSE', 'req-d5', 'noSelfValidation') RETURNING id`, [tenant, author])).rows[0].id;
    const role = (await pool.query(`INSERT INTO roles (tenant_id, name, system_group, permissions) VALUES ($1, 'AU', 'AUDIT', '{audit.read}') RETURNING id`, [tenant])).rows[0].id;
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [tenant, role, rev, author]);
  });
  afterAll(async () => { await pool?.end(); });

  it("reviews: add-only, never by the author, tenant FK, once per reviewer, REVIEWED lifts the independence label", async () => {
    const repo = new PostgresGovernanceExceptionReviewRepository(pool);
    const q = new PostgresGovernanceQueries(pool);
    const entry = await repo.getAuditEntry(tenant, auditId);
    expect(entry).toMatchObject({ reviewable: true, userId: author });
    expect(await repo.getAuditEntry(other, auditId)).toBeNull();
    const audit = (r: { id: string }) => [{ tenantId: tenant, userId: rev, entityType: "GovernanceExceptionReview", entityId: r.id, action: "CREATE" as const, oldValue: null, newValue: null, reason: "c", requestId: "x" }];
    await expect(repo.insert({ tenantId: tenant, auditLogId: auditId, outcome: "REVIEWED", reviewedBy: author, comment: "c" }, audit)).rejects.toThrow(ForbiddenError);
    await expect(repo.insert({ tenantId: tenant, auditLogId: auditId, outcome: "REVIEWED", reviewedBy: outsider, comment: "c" }, audit)).rejects.toMatchObject({ code: "23503" });
    await expect(repo.insert({ tenantId: other, auditLogId: auditId, outcome: "REVIEWED", reviewedBy: outsider, comment: "c" }, audit)).rejects.toThrow(ForbiddenError);
    const marker = (await q.forEntities(tenant, "Finding", [entry!.entityId])).get(entry!.entityId);
    expect(marker).toBe("WITHOUT_INDEPENDENT_REVIEW");
    expect(await q.unreviewedExceptionCount(tenant)).toBe(1);
    // a contestation does not count as a review
    await repo.insert({ tenantId: tenant, auditLogId: auditId, outcome: "CONTESTED", reviewedBy: rev, comment: "non" }, audit);
    expect((await q.forEntities(tenant, "Finding", [entry!.entityId])).get(entry!.entityId)).toBe("WITHOUT_INDEPENDENT_REVIEW");
    await expect(repo.insert({ tenantId: tenant, auditLogId: auditId, outcome: "REVIEWED", reviewedBy: rev, comment: "c" }, audit)).rejects.toThrow(ConflictError);
    expect(await q.holdersOf(tenant, "audit.read")).toEqual([rev]);
    expect((await q.groupMembers(tenant, ["AUDIT"]))).toEqual([rev]);
    await expect(pool.query(`UPDATE governance_exception_reviews SET comment = 'x'`)).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`DELETE FROM governance_exception_reviews`)).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`TRUNCATE governance_exception_reviews`)).rejects.toMatchObject({ code: "42501" });
  });

  it("a REVIEWED review by a third party makes the object REVIEWED_BY_THIRD_PARTY", async () => {
    const e2 = (await pool.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception)
       VALUES ($1, $2, 'Finding', gen_random_uuid(), 'CLOSE', 'req-d5b', 'noSelfValidation') RETURNING id, entity_id`, [tenant, author])).rows[0];
    await pool.query(`INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'vu')`, [tenant, e2.id, rev]);
    const q = new PostgresGovernanceQueries(pool);
    expect((await q.forEntities(tenant, "Finding", [e2.entity_id])).get(e2.entity_id)).toBe("REVIEWED_BY_THIRD_PARTY");
    const rows = await q.rowsForRequest(tenant, "req-d5b", author);
    expect(rows).toHaveLength(1);
    expect(await q.rowsForRequest(tenant, "req-d5b", rev)).toEqual([]);
    // Codex PR #199: a pending delay request (no exception marker) reaches the notifier.
    await pool.query(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id)
       VALUES ($1, $2, 'GovernanceDelayRequest', gen_random_uuid(), 'SUBMIT', 'req-d5c')`, [tenant, author]);
    expect((await q.rowsForRequest(tenant, "req-d5c", author)).map((r) => r.entityType)).toEqual(["GovernanceDelayRequest"]);
  });

  it("acceptances: pending/confirm maker-checker in base, one open per principle, expired one replaced, terminal states frozen", async () => {
    const repo = new PostgresGovernancePrincipleAcceptanceRepository(pool);
    const input = (status: "PENDING" | "ACTIVE", principleId = "GOV-SOD-01") => ({
      tenantId: tenant, principleId, catalogVersion: "0.3", offendersSnapshot: [], reason: "r", expiresAt: new Date(Date.now() + day),
      acceptedBy: author, status, regime: status === "ACTIVE" ? ("ALONE" as const) : null,
    });
    const noAudit = () => [];
    const a = await repo.create(input("PENDING"), noAudit);
    await expect(repo.create(input("PENDING"), noAudit)).rejects.toThrow(ConflictError);
    await expect(pool.query(`UPDATE governance_principle_acceptances SET status = 'ACTIVE', regime = 'CONFIRMED', confirmed_by = accepted_by, confirmed_at = now() WHERE id = $1`, [a.acceptance.id]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query(`UPDATE governance_principle_acceptances SET reason = 'autre' WHERE id = $1`, [a.acceptance.id])).rejects.toMatchObject({ code: "42501" });
    const confirmed = await repo.confirm(tenant, a.acceptance.id, rev, noAudit);
    expect(confirmed).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", confirmedBy: rev });
    await expect(repo.confirm(tenant, a.acceptance.id, rev, noAudit)).rejects.toThrow(ConflictError);
    const revoked = await repo.end(tenant, a.acceptance.id, "REVOKED", rev, "fin", noAudit);
    expect(revoked.status).toBe("REVOKED");
    await expect(repo.end(tenant, a.acceptance.id, "REVOKED", rev, "fin", noAudit)).rejects.toThrow(ConflictError);
    await expect(pool.query(`UPDATE governance_principle_acceptances SET status = 'ACTIVE' WHERE id = $1`, [a.acceptance.id])).rejects.toMatchObject({ code: "42501" });
    await expect(pool.query(`DELETE FROM governance_principle_acceptances`)).rejects.toMatchObject({ code: "42501" });

    // an ACTIVE acceptance that has expired is closed and replaced when the principle is accepted again
    const e = await repo.create(input("ACTIVE", "GOV-SOD-02"), noAudit);
    await pool.query(`ALTER TABLE governance_principle_acceptances DISABLE TRIGGER governance_principle_acceptances_guard`);
    await pool.query(`ALTER TABLE governance_principle_acceptances DISABLE TRIGGER USER`);
    await pool.query(`UPDATE governance_principle_acceptances SET accepted_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE id = $1`, [e.acceptance.id]);
    await pool.query(`ALTER TABLE governance_principle_acceptances ENABLE TRIGGER USER`);
    const again = await repo.create(input("ACTIVE", "GOV-SOD-02"), noAudit);
    expect(again.expiredClosed?.id).toBe(e.acceptance.id);
    expect(again.expiredClosed?.status).toBe("REVOKED");
    expect(again.acceptance.status).toBe("ACTIVE");
  });
});
