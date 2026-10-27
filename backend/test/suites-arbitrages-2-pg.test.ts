import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { ConfigService } from "../src/services/ConfigService.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { PostgresSelfValidationPolicyRequestRepository } from "../src/infrastructure/database/postgres/PostgresSelfValidationPolicyRequestRepository.js";
import { PostgresGovernanceDelayRequestRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceDelayRequestRepository.js";
import { PostgresGovernancePrincipleAcceptanceRepository } from "../src/infrastructure/database/postgres/PostgresGovernancePrincipleAcceptanceRepository.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * DECISION-095 on real PostgreSQL (skipped unless QA_SWP_PGHOST is a unix socket directory; needs 001..076):
 * q182 delay requests (076: default 60, guard, expiry recheck in the claim), q178 vacancy since, q181 latest alone review.
 * governance_delay_requests is append-only: run it on a disposable database only.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";

describe.skipIf(!HOST.startsWith("/"))("suites des arbitrages 2 (real PostgreSQL)", () => {
  let pool: Pool;
  let tenant = "";
  let admin = "";
  let approver = "";
  const actorOf = (userId: string, roles: string[]): AuthenticatedUser =>
    ({ userId, tenantId: tenant, email: "a@x.test", displayName: "a", roles }) as unknown as AuthenticatedUser;
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];
  const service = () => {
    const queries = new PostgresGovernanceQueries(pool);
    return new ConfigService(
      new PostgresConfigRepository(pool), new PostgresAuditRepository(pool), undefined, undefined, queries,
      new PostgresSelfValidationPolicyRequestRepository(pool), new PostgresGovernanceDelayRequestRepository(pool),
    );
  };

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 4 });
    tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`sa2-${Date.now()}`])).id;
    const user = async (tag: string, roles: string[]) =>
      (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, $2, $3) RETURNING id`, [tenant, `${tag}-${Math.random()}@sa2`, roles])).id as string;
    admin = await user("admin", ["config.governancedelays.set"]);
    approver = await user("rm", ["config.selfvalidation.approve"]);
  });
  afterAll(async () => { await pool?.end(); });

  it("q178 default 60 on a new config row; q182 lengthening -> PENDING row, approved by a third party, audited in one transaction", async () => {
    const svc = service();
    const adminActor = actorOf(admin, ["config.governancedelays.set"]);
    const { config } = await svc.setGovernanceDelays(adminActor, { acceptanceMaxDays: 10 }, "init", "sa2-1");
    expect(config.riskManagerVacancyMaxDays).toBe(60);
    const { pendingRequest } = await svc.setGovernanceDelays(adminActor, { riskManagerVacancyMaxDays: 120 }, "Allonger", "sa2-2");
    expect(pendingRequest).toMatchObject({ status: "PENDING", requestedDelays: { riskManagerVacancyMaxDays: 120 } });
    await expect(pool.query(`UPDATE governance_delay_requests SET reason = 'x' WHERE id = $1`, [pendingRequest!.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM governance_delay_requests WHERE id = $1`, [pendingRequest!.id])).rejects.toThrow(/never deleted/);
    const applied = await svc.approveGovernanceDelays(actorOf(approver, ["config.selfvalidation.approve"]), pendingRequest!.id, "ok", "sa2-3");
    expect(applied.riskManagerVacancyMaxDays).toBe(120);
    const audit = await pool.query(`SELECT entity_type, action FROM audit_log WHERE tenant_id = $1 AND request_id IN ('sa2-2','sa2-3') ORDER BY "timestamp"`, [tenant]);
    expect(audit.rows).toEqual([{ entity_type: "GovernanceDelayRequest", action: "SUBMIT" }, { entity_type: "Config", action: "APPROVE" }]);
  });

  it("q182: the claim rechecks the expiry inside the transaction", async () => {
    const svc = service();
    const { pendingRequest } = await svc.setGovernanceDelays(actorOf(admin, ["config.governancedelays.set"]), { acceptanceMaxDays: null }, "Retirer", "sa2-4");
    // Moving the expiry backwards is refused by the guard (content immutable), so the repository is asked directly with a
    // request whose row really is expired: a fresh one submitted with an expiry in the past.
    await pool.query(`UPDATE governance_delay_requests SET status = 'WITHDRAWN', decided_by = $2, decided_at = now() WHERE id = $1`, [pendingRequest!.id, admin]);
    const expired = (await one(
      `INSERT INTO governance_delay_requests (tenant_id, requested_delays, reason, requested_by, expires_at) VALUES ($1, '{"acceptanceMaxDays": null}', 'r', $2, now() - interval '1 day') RETURNING id`,
      [tenant, admin],
    )).id;
    const repo = new PostgresGovernanceDelayRequestRepository(pool);
    await expect(repo.change(tenant, { decide: { id: expired, status: "APPLIED", by: approver, reason: "ok" } }, () => [])).rejects.toThrow(ConflictError);
    await expect(repo.change(tenant, { decide: { id: expired, status: "REJECTED", by: approver, reason: "échue" } }, () => [])).resolves.toMatchObject({ decided: { status: "REJECTED" } });
  });

  it("q178 vacancy since: the last vacancy trace while the Risk Manager group has no active member", async () => {
    const q = new PostgresGovernanceQueries(pool);
    expect(await q.riskManagerVacancySince(tenant)).toBeNull();
    const at = (await one(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception)
       VALUES ($1, $2, 'Role', gen_random_uuid(), 'ROLE_CHANGE', 'sa2-v', 'riskManager.vacancy') RETURNING "timestamp"`, [tenant, admin])).timestamp as Date;
    expect((await q.riskManagerVacancySince(tenant))?.getTime()).toBe(at.getTime());
    const role = (await one(`INSERT INTO roles (tenant_id, name, system_group, permissions) VALUES ($1, 'RM', 'RISK_MANAGER', '{risk.read}') RETURNING id`, [tenant])).id;
    await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [tenant, role, approver, admin]);
    expect(await q.riskManagerVacancySince(tenant)).toBeNull();
  });

  it("q181 latest alone acceptance: open while valid, reviewed once a REVIEWED review points at its marked row", async () => {
    const repo = new PostgresGovernancePrincipleAcceptanceRepository(pool);
    expect(await repo.latestAloneReview(tenant, "GOV-SA2-01")).toBeNull();
    const { acceptance } = await repo.create(
      { tenantId: tenant, principleId: "GOV-SA2-01", catalogVersion: "0.3", offendersSnapshot: [], reason: "seul", expiresAt: new Date(Date.now() + 86_400_000), acceptedBy: admin, status: "ACTIVE", regime: "ALONE" },
      ({ acceptance: a }) => [{ tenantId: tenant, userId: admin, entityType: "GovernancePrincipleAcceptance", entityId: a.id, action: "CREATE", oldValue: null, newValue: a, reason: "seul", requestId: "sa2-a", governanceException: "principle.acceptance.alone" }],
    );
    expect(await repo.latestAloneReview(tenant, "GOV-SA2-01")).toEqual({ acceptanceId: acceptance.id, reviewed: false, open: true });
    const row = (await one(`SELECT id FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 AND governance_exception IS NOT NULL`, [tenant, acceptance.id])).id;
    await pool.query(`INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'vu')`, [tenant, row, approver]);
    expect(await repo.latestAloneReview(tenant, "GOV-SA2-01")).toMatchObject({ reviewed: true });
  });
});
