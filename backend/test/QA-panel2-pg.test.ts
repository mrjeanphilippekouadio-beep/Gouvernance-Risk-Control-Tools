import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresSelfValidationPolicyRequestRepository } from "../src/infrastructure/database/postgres/PostgresSelfValidationPolicyRequestRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { PostgresGovernancePrincipleAcceptanceRepository } from "../src/infrastructure/database/postgres/PostgresGovernancePrincipleAcceptanceRepository.js";
import { PostgresControlExecutionRepository } from "../src/infrastructure/database/postgres/PostgresControlExecutionRepository.js";
import { PostgresControlRepository } from "../src/infrastructure/database/postgres/PostgresControlRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresGovernanceDesignationRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceDesignationRepository.js";
import { PostgresOrganizationProfileRepository } from "../src/infrastructure/database/postgres/PostgresOrganizationProfileRepository.js";
import { PostgresProcessRepository } from "../src/infrastructure/database/postgres/PostgresProcessRepository.js";
import { OrganizationProfileService } from "../src/services/OrganizationProfileService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { QUESTIONNAIRE_VERSION } from "../src/domain/governance/organizationQuestionnaire.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import { GovernanceExceptionService } from "../src/services/GovernanceExceptionService.js";
import { GovernancePrincipleAcceptanceService } from "../src/services/GovernancePrincipleAcceptanceService.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { RoleService } from "../src/services/RoleService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { governanceExceptionsRouter } from "../src/api/v1/governanceExceptions.routes.js";
import { governancePrincipleAcceptancesRouter } from "../src/api/v1/governancePrincipleAcceptances.routes.js";
import { governanceNotificationsMiddleware } from "../src/api/middleware/governanceNotifications.js";
import { requestIdMiddleware } from "../src/api/middleware/requestId.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { FIXED_GROUP_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-panel2 on REAL PostgreSQL (socket, never Neon). Skipped unless QA_SWP_PGHOST is a unix socket directory.
 *   QA_SWP_PGHOST=/tmp/claude-0/pgsock QA_SWP_PGPORT=5531 QA_SWP_PGDB=grc_qa_a08 (default), migrations 001..073 applied.
 * Every test builds its own tenant. Oracles are in the test titles (written before running).
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const BLOCK = "QA_P2_BLOCK";
const ZWSP = "​";

const asUser = (tenantId: string, userId: string, roles: string[]): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x`, displayName: userId, roles }) as unknown as AuthenticatedUser;

describe.skipIf(!HOST.startsWith("/"))("QA-panel2 real PostgreSQL", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 12, application_name: "qa-panel2" });
    await pool.query(`CREATE OR REPLACE FUNCTION qa_p2_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_P2 audit insert refused'; END $$`);
    await pool.query(`DROP TRIGGER IF EXISTS qa_p2_block ON audit_log`);
    await pool.query(`CREATE TRIGGER qa_p2_block BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.reason = '${BLOCK}') EXECUTE FUNCTION qa_p2_block()`);
  });
  afterAll(async () => {
    await pool?.query(`DROP TRIGGER IF EXISTS qa_p2_block ON audit_log`);
    await pool?.query(`DROP FUNCTION IF EXISTS qa_p2_block()`);
    await pool?.end();
  });

  const rows = async <T extends object = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows;
  const one = async <T = string>(sql: string, p: unknown[] = []) => ((await pool.query(sql, p)).rows[0] ?? {}) as Record<string, T>;

  /** A tenant with fixed-group roles carrying the REAL permission sets of the code. */
  async function world() {
    const tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qa-p2-${randomUUID()}`]))["id"]!;
    const user = async (n: string) =>
      (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,$3) RETURNING id`, [tenant, `${n}-${randomUUID()}@qa-p2.test`, n]))["id"]!;
    const role = async (name: string, permissions: string[], systemGroup: string | null = null) =>
      (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, name, permissions, systemGroup]))["id"]!;
    const grant = async (roleId: string, userId: string, by: string) =>
      (await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, roleId, userId, by]))["id"]!;
    const rmRole = await role("Risk Manager", FIXED_GROUP_PERMISSIONS.RISK_MANAGER as string[], "RISK_MANAGER");
    const committeeRole = await role("Comité", FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE as string[], "RISK_COMMITTEE");
    const auditRole = await role("Audit", FIXED_GROUP_PERMISSIONS.AUDIT as string[], "AUDIT");
    const adminRole = await role("Admin", ["config.read", "config.selfvalidation.set", "governanceprinciple.accept", "governanceprinciple.acceptance.revoke", "governancehealth.read"]);
    const admin = await user("admin"); await grant(adminRole, admin, admin);
    const rm = await user("rm"); await grant(rmRole, rm, admin);
    const committee = await user("committee"); await grant(committeeRole, committee, admin);
    const audit = await user("audit"); await grant(auditRole, audit, admin);
    const as = (id: string, roles: string[]) => asUser(tenant, id, roles);
    const adminActor = (id = admin) => as(id, ["config.read", "config.selfvalidation.set", "governanceprinciple.accept", "governanceprinciple.acceptance.revoke", "governancehealth.read", "audit.read"]);
    const rmActor = (id = rm) => as(id, [...(FIXED_GROUP_PERMISSIONS.RISK_MANAGER as string[]), "config.read"]);
    const committeeActor = (id = committee) => as(id, [...(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE as string[]), "config.read"]);
    const auditActor = (id = audit) => as(id, FIXED_GROUP_PERMISSIONS.AUDIT as string[]);
    const suspend = (id: string) => pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [id]);
    const auditRows = (entityType: string, entityId?: string) =>
      rows<{ action: string; governance_exception: string | null; user_id: string; new_value: Record<string, unknown> | null; reason: string | null; entity_id: string }>(
        `SELECT action, governance_exception, user_id, new_value, reason, entity_id FROM audit_log WHERE tenant_id = $1 AND entity_type = $2 ${entityId ? "AND entity_id = $3" : ""} ORDER BY "timestamp", id`,
        entityId ? [tenant, entityType, entityId] : [tenant, entityType]);
    return { tenant, user, role, grant, rmRole, committeeRole, auditRole, adminRole, admin, rm, committee, audit, as, adminActor, rmActor, committeeActor, auditActor, suspend, auditRows };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const governance = () => new PostgresGovernanceQueries(pool);
  const auditRepo = () => new PostgresAuditRepository(pool);
  const configSvc = () => new ConfigService(new PostgresConfigRepository(pool), auditRepo(), undefined, undefined, governance(), new PostgresSelfValidationPolicyRequestRepository(pool));
  const policyOf = async (tenant: string) => (await rows<{ p: string; updated_by: string | null }>(`SELECT self_validation_policy AS p, updated_by FROM configs WHERE tenant_id = $1`, [tenant]))[0] ?? { p: "REFUSE", updated_by: null };
  const requestsOf = (tenant: string) => rows<{ id: string; status: string; requested_by: string; decided_by: string | null; decision_reason: string | null }>(
    `SELECT id, status, requested_by, decided_by, decision_reason FROM self_validation_policy_requests WHERE tenant_id = $1 ORDER BY requested_at, id`, [tenant]);

  // =============================================================================================================
  // (2a) q158: the two-person circuit for relaxing the self-validation policy
  // =============================================================================================================
  describe("q158 circuit", () => {
    it("submit -> pending (policy unchanged); the author (even holding both permissions) cannot approve, in the service and in the database; another approver applies it", async () => {
      const w = await world();
      const svc = configSvc();
      const out = await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "demande de l'administrateur", "r1");
      expect(out.pendingRequest).toMatchObject({ status: "PENDING", requestedBy: w.admin });
      expect(out.config.selfValidationPolicy).toBe("REFUSE");
      expect((await policyOf(w.tenant)).p).toBe("REFUSE");
      const id = out.pendingRequest!.id;

      const both = w.as(w.admin, ["config.read", "config.selfvalidation.set", "config.selfvalidation.approve"]);
      await expect(svc.approveSelfValidationPolicy(both, id, "r2")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(svc.rejectSelfValidationPolicy(both, id, "non", "r3")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(pool.query(`UPDATE self_validation_policy_requests SET status='APPLIED', decided_by=requested_by, decided_at=now() WHERE id=$1`, [id])).rejects.toMatchObject({ code: "23514" });
      expect((await requestsOf(w.tenant)).map((r) => r.status)).toEqual(["PENDING"]);

      const cfg = await svc.approveSelfValidationPolicy(w.rmActor(), id, "r4");
      expect(cfg.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
      const after = await policyOf(w.tenant);
      expect(after.p).toBe("DOUBLE_CONFIRMATION");
      expect(after.updated_by).toBe(w.admin); // the maker is recorded as the author of the setting
      expect((await requestsOf(w.tenant))[0]).toMatchObject({ status: "APPLIED", decided_by: w.rm });
      const trail = await w.auditRows("Config");
      expect(trail.map((a) => a.action)).toEqual(["APPROVE"]);
      expect(trail[0]!.user_id).toBe(w.rm);
      expect(trail[0]!.governance_exception).toBeNull(); // a confirmed relaxation is NOT an exception
      expect(trail[0]!.new_value).toMatchObject({ approvedRequestId: id, requestedBy: w.admin });
      expect((await w.auditRows("SelfValidationPolicyRequest")).map((a) => a.action)).toEqual(["SUBMIT"]);

      // the policy really is in force for the gate: a lone maker now gets the confirmation prompt (409), not a refusal
      const gate = new SelfValidationGate(new PostgresConfigRepository(pool), governance());
      await expect(gate.check(w.adminActor(), { isSelf: true, permission: "x.nobody.holds", makerIds: [w.admin], refusal: "no" }))
        .rejects.toMatchObject({ name: "ConflictError", message: expect.stringMatching(/^GOVERNANCE_CONFIRMATION_REQUIRED/) });
    });

    it("who may decide: Audit, an unrelated user, another tenant's approver, a bad id -> refused, nothing changes", async () => {
      const w = await world();
      const other = await world();
      const svc = configSvc();
      const id = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "demande", "r")).pendingRequest!.id;
      for (const who of [w.auditActor(), w.as(w.rm, ["config.read"]), w.as(w.admin, ["config.read", "config.selfvalidation.set"])]) {
        await expect(svc.approveSelfValidationPolicy(who, id, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
        await expect(svc.rejectSelfValidationPolicy(who, id, "motif valable", "r")).rejects.toMatchObject({ name: "ForbiddenError" });
      }
      await expect(svc.getPendingSelfValidationPolicyRequest(w.auditActor())).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(svc.getPendingSelfValidationPolicyRequest(w.as(w.rm, ["config.read"]))).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(await svc.getPendingSelfValidationPolicyRequest(w.rmActor())).toMatchObject({ id });
      expect(await svc.getPendingSelfValidationPolicyRequest(w.adminActor())).toMatchObject({ id });
      // another tenant's approver sees a 404, never the request
      await expect(svc.approveSelfValidationPolicy(other.rmActor(), id, "r")).rejects.toMatchObject({ name: "NotFoundError" });
      await expect(svc.approveSelfValidationPolicy(w.rmActor(), randomUUID(), "r")).rejects.toMatchObject({ name: "NotFoundError" });
      expect(await svc.getPendingSelfValidationPolicyRequest(other.rmActor())).toBeNull();
      expect((await requestsOf(w.tenant)).map((r) => r.status)).toEqual(["PENDING"]);
    });

    it("replacement: a new call withdraws the pending one (WITHDRAWN, by the replacing admin, with CLOSE + SUBMIT audit); the withdrawn one can no longer be approved or rejected", async () => {
      const w = await world();
      const admin2 = await w.user("admin2");
      await w.grant(w.adminRole, admin2, w.admin);
      const svc = configSvc();
      const first = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "première", "r1")).pendingRequest!;
      const second = (await svc.setSelfValidationPolicy(w.adminActor(admin2), "DOUBLE_CONFIRMATION", "seconde", "r2")).pendingRequest!;
      const all = await requestsOf(w.tenant);
      expect(all.map((r) => r.status)).toEqual(["WITHDRAWN", "PENDING"]);
      expect(all[0]).toMatchObject({ id: first.id, decided_by: admin2, decision_reason: "Replaced by a newer change" });
      await expect(svc.approveSelfValidationPolicy(w.rmActor(), first.id, "r")).rejects.toMatchObject({ name: "ValidationError", message: expect.stringMatching(/WITHDRAWN/) });
      await expect(svc.rejectSelfValidationPolicy(w.rmActor(), first.id, "motif valable", "r")).rejects.toMatchObject({ name: "ValidationError" });
      expect((await w.auditRows("SelfValidationPolicyRequest")).map((a) => a.action).sort()).toEqual(["CLOSE", "SUBMIT", "SUBMIT"]); // one transaction = one timestamp: compare as a set
      // collusion is not possible through the replacement: the ORIGINAL author may approve the REPLACEMENT only if he holds the approve right (he is another person than its author)
      const origAuthorAsApprover = w.as(w.admin, ["config.read", "config.selfvalidation.approve"]);
      expect((await svc.approveSelfValidationPolicy(origAuthorAsApprover, second.id, "r3")).selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
    });

    /** A repository whose getPending waits until `n` callers have asked, then answers what each saw at the start: forces a true read-read-write-write interleaving. */
    function barrierRepo(n: number, seen: () => Promise<unknown>) {
      const real = new PostgresSelfValidationPolicyRequestRepository(pool);
      let arrived = 0; let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== "getPending") return Reflect.get(target, prop, receiver);
          return async (tenantId: string) => {
            const before = await seen.call(null);
            arrived += 1; if (arrived >= n) release();
            await gate;
            return before ?? null;
          };
        },
      }) as unknown as PostgresSelfValidationPolicyRequestRepository;
    }
    const svcWith = (repo: PostgresSelfValidationPolicyRequestRepository) => new ConfigService(new PostgresConfigRepository(pool), auditRepo(), undefined, undefined, governance(), repo);

    it("concurrency (forced interleaving): two administrators both saw NO pending request and both submit -> exactly one PENDING, the loser gets ConflictError and leaves no audit row", async () => {
      for (let i = 0; i < 3; i += 1) {
        const w = await world();
        const admin2 = await w.user("admin2");
        await w.grant(w.adminRole, admin2, w.admin);
        const svc = svcWith(barrierRepo(2, async () => null));
        const res = await Promise.allSettled([
          svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "A", "rA"),
          svc.setSelfValidationPolicy(w.adminActor(admin2), "DOUBLE_CONFIRMATION", "B", "rB"),
        ]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const loser = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
        expect((loser.reason as Error).name).toBe("ConflictError");
        expect((await requestsOf(w.tenant)).filter((r) => r.status === "PENDING")).toHaveLength(1);
        expect((await w.auditRows("SelfValidationPolicyRequest")).filter((a) => a.action === "SUBMIT")).toHaveLength(1);
      }
    });

    it("concurrency (forced interleaving): two administrators both saw the SAME pending request and both replace it -> one replacement, the other rolled back whole (its new request never exists)", async () => {
      const w = await world();
      const admin2 = await w.user("admin2");
      await w.grant(w.adminRole, admin2, w.admin);
      const first = (await configSvc().setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r0")).pendingRequest!;
      const real = new PostgresSelfValidationPolicyRequestRepository(pool);
      const svc = svcWith(barrierRepo(2, async () => real.getPending(w.tenant)));
      const res = await Promise.allSettled([
        svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "A", "rA"),
        svc.setSelfValidationPolicy(w.adminActor(admin2), "DOUBLE_CONFIRMATION", "B", "rB"),
      ]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).name).toBe("ConflictError");
      const all = await requestsOf(w.tenant);
      expect(all.map((r) => r.status)).toEqual(["WITHDRAWN", "PENDING"]);
      expect(all[0]!.id).toBe(first.id);
      expect((await w.auditRows("SelfValidationPolicyRequest")).map((a) => a.action).sort()).toEqual(["CLOSE", "SUBMIT", "SUBMIT"]); // one transaction = one timestamp: compare as a set
    });

    it("concurrency (natural timing): two administrators submit at once -> never two PENDING; the second either conflicts or replaces the first, with a coherent trail", async () => {
      for (let i = 0; i < 4; i += 1) {
        const w = await world();
        const admin2 = await w.user("admin2");
        await w.grant(w.adminRole, admin2, w.admin);
        const svc = configSvc();
        const res = await Promise.allSettled([
          svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "A", "rA"),
          svc.setSelfValidationPolicy(w.adminActor(admin2), "DOUBLE_CONFIRMATION", "B", "rB"),
        ]);
        for (const r of res) if (r.status === "rejected") expect((r.reason as Error).name).toBe("ConflictError");
        const all = await requestsOf(w.tenant);
        expect(all.filter((r) => r.status === "PENDING")).toHaveLength(1);
        const submits = (await w.auditRows("SelfValidationPolicyRequest")).filter((a) => a.action === "SUBMIT").length;
        expect(submits).toBe(all.length);
      }
    });

    it("concurrency: approve racing a replacement, and approve racing a reject -> one winner, the other gets a domain error, final state is coherent", async () => {
      for (let i = 0; i < 6; i += 1) {
        const w = await world();
        const admin2 = await w.user("admin2");
        await w.grant(w.adminRole, admin2, w.admin);
        const svc = configSvc();
        const p1 = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P1", "r1")).pendingRequest!;
        const [approve, replace] = await Promise.allSettled([
          svc.approveSelfValidationPolicy(w.rmActor(), p1.id, "ra"),
          svc.setSelfValidationPolicy(w.adminActor(admin2), "DOUBLE_CONFIRMATION", "P2", "rb"),
        ]);
        const states = (await requestsOf(w.tenant)).map((r) => r.status);
        const policy = (await policyOf(w.tenant)).p;
        if (approve.status === "fulfilled") {
          // approve won: P1 APPLIED and the policy is in force. The replacement either lost (conflict) or, if it ran after, is a no-op-style write.
          expect(states[0]).toBe("APPLIED");
          expect(policy).toBe("DOUBLE_CONFIRMATION");
          if (replace.status === "rejected") expect((replace.reason as Error).name).toBe("ConflictError");
        } else {
          expect(["ConflictError", "ValidationError"]).toContain((approve.reason as Error).name);
          expect(states[0]).toBe("WITHDRAWN");
          expect(policy).toBe("REFUSE");
          expect(states.filter((s) => s === "PENDING")).toHaveLength(1);
        }
        // never two live decisions on one request, never a PENDING next to an APPLIED policy that it would re-apply
        expect(states.filter((s) => s === "PENDING").length).toBeLessThanOrEqual(1);
        expect(states.includes("APPLIED") && policy !== "DOUBLE_CONFIRMATION").toBe(false);
      }
      for (let i = 0; i < 4; i += 1) {
        const w = await world();
        const svc = configSvc();
        const p = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1")).pendingRequest!;
        const res = await Promise.allSettled([
          svc.approveSelfValidationPolicy(w.rmActor(), p.id, "ra"),
          svc.rejectSelfValidationPolicy(w.committeeActor(), p.id, "refus motivé", "rb"),
        ]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const s = (await requestsOf(w.tenant))[0]!.status;
        expect((await policyOf(w.tenant)).p).toBe(s === "APPLIED" ? "DOUBLE_CONFIRMATION" : "REFUSE");
        expect((await w.auditRows("Config")).length + (await w.auditRows("SelfValidationPolicyRequest")).filter((a) => a.action === "REJECT").length).toBe(1);
      }
    });

    it("approval after a change of policy: an administrator who restates REFUSE while a request is pending withdraws it; the request can no longer be approved", async () => {
      const w = await world();
      const svc = configSvc();
      const p = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1")).pendingRequest!;
      const back = await svc.setSelfValidationPolicy(w.adminActor(), "REFUSE", "j'abandonne la demande", "r2");
      expect(back.pendingRequest).toBeNull();
      expect((await requestsOf(w.tenant))[0]).toMatchObject({ status: "WITHDRAWN" });
      await expect(svc.approveSelfValidationPolicy(w.rmActor(), p.id, "r3")).rejects.toMatchObject({ name: "ValidationError" });
      expect((await policyOf(w.tenant)).p).toBe("REFUSE");
      expect((await w.auditRows("Config")).every((a) => a.governance_exception === null)).toBe(true); // tightening / restating is unmarked
    });

    it("the approver disappears: the request stays PENDING, nobody can approve, the administrator's next call takes the 'alone' path (marked) and closes the stale request", async () => {
      const w = await world();
      const svc = configSvc();
      const p = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1")).pendingRequest!;
      await w.suspend(w.rm); await w.suspend(w.committee);
      expect((await requestsOf(w.tenant))[0]!.status).toBe("PENDING"); // no expiry, no cleanup (point 2 of the arbitration lot)
      const again = await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "plus personne pour confirmer", "r2");
      expect(again.pendingRequest).toBeNull();
      expect(again.config.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
      expect((await requestsOf(w.tenant))[0]).toMatchObject({ id: p.id, status: "WITHDRAWN" });
      const marked = (await w.auditRows("Config")).filter((a) => a.governance_exception);
      expect(marked.map((a) => a.governance_exception)).toEqual(["config.selfvalidation.adminAlone"]);
    });

    it("no expiry: a request 400 days old, whose author has since been suspended, is still approvable and applies the policy (pinned: F-PNL2-02b, the point to confirm no. 2)", async () => {
      const w = await world();
      const svc = configSvc();
      const p = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "demande ancienne", "r1")).pendingRequest!;
      // 072 makes the content immutable: the age is forged with the guard trigger switched off (superuser connection), then back on.
      await pool.query(`ALTER TABLE self_validation_policy_requests DISABLE TRIGGER self_validation_policy_requests_guard`);
      try { await pool.query(`UPDATE self_validation_policy_requests SET requested_at = now() - interval '400 days' WHERE id = $1`, [p.id]); }
      finally { await pool.query(`ALTER TABLE self_validation_policy_requests ENABLE TRIGGER self_validation_policy_requests_guard`); }
      await w.suspend(w.admin);
      const cfg = await svc.approveSelfValidationPolicy(w.rmActor(), p.id, "r2");
      expect(cfg.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
      expect((await policyOf(w.tenant)).updated_by).toBe(w.admin); // written on behalf of a suspended account
    });

    it("reject needs a real reason (blank, NUL, zero-width space refused, request untouched); a rejected request frees the slot for a new one", async () => {
      const w = await world();
      const svc = configSvc();
      const p = (await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1")).pendingRequest!;
      for (const bad of ["", "   ", "x\u0000y", ZWSP, `${ZWSP}${ZWSP}`]) {
        await expect(svc.rejectSelfValidationPolicy(w.rmActor(), p.id, bad, "r"), JSON.stringify(bad)).rejects.toMatchObject({ name: "ValidationError" });
      }
      expect((await requestsOf(w.tenant))[0]!.status).toBe("PENDING");
      await svc.rejectSelfValidationPolicy(w.rmActor(), p.id, "refus motivé", "r2");
      const again = await svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "nouvelle demande", "r3");
      expect(again.pendingRequest).not.toBeNull();
      expect((await requestsOf(w.tenant)).map((r) => r.status)).toEqual(["REJECTED", "PENDING"]);
    });

    it("an acceptable reason is also enforced at submission (NUL / zero-width / blank -> ValidationError, no row, no audit)", async () => {
      const w = await world();
      const svc = configSvc();
      for (const bad of ["", "  ", "a\u0000", ZWSP]) {
        await expect(svc.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", bad, "r"), JSON.stringify(bad)).rejects.toMatchObject({ name: "ValidationError" });
      }
      expect(await requestsOf(w.tenant)).toEqual([]);
      expect(await w.auditRows("Config")).toEqual([]);
    });

    it("an approver that exists only as a SUSPENDED account does not count; a DORMANT (never connected) approver does (capacity, not presence)", async () => {
      const w = await world();
      await w.suspend(w.committee);
      // dormant: rm never connected (last_seen_at null) -> still counts
      const first = await configSvc().setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1");
      expect(first.pendingRequest).not.toBeNull();
      const w2 = await world();
      await w2.suspend(w2.rm); await w2.suspend(w2.committee);
      const alone = await configSvc().setSelfValidationPolicy(w2.adminActor(), "DOUBLE_CONFIRMATION", "P", "r1");
      expect(alone.pendingRequest).toBeNull();
    });

    it("fail closed: a ConfigService built without the circuit (no queries, no request repository) never relaxes the policy", async () => {
      const w = await world();
      const bare = new ConfigService(new PostgresConfigRepository(pool), auditRepo());
      await expect(bare.setSelfValidationPolicy(w.adminActor(), "DOUBLE_CONFIRMATION", "P", "r")).rejects.toMatchObject({ name: "ValidationError" });
      expect((await policyOf(w.tenant)).p).toBe("REFUSE");
    });
  });

  // =============================================================================================================
  // (2a/b) the HTTP face of q158: 202 + pendingRequest, ids, rights
  // =============================================================================================================
  async function serve(setup: (app: express.Express) => void, userFor: (req: express.Request) => AuthenticatedUser | undefined) {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    setup(app);
    app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => errorHandler(err, req, res, next));
    void userFor;
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise<void>((r) => server.close(() => r())) };
  }
  const withUser = (map: Map<string, AuthenticatedUser>): express.RequestHandler => (req, _res, next) => {
    (req as unknown as { user?: AuthenticatedUser }).user = map.get(String(req.header("x-test-user")));
    next();
  };
  const call = async (base: string, who: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-test-user": who, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
  };

  describe("q158 over HTTP", () => {
    it("PUT answers 202 + pendingRequest (data = unchanged config) for a relaxation with an approver; read/approve rights; a second approve is a 400", async () => {
      const w = await world();
      const users = new Map<string, AuthenticatedUser>([["admin", w.adminActor()], ["rm", w.rmActor()], ["audit", w.auditActor()]]);
      const srv = await serve((app) => { app.use(withUser(users)); app.use("/api/v1/config", configRouter(configSvc())); }, () => undefined);
      try {
        const put = await call(srv.base, "admin", "PUT", "/api/v1/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "demande" });
        expect(put.status).toBe(202);
        expect(put.json.pendingRequest).toMatchObject({ status: "PENDING" });
        expect(put.json.data.selfValidationPolicy).toBe("REFUSE");
        const get = await call(srv.base, "rm", "GET", "/api/v1/config/self-validation-policy/request");
        expect(get.json.data.id).toBe(put.json.pendingRequest.id);
        expect((await call(srv.base, "audit", "GET", "/api/v1/config/self-validation-policy/request")).status).toBe(403);
        expect((await call(srv.base, "admin", "POST", `/api/v1/config/self-validation-policy/requests/${put.json.pendingRequest.id}/approve`, { reason: "approuve" })).status).toBe(403);
        // unknown extra keys / bad reasons are 400, not 202
        expect((await call(srv.base, "admin", "PUT", "/api/v1/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: ZWSP })).status).toBe(400);
        expect((await call(srv.base, "admin", "PUT", "/api/v1/config/self-validation-policy", { policy: "NOPE", reason: "x" })).status).toBe(400);
        const approve = await call(srv.base, "rm", "POST", `/api/v1/config/self-validation-policy/requests/${put.json.pendingRequest.id}/approve`, { reason: "approuve" });
        expect(approve.status).toBe(200);
        expect(approve.json.data.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
        // a second approve of the same request: 400 (already decided), not a 500
        expect((await call(srv.base, "rm", "POST", `/api/v1/config/self-validation-policy/requests/${put.json.pendingRequest.id}/approve`, { reason: "approuve" })).status).toBe(400);
      } finally { await srv.close(); }
    });

    it("F-PNL2-03: a malformed request id on approve/reject is answered 400/404, not a 500 (the id reaches PostgreSQL unvalidated)", async () => {
      const w = await world();
      const users = new Map<string, AuthenticatedUser>([["rm", w.rmActor()]]);
      const srv = await serve((app) => { app.use(withUser(users)); app.use("/api/v1/config", configRouter(configSvc())); }, () => undefined);
      try {
        for (const verb of ["approve", "reject"]) {
          const bad = await call(srv.base, "rm", "POST", `/api/v1/config/self-validation-policy/requests/not-a-uuid/${verb}`, { reason: "motif valable" });
          expect([400, 404], `${verb}: status ${bad.status}`).toContain(bad.status);
        }
      } finally { await srv.close(); }
    });
  });
  // =============================================================================================================
  // (2d) D5: reviews of exceptions, acceptances of principles, notifications
  // =============================================================================================================
  const reviewSvc = () => new GovernanceExceptionService(new PostgresGovernanceExceptionReviewRepository(pool), auditRepo());
  const acceptSvc = () => new GovernancePrincipleAcceptanceService(new PostgresGovernancePrincipleAcceptanceRepository(pool), auditRepo(), governance());
  const markedRow = async (w: World, by: string, over: { entityType?: string; action?: string; exception?: string | null; newValue?: unknown; reason?: string } = {}) => {
    const entityId = randomUUID();
    const r = await one(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, governance_exception, new_value, reason)
       VALUES ($1,$2,$3,$4,$5,'qa-p2',$6,$7,$8) RETURNING id`,
      [w.tenant, by, over.entityType ?? "ControlExecution", entityId, over.action ?? "VALIDATE", over.exception === undefined ? "noSelfValidation" : over.exception,
       over.newValue === undefined ? null : JSON.stringify(over.newValue), over.reason ?? null]);
    return { auditId: r["id"]!, entityId };
  };
  const labelOf = async (w: World, row: { entityId: string }, entityType = "ControlExecution") =>
    (await governance().forEntities(w.tenant, entityType, [row.entityId])).get(row.entityId);

  describe("D5 reviews", () => {
    it("the author never reviews his own action (service, with the upper-case form of the id too, and the database guard behind it); a third party's REVIEWED lifts the label, a CONTESTED does not", async () => {
      const w = await world();
      const svc = reviewSvc();
      const row = await markedRow(w, w.rm); // the Risk Manager is the author: he holds the review right and still cannot
      await expect(svc.review(w.rmActor(), row.auditId, { outcome: "REVIEWED", comment: "je relis" }, "r1")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(svc.review(w.rmActor(), row.auditId.toUpperCase(), { outcome: "REVIEWED", comment: "je relis" }, "r1")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(new PostgresGovernanceExceptionReviewRepository(pool).insert(
        { tenantId: w.tenant, auditLogId: row.auditId, outcome: "REVIEWED", reviewedBy: w.rm, comment: "contournement" }, () => [],
      )).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(await labelOf(w, row)).toBe("WITHOUT_INDEPENDENT_REVIEW");

      const contest = await svc.review(w.auditActor(), row.auditId, { outcome: "CONTESTED", comment: "je conteste" }, "r2");
      expect(contest).toMatchObject({ outcome: "CONTESTED", reviewedBy: w.audit });
      expect(await labelOf(w, row)).toBe("WITHOUT_INDEPENDENT_REVIEW"); // an objection is not a review

      await svc.review(w.committeeActor(), row.auditId, { outcome: "REVIEWED", comment: "relu" }, "r3");
      expect(await labelOf(w, row)).toBe("REVIEWED_BY_THIRD_PARTY");
      // pinned (F-PNL2-07, INFO): the label no longer shows that somebody contested it
      expect((await rows(`SELECT outcome FROM governance_exception_reviews WHERE audit_log_id = $1 ORDER BY outcome`, [row.auditId])).map((r) => r["outcome"])).toEqual(["CONTESTED", "REVIEWED"]);
    });

    it("one review per person and per entry: a second one, or a contestation after a review (and the reverse), is a 409-type error, never a raw SQL error", async () => {
      const w = await world();
      const svc = reviewSvc();
      const row = await markedRow(w, w.admin);
      await svc.review(w.committeeActor(), row.auditId, { outcome: "REVIEWED", comment: "relu" }, "r1");
      await expect(svc.review(w.committeeActor(), row.auditId, { outcome: "REVIEWED", comment: "encore" }, "r2")).rejects.toMatchObject({ name: "ConflictError" });
      await expect(svc.review(w.committeeActor(), row.auditId, { outcome: "CONTESTED", comment: "finalement non" }, "r3")).rejects.toMatchObject({ name: "ConflictError" });
      const row2 = await markedRow(w, w.admin);
      await svc.review(w.auditActor(), row2.auditId, { outcome: "CONTESTED", comment: "non" }, "r4");
      await expect(svc.review(w.auditActor(), row2.auditId, { outcome: "REVIEWED", comment: "en fait si" }, "r5")).rejects.toMatchObject({ name: "ConflictError" });
    });

    it("what is reviewable: marked entries and size-lowering submissions only; unmarked, unknown and other-tenant entries all look like 404; rights and comments are checked", async () => {
      const w = await world(); const other = await world();
      const svc = reviewSvc();
      const plain = await markedRow(w, w.admin, { exception: null });
      const foreign = await markedRow(other, other.admin);
      const lowering = await markedRow(w, w.admin, { exception: null, entityType: "OrganizationProfile", action: "SUBMIT", newValue: { lowersSize: true } });
      const notLowering = await markedRow(w, w.admin, { exception: null, entityType: "OrganizationProfile", action: "SUBMIT", newValue: { lowersSize: false } });
      const marked = await markedRow(w, w.admin);
      for (const id of [plain.auditId, foreign.auditId, notLowering.auditId, randomUUID()]) {
        await expect(svc.review(w.auditActor(), id, { outcome: "CONTESTED", comment: "x" }, "r"), id).rejects.toMatchObject({ name: "NotFoundError" });
      }
      await svc.review(w.auditActor(), lowering.auditId, { outcome: "CONTESTED", comment: "baisse contestée" }, "r");
      await expect(svc.review(w.as(w.rm, ["audit.read"]), marked.auditId, { outcome: "REVIEWED", comment: "x" }, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
      for (const bad of ["", "   ", "a\u0000b", ZWSP, "x".repeat(501)]) {
        await expect(svc.review(w.committeeActor(), marked.auditId, { outcome: "REVIEWED", comment: bad }, "r"), JSON.stringify(bad).slice(0, 20)).rejects.toMatchObject({ name: "ValidationError" });
      }
      await expect(svc.review(w.committeeActor(), marked.auditId, { outcome: "OTHER" as never, comment: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
      expect(await rows(`SELECT 1 FROM governance_exception_reviews WHERE tenant_id = $1 AND audit_log_id = $2`, [w.tenant, marked.auditId])).toEqual([]);
      await svc.review(w.committeeActor(), marked.auditId, { outcome: "REVIEWED", comment: "x".repeat(500) }, "r"); // the boundary is accepted
    });

    it("atomic: a refused audit row leaves no review; the same call then works", async () => {
      const w = await world();
      const row = await markedRow(w, w.admin);
      await expect(reviewSvc().review(w.committeeActor(), row.auditId, { outcome: "REVIEWED", comment: BLOCK }, "r1")).rejects.toThrow(/QA_P2/);
      expect(await rows(`SELECT 1 FROM governance_exception_reviews WHERE audit_log_id = $1`, [row.auditId])).toEqual([]);
      expect(await labelOf(w, row)).toBe("WITHOUT_INDEPENDENT_REVIEW");
      await reviewSvc().review(w.committeeActor(), row.auditId, { outcome: "REVIEWED", comment: "ok" }, "r2");
      expect(await labelOf(w, row)).toBe("REVIEWED_BY_THIRD_PARTY");
    });

    it("the review is append-only for the runtime role too: no UPDATE, DELETE or TRUNCATE (privileges and triggers)", async () => {
      const w = await world();
      const row = await markedRow(w, w.admin);
      const r = await reviewSvc().review(w.committeeActor(), row.auditId, { outcome: "CONTESTED", comment: "non" }, "r");
      const c = await pool.connect();
      try {
        await c.query("SET ROLE grc_app_runtime");
        for (const sql of [`UPDATE governance_exception_reviews SET outcome = 'REVIEWED' WHERE id = '${r.id}'`, `DELETE FROM governance_exception_reviews WHERE id = '${r.id}'`, `TRUNCATE governance_exception_reviews`]) {
          await expect(c.query(sql), sql).rejects.toMatchObject({ code: "42501" });
        }
      } finally { await c.query("RESET ROLE").catch(() => undefined); c.release(); }
      // as the owner, the trigger is the second line
      await expect(pool.query(`UPDATE governance_exception_reviews SET outcome = 'REVIEWED' WHERE id = $1`, [r.id])).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("D5 acceptances", () => {
    it("with a possible confirmer: PENDING; the acceptor, Audit and an unrelated user cannot confirm; a confirmer applies it (CONFIRMED); it cannot be confirmed or accepted twice", async () => {
      const w = await world();
      const svc = acceptSvc();
      const exp = new Date(Date.now() + 86_400_000);
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R5", reason: "exception temporaire", expiresAt: exp }, "r1");
      expect(a).toMatchObject({ status: "PENDING", regime: null, acceptedBy: w.admin });
      await expect(svc.confirm(w.adminActor(), a.id, "r2")).rejects.toMatchObject({ name: "ForbiddenError" }); // no permission
      const adminWithConfirm = w.as(w.admin, ["governanceprinciple.acceptance.confirm"]);
      await expect(svc.confirm(adminWithConfirm, a.id, "r2")).rejects.toMatchObject({ name: "ForbiddenError" }); // the acceptor himself
      await expect(svc.confirm(w.auditActor(), a.id, "r3")).rejects.toMatchObject({ name: "ForbiddenError" }); // Audit never confirms (q157)
      await expect(svc.reject(w.auditActor(), a.id, "non", "r3")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(svc.accept(w.rmActor(), { principleId: "GOV-R5", reason: "autre", expiresAt: exp }, "r4")).rejects.toMatchObject({ name: "ConflictError" }); // one open per principle
      const done = await svc.confirm(w.committeeActor(), a.id, "r5");
      expect(done).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", confirmedBy: null });
      await expect(svc.confirm(w.rmActor(), a.id, "r6")).rejects.toMatchObject({ name: "ConflictError" });
      expect((await w.auditRows("GovernancePrincipleAcceptance", a.id)).map((x) => [x.action, x.governance_exception])).toEqual(expect.arrayContaining([["CREATE", null], ["APPROVE", null]]));
    });

    it("with nobody else able to confirm: ACTIVE at once, regime ALONE, journal marker principle.acceptance.alone; a suspended confirmer does not count", async () => {
      const w = await world();
      await w.suspend(w.rm); await w.suspend(w.committee);
      const a = await acceptSvc().accept(w.adminActor(), { principleId: "GOV-R7", reason: "seul", expiresAt: new Date(Date.now() + 86_400_000) }, "r1");
      expect(a).toMatchObject({ status: "ACTIVE", regime: "ALONE", confirmedBy: null });
      expect((await w.auditRows("GovernancePrincipleAcceptance", a.id)).map((x) => x.governance_exception)).toEqual(["principle.acceptance.alone"]);
    });

    it("rejection and early end: a third party rejects (reason required); the acceptor may end his own; Audit may end any (terminal gate); an ended one cannot be ended again; the principle can then be accepted anew", async () => {
      const w = await world();
      const svc = acceptSvc();
      const exp = new Date(Date.now() + 86_400_000);
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R9", reason: "temp", expiresAt: exp }, "r1");
      await expect(svc.reject(w.committeeActor(), a.id, ZWSP, "r2")).rejects.toMatchObject({ name: "ValidationError" });
      const rej = await svc.reject(w.committeeActor(), a.id, "pas justifié", "r3");
      expect(rej).toMatchObject({ status: "REJECTED", endedBy: null });
      await expect(svc.revoke(w.auditActor(), a.id, "fin", "r4")).rejects.toMatchObject({ name: "ConflictError" });
      const b = await svc.accept(w.adminActor(), { principleId: "GOV-R9", reason: "temp 2", expiresAt: exp }, "r5");
      expect(await svc.revoke(w.adminActor(), b.id, "j'arrête", "r6")).toMatchObject({ status: "REVOKED", endedBy: w.admin });
      const c = await svc.accept(w.adminActor(), { principleId: "GOV-R9", reason: "temp 3", expiresAt: exp }, "r7");
      expect(await svc.revoke(w.auditActor(), c.id, "l'audit met fin", "r8")).toMatchObject({ status: "REVOKED", endedBy: w.audit });
      await expect(svc.revoke(w.as(w.admin, ["governanceprinciple.accept"]), c.id, "x", "r9")).rejects.toMatchObject({ name: "ForbiddenError" }); // accept is not revoke
      await expect(svc.revoke(w.adminActor(), randomUUID(), "x", "r10")).rejects.toMatchObject({ name: "NotFoundError" });
    });

    it("expiry: an acceptance past its date cannot be confirmed; accepting the principle again closes the stale one (REVOKED 'Expired; replaced', CLOSE audit) in the same transaction", async () => {
      const w = await world();
      const svc = acceptSvc();
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R11", reason: "courte", expiresAt: new Date(Date.now() + 900) }, "r1");
      await new Promise((r) => setTimeout(r, 1000));
      await expect(svc.confirm(w.committeeActor(), a.id, "r2")).rejects.toMatchObject({ name: "ValidationError", message: expect.stringMatching(/expired/) });
      const b = await svc.accept(w.rmActor(), { principleId: "GOV-R11", reason: "nouvelle", expiresAt: new Date(Date.now() + 86_400_000) }, "r3");
      expect(b.status).toBe("PENDING");
      const old = (await rows<{ status: string; end_reason: string }>(`SELECT status, end_reason FROM governance_principle_acceptances WHERE id = $1`, [a.id]))[0]!;
      expect(old).toMatchObject({ status: "REVOKED", end_reason: "Expired; replaced by a new acceptance" });
      expect((await w.auditRows("GovernancePrincipleAcceptance", a.id)).map((x) => x.action)).toContain("CLOSE");
    });

    it("input: ill-formed principle ids, past / invalid dates, blank / NUL / zero-width / over-long reasons are refused with nothing written; a far-future date is accepted (no maximum duration exists: pinned, I-R6)", async () => {
      const w = await world();
      const svc = acceptSvc();
      const ok = { principleId: "GOV-R1", reason: "motif", expiresAt: new Date(Date.now() + 86_400_000) };
      for (const bad of [{ principleId: "gov-r1" }, { principleId: "GOV" }, { principleId: "GOV-" + "X".repeat(40) }, { principleId: "" }, { reason: "" }, { reason: ZWSP }, { reason: "a\u0000" }, { reason: "x".repeat(501) },
        { expiresAt: new Date(Date.now() - 1000) }, { expiresAt: new Date("nope") }, { expiresAt: new Date() }]) {
        await expect(svc.accept(w.adminActor(), { ...ok, ...bad }, "r"), JSON.stringify(bad).slice(0, 40)).rejects.toMatchObject({ name: "ValidationError" });
      }
      expect(await rows(`SELECT 1 FROM governance_principle_acceptances WHERE tenant_id = $1`, [w.tenant])).toEqual([]);
      const far = await svc.accept(w.adminActor(), { ...ok, expiresAt: new Date("9999-12-31T00:00:00Z") }, "r");
      expect(far.expiresAt.getUTCFullYear()).toBe(9999);
    });

    it("atomic: a refused audit leaves no acceptance and no stale-closing; confirm / reject / revoke the same", async () => {
      const w = await world();
      const svc = acceptSvc();
      const exp = new Date(Date.now() + 86_400_000);
      await expect(svc.accept(w.adminActor(), { principleId: "GOV-R2", reason: BLOCK, expiresAt: exp }, "r1")).rejects.toThrow(/QA_P2/);
      expect(await rows(`SELECT 1 FROM governance_principle_acceptances WHERE tenant_id = $1`, [w.tenant])).toEqual([]);
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R2", reason: "ok", expiresAt: exp }, "r2");
      await expect(svc.reject(w.committeeActor(), a.id, BLOCK, "r3")).rejects.toThrow(/QA_P2/);
      await expect(svc.revoke(w.adminActor(), a.id, BLOCK, "r4")).rejects.toThrow(/QA_P2/);
      expect((await rows<{ status: string }>(`SELECT status FROM governance_principle_acceptances WHERE id = $1`, [a.id]))[0]!.status).toBe("PENDING");
    });

    it("concurrency: confirm racing reject, and two simultaneous acceptances of one principle -> a single outcome each", async () => {
      const w = await world();
      const svc = acceptSvc();
      const exp = new Date(Date.now() + 86_400_000);
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R3", reason: "x", expiresAt: exp }, "r1");
      const res = await Promise.allSettled([svc.confirm(w.rmActor(), a.id, "ra"), svc.reject(w.committeeActor(), a.id, "non", "rb")]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).name).toBe("ConflictError");
      const both = await Promise.allSettled([
        svc.accept(w.adminActor(), { principleId: "GOV-R4", reason: "x", expiresAt: exp }, "rc"),
        svc.accept(w.rmActor(), { principleId: "GOV-R4", reason: "y", expiresAt: exp }, "rd"),
      ]);
      expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).name).toBe("ConflictError");
    });

    it("masking (q140): without audit.read the list carries no user id (only `mine`); with it, the ids; governancehealth.read is required", async () => {
      const w = await world();
      const svc = acceptSvc();
      const a = await svc.accept(w.adminActor(), { principleId: "GOV-R6", reason: "x", expiresAt: new Date(Date.now() + 86_400_000) }, "r1");
      await svc.confirm(w.committeeActor(), a.id, "r2");
      const noAudit = await svc.list(w.as(w.admin, ["governancehealth.read"]));
      expect(noAudit[0]).toMatchObject({ acceptedBy: null, confirmedBy: null, endedBy: null, mine: true });
      expect(JSON.stringify(noAudit)).not.toMatch(new RegExp(`${w.admin}|${w.committee}`));
      expect((await svc.list(w.as(w.rm, ["governancehealth.read"])))[0]!.mine).toBe(false);
      const withAudit = await svc.list(w.as(w.audit, ["governancehealth.read", "audit.read"]));
      expect(withAudit[0]).toMatchObject({ acceptedBy: w.admin, confirmedBy: w.committee, mine: false });
      await expect(svc.list(w.as(w.admin, ["config.read"]))).rejects.toMatchObject({ name: "ForbiddenError" });
      // another tenant never sees it
      const other = await world();
      expect(await svc.list(other.as(other.admin, ["governancehealth.read"]))).toEqual([]);
    });
  });

  // =============================================================================================================
  // (2c) DECISION-079: residual interleavings on the already-atomic validations
  // =============================================================================================================
  describe("atomicity under concurrency", () => {
    async function execWorld(withPolicy: boolean) {
      const w = await world();
      const maker = await w.user("maker");
      if (withPolicy) {
        // nobody else may validate: the only holders of execution.validate would be the fixed-group users, so remove them from the tenant
        await w.suspend(w.rm); await w.suspend(w.committee); await w.suspend(w.audit);
        await pool.query(`INSERT INTO configs (tenant_id, score_formula, level_thresholds, impact_retenu_rule, appetite_mode, evaluation_mode, version, self_validation_policy)
          VALUES ($1,'P_X_I','[]','MAX','AUTO_AVEC_SURCHARGE_MANUELLE','CLASSIQUE',0,'DOUBLE_CONFIRMATION') ON CONFLICT (tenant_id) DO UPDATE SET self_validation_policy = 'DOUBLE_CONFIRMATION'`, [w.tenant]);
      }
      const control = (await one(`INSERT INTO controls (tenant_id, label, control_type, frequency, executor, compliance_criteria) VALUES ($1,'c','PREVENTIVE','MONTHLY','x','y') RETURNING id`, [w.tenant]))["id"]!;
      const exec = async () => (await one(`INSERT INTO control_executions (tenant_id, control_id, executed_by, status) VALUES ($1,$2,$3,'DONE') RETURNING id`, [w.tenant, control, maker]))["id"]!;
      const svc = new ControlExecutionService(new PostgresControlExecutionRepository(pool), new PostgresControlRepository(pool), auditRepo(),
        new SelfValidationGate(new PostgresConfigRepository(pool), governance()));
      return { w, maker, exec, svc };
    }

    it("two validators validate the same execution at once -> one success, one 'already validated', exactly ONE audit row", async () => {
      for (let i = 0; i < 4; i += 1) {
        const { w, exec, svc } = await execWorld(false);
        const id = await exec();
        const v1 = w.as(w.rm, ["execution.read", "execution.validate"]); const v2 = w.as(w.committee, ["execution.read", "execution.validate"]);
        const res = await Promise.allSettled([svc.validate(v1, id, "a", "ra"), svc.validate(v2, id, "b", "rb")]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(((res.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as Error).name).toBe("ValidationError");
        expect(await w.auditRows("ControlExecution", id)).toHaveLength(1);
      }
    });

    it("a confirmed self-validation sent twice at once (double click) -> one success carrying the marker, the twin refused, exactly one audit row, no unmarked row", async () => {
      for (let i = 0; i < 4; i += 1) {
        const { w, maker, exec, svc } = await execWorld(true);
        const id = await exec();
        const me = w.as(maker, ["execution.read", "execution.validate"]);
        const conf = { rule: "noSelfValidation", reason: "personne d'autre" } as const;
        const res = await Promise.allSettled([svc.validate(me, id, "a", "ra", conf), svc.validate(me, id, "b", "rb", conf)]);
        expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        const trail = await w.auditRows("ControlExecution", id);
        expect(trail.map((t) => t.governance_exception)).toEqual(["noSelfValidation"]);
      }
    });
  });

  // =============================================================================================================
  // (2d) notifications: only after success, only to the right audience, no identity in the text
  // =============================================================================================================
  describe("D5 notifications end to end", () => {
    type Sent = { recipientUserId: string; eventType: string; message: string; tenantId: string; resourceId: string };
    const recorder = () => {
      const sent: Sent[] = [];
      const notifier = new GovernanceNotifier({ emit: async (i: Sent) => { sent.push(i); return null; } } as never, governance());
      return { sent, notifier };
    };
    const settle = async (sent: Sent[]) => { let n = -1; while (n !== sent.length) { n = sent.length; await new Promise((r) => setTimeout(r, 120)); } };
    const names = (w: World, ids: string[], extra: Record<string, string> = {}) =>
      ids.map((id) => Object.entries({ admin: w.admin, rm: w.rm, committee: w.committee, audit: w.audit, ...extra }).find(([, v]) => v === id)?.[0] ?? id).sort();
    const who = (w: World, sent: Sent[], type: string, extra: Record<string, string> = {}) => names(w, sent.filter((s) => s.eventType === type).map((s) => s.recipientUserId), extra);

    async function app(w: World, notifier: GovernanceNotifier) {
      const users = new Map<string, AuthenticatedUser>([["admin", w.adminActor()], ["rm", w.rmActor()], ["committee", w.committeeActor()], ["audit", w.auditActor()]]);
      const cfg = configSvc();
      return serve((a) => {
        a.use("/api/v1", governanceNotificationsMiddleware(notifier));
        a.use("/api/v1/config", withUser(users), configRouter(cfg));
        a.use("/api/v1/governance-exceptions", withUser(users), governanceExceptionsRouter(reviewSvc()));
        a.use("/api/v1/governance-principle-acceptances", withUser(users), governancePrincipleAcceptancesRouter(acceptSvc()));
      }, () => undefined);
    }
    const exp = () => new Date(Date.now() + 86_400_000).toISOString();

    it("an acceptance waiting for confirmation -> only the possible confirmers (Risk Manager, Committee) except the author; not Audit, not a suspended member, not another tenant; the text names nobody", async () => {
      const w = await world(); const other = await world();
      const committee2 = await w.user("committee2"); await w.grant(w.committeeRole, committee2, w.admin); await w.suspend(committee2);
      const { sent, notifier } = recorder();
      const srv = await app(w, notifier);
      try {
        const r = await call(srv.base, "rm", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N1", reason: "exception", expiresAt: exp() });
        expect(r.status).toBe(201);
        await settle(sent);
        expect(who(w, sent, "PRINCIPLE_ACCEPTANCE_PENDING")).toEqual(["committee"]); // the author rm excluded; admin has no confirm right
        expect(sent.every((s) => s.tenantId === w.tenant)).toBe(true);
        expect(sent.filter((s) => s.recipientUserId === other.rm || s.recipientUserId === committee2)).toEqual([]);
        for (const s of sent) expect(s.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|@qa-p2/);
        // the same acceptor again: one open per principle -> 409 and NO new notification
        const before = sent.length;
        const dup = await call(srv.base, "rm", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N1", reason: "encore", expiresAt: exp() });
        expect(dup.status).toBe(409);
        await settle(sent);
        expect(sent.length).toBe(before);
      } finally { await srv.close(); }
    });

    it("an action applied alone (no confirmer) -> the review holders and the designated manager hear about it, never the author; failures (403 / 400 / 409) notify nobody", async () => {
      const w = await world();
      await w.suspend(w.rm); await w.suspend(w.committee);
      const mgr = await w.user("mgr");
      await pool.query(`INSERT INTO governance_designations (tenant_id, kind, user_id, reason, designated_by) VALUES ($1,'MANAGER',$2,'gérant',$3)`, [w.tenant, mgr, w.admin]);
      const { sent, notifier } = recorder();
      const srv = await app(w, notifier);
      try {
        expect((await call(srv.base, "audit", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N2", reason: "x", expiresAt: exp() })).status).toBe(403);
        expect((await call(srv.base, "admin", "POST", "/api/v1/governance-principle-acceptances", { principleId: "bad id", reason: "x", expiresAt: exp() })).status).toBe(400);
        expect((await call(srv.base, "admin", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N2", reason: "x", expiresAt: exp(), acceptedBy: w.audit })).status).toBe(400);
        await settle(sent);
        expect(sent).toEqual([]);
        const ok = await call(srv.base, "admin", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N2", reason: "seul", expiresAt: exp() });
        expect(ok.status).toBe(201);
        expect(ok.json.data.regime).toBe("ALONE");
        expect(ok.json.data.acceptedBy).toBe(w.admin); // never the client's value
        await settle(sent);
        expect(who(w, sent, "GOVERNANCE_EXCEPTION_RECORDED", { mgr })).toEqual(["audit", "mgr"]);
        expect(sent.some((s) => s.recipientUserId === w.admin)).toBe(false);
        expect((await call(srv.base, "admin", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N2", reason: "bis", expiresAt: exp() })).status).toBe(409);
        await settle(sent);
        expect(sent.filter((s) => s.eventType === "GOVERNANCE_EXCEPTION_RECORDED")).toHaveLength(2);
      } finally { await srv.close(); }
    });

    it("a relaxation request (202) -> the possible approvers only; replaced by another admin -> told again; applied alone (approvers gone) -> the exception is announced to the review holders", async () => {
      const w = await world();
      const admin2 = await w.user("admin2"); await w.grant(w.adminRole, admin2, w.admin);
      const { sent, notifier } = recorder();
      const users = new Map<string, AuthenticatedUser>([["admin", w.adminActor()], ["admin2", w.adminActor(admin2)]]);
      const srv = await serve((a) => { a.use("/api/v1", governanceNotificationsMiddleware(notifier)); a.use("/api/v1/config", withUser(users), configRouter(configSvc())); }, () => undefined);
      try {
        const first = await call(srv.base, "admin", "PUT", "/api/v1/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "demande" });
        expect(first.status).toBe(202);
        await settle(sent);
        expect(who(w, sent, "SELF_VALIDATION_POLICY_REQUEST_PENDING")).toEqual(["committee", "rm"]);
        const second = await call(srv.base, "admin2", "PUT", "/api/v1/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "remplace" });
        expect(second.status).toBe(202);
        await settle(sent);
        expect(sent.filter((s) => s.eventType === "SELF_VALIDATION_POLICY_REQUEST_PENDING")).toHaveLength(4);
        expect(sent.some((s) => s.recipientUserId === admin2 || s.recipientUserId === w.admin)).toBe(false);
        // approvers gone: the next call applies alone, marked; the audit group (review holder) is told
        await w.suspend(w.rm); await w.suspend(w.committee);
        const alone = await call(srv.base, "admin", "PUT", "/api/v1/config/self-validation-policy", { policy: "DOUBLE_CONFIRMATION", reason: "seul" });
        expect(alone.status).toBe(200);
        await settle(sent);
        expect(who(w, sent, "GOVERNANCE_EXCEPTION_RECORDED")).toEqual(["audit"]);
        expect(sent.filter((s) => s.eventType === "SELF_VALIDATION_POLICY_REQUEST_PENDING")).toHaveLength(4); // nothing new for the withdrawn path
      } finally { await srv.close(); }
    });

    it("a contestation -> Risk Manager, Committee and the manager hear it, not the contesting Audit; a plain REVIEWED notifies nobody; strict body (reviewedBy refused); upper-case id accepted", async () => {
      const w = await world();
      const mgr = await w.user("mgr");
      await pool.query(`INSERT INTO governance_designations (tenant_id, kind, user_id, reason, designated_by) VALUES ($1,'MANAGER',$2,'gérant',$3)`, [w.tenant, mgr, w.admin]);
      const row = await markedRow(w, w.admin);
      const { sent, notifier } = recorder();
      const srv = await app(w, notifier);
      try {
        expect((await call(srv.base, "audit", "POST", `/api/v1/governance-exceptions/${row.auditId}/reviews`, { outcome: "CONTESTED", comment: "x", reviewedBy: w.rm })).status).toBe(400);
        expect((await call(srv.base, "audit", "POST", `/api/v1/governance-exceptions/not-a-uuid/reviews`, { outcome: "CONTESTED", comment: "x" })).status).toBe(400);
        const rev = await call(srv.base, "committee", "POST", `/api/v1/governance-exceptions/${row.auditId.toUpperCase()}/reviews`, { outcome: "REVIEWED", comment: "relu" });
        expect(rev.status).toBe(201);
        expect(rev.json.data.reviewedBy).toBe(w.committee);
        await settle(sent);
        expect(sent).toEqual([]);
        const con = await call(srv.base, "audit", "POST", `/api/v1/governance-exceptions/${row.auditId}/reviews`, { outcome: "CONTESTED", comment: "je conteste" });
        expect(con.status).toBe(201);
        await settle(sent);
        expect(who(w, sent, "GOVERNANCE_EXCEPTION_CONTESTED", { mgr })).toEqual(["committee", "mgr", "rm"]);
        expect((await call(srv.base, "audit", "POST", `/api/v1/governance-exceptions/${row.auditId}/reviews`, { outcome: "CONTESTED", comment: "bis" })).status).toBe(409);
      } finally { await srv.close(); }
    });

    it("a client-supplied X-Request-Id: one process never emits the same (event, recipient, row) twice; a second instance reading the same request id emits it again (pinned, INFO F-PNL2-08)", async () => {
      const w = await world();
      const { sent, notifier } = recorder();
      const second = recorder();
      const srv = await app(w, notifier);
      try {
        const r = await call(srv.base, "rm", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N5", reason: "x", expiresAt: exp() }, { "x-request-id": "fixed-id-1" });
        expect(r.status).toBe(201);
        await settle(sent);
        expect(sent.length).toBeGreaterThan(0);
        const again = await call(srv.base, "rm", "POST", "/api/v1/governance-principle-acceptances", { principleId: "GOV-N6", reason: "y", expiresAt: exp() }, { "x-request-id": "fixed-id-1" });
        expect(again.status).toBe(201);
        await settle(sent);
        const keys = sent.map((s) => `${s.eventType}:${s.recipientUserId}:${s.resourceId}`);
        expect(new Set(keys).size).toBe(keys.length);
        await second.notifier.processRequest(w.tenant, w.rm, "fixed-id-1");
        expect(second.sent.filter((s) => keys.includes(`${s.eventType}:${s.recipientUserId}:${s.resourceId}`)).length).toBeGreaterThan(0);
      } finally { await srv.close(); }
    });

    it("role changes: a member leaving a fixed group is told to the remaining members of the three groups (not to the leaver, no name); a newcomer in Audit learns the number of unreviewed exceptions", async () => {
      const w = await world();
      const leaver = await w.user("leaver"); const newcomer = await w.user("newcomer");
      const lecteur = await w.role("Lecteur", ["risk.read"]);
      await w.grant(w.auditRole, leaver, w.admin); await w.grant(lecteur, leaver, w.admin);
      await w.grant(lecteur, newcomer, w.admin);
      await markedRow(w, w.admin); await markedRow(w, w.admin);
      const svc = new RoleService(new PostgresRoleRepository(pool), auditRepo(), new PostgresUserRepository(pool));
      const adminA = w.as(w.admin, ["role.assign", "role.read"]);
      const { sent, notifier } = recorder();
      await svc.revokeFromUser(adminA, w.auditRole, leaver, "req-leave", "départ de l'audit");
      await notifier.processRequest(w.tenant, w.admin, "req-leave");
      const told = sent.filter((s) => s.eventType === "GOVERNANCE_MEMBER_REMOVED").map((s) => s.recipientUserId).sort();
      expect(told).toEqual([w.audit, w.committee, w.rm].sort());
      expect(told).not.toContain(leaver);
      expect(told).not.toContain(w.admin);
      expect(sent[0]!.message).toBe("Un membre du groupe Audit a été retiré.");
      sent.length = 0;
      await svc.assignToUser(adminA, w.auditRole, newcomer, "req-join", "arrivée");
      await notifier.processRequest(w.tenant, w.admin, "req-join");
      const hello = sent.filter((s) => s.eventType === "GOVERNANCE_EXCEPTIONS_TO_REVIEW");
      expect(hello.map((s) => s.recipientUserId)).toEqual([newcomer]);
      expect(hello[0]!.message).toMatch(/^2 action\(s\)/);
    });
  });
  // =============================================================================================================
  // (1) retest variants of the former findings (the original oracles are in QA-panel-pg.test.ts)
  // =============================================================================================================
  describe("retest variants", () => {
    async function d2c(w: World) {
      const leaving = await w.user("leaving"); const interim = await w.user("interim"); const stranger = await w.user("stranger");
      const lecteur = await w.role("Lecteur", ["risk.read"]);
      // the Risk Manager group of this tenant is w.rmRole; w.rm is already a member: make `leaving` the ONLY one
      await pool.query(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND role_id = $2 AND user_id = $3`, [w.tenant, w.rmRole, w.rm]);
      await w.grant(w.rmRole, leaving, w.admin); await w.grant(lecteur, leaving, w.admin);
      await w.grant(lecteur, interim, w.admin); await w.grant(lecteur, stranger, w.admin);
      const designations = new PostgresGovernanceDesignationRepository(pool);
      const svc = new RoleService(new PostgresRoleRepository(pool), auditRepo(), new PostgresUserRepository(pool), undefined, undefined, undefined, undefined, undefined, designations);
      const adminA = w.as(w.admin, ["role.assign", "role.read", "designation.manage"]);
      const designate = () => designations.create({ tenantId: w.tenant, kind: "RISK_MANAGER_INTERIM", userId: interim, reason: "intérim", validUntil: new Date(Date.now() + 86_400_000), designatedBy: w.admin });
      const members = async () => (await rows<{ user_id: string }>(`SELECT user_id FROM user_roles WHERE tenant_id=$1 AND role_id=$2 AND revoked_at IS NULL`, [w.tenant, w.rmRole])).map((r) => r.user_id).sort();
      return { leaving, interim, stranger, svc, adminA, designate, members, lecteur };
    }

    it("F-PNL-01 variants: an interim made unusable (cumul with Audit, or suspended) never consumes the designation; WITHOUT confirmEmptyGroup the departure is refused with a domain error and the Risk Manager stays; WITH it he leaves and the vacancy is marked", async () => {
      for (const how of ["cumul", "suspended"] as const) {
        const w = await world();
        const x = await d2c(w);
        const d = await x.designate();
        if (how === "cumul") await w.grant(w.auditRole, x.interim, w.admin); else await w.suspend(x.interim);
        let err: Error | undefined;
        await x.svc.revokeFromUser(x.adminA, w.rmRole, x.leaving, "r1", "départ").catch((e: Error) => { err = e; });
        expect(["ConflictError", "ValidationError"], `${how}: ${err?.name}`).toContain(err?.name);
        expect(await x.members(), how).toEqual([x.leaving]);
        await x.svc.revokeFromUser(x.adminA, w.rmRole, x.leaving, "r2", "départ confirmé", true);
        expect(await x.members(), how).toEqual([]);
        const used = (await rows<{ activated_at: Date | null }>(`SELECT activated_at FROM governance_designations WHERE id = $1`, [d.id]))[0]!;
        expect(used.activated_at, how).toBeNull();
        expect((await w.auditRows("Role", w.rmRole)).some((a) => a.governance_exception === "riskManager.vacancy"), how).toBe(true);
      }
    });

    it("F-PNL-02 variants: revoking a user who is not a member is a 404-type error with or without an interim, with or without confirmEmptyGroup; nothing consumed, nobody removed", async () => {
      for (const withInterim of [false, true]) {
        const w = await world();
        const x = await d2c(w);
        const d = withInterim ? await x.designate() : null;
        for (const confirm of [false, true]) {
          await expect(x.svc.revokeFromUser(x.adminA, w.rmRole, x.stranger, "r", "non membre", confirm), `interim=${withInterim} confirm=${confirm}`).rejects.toMatchObject({ name: "NotFoundError" });
        }
        expect(await x.members()).toEqual([x.leaving]);
        if (d) expect((await rows<{ activated_at: Date | null }>(`SELECT activated_at FROM governance_designations WHERE id = $1`, [d.id]))[0]!.activated_at).toBeNull();
      }
    });

    // ---- D3 -------------------------------------------------------------------------------------------------
    const PME = { Q1: 50, Q2: 1, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "UNKNOWN" };
    const TPE = { Q1: 5, Q2: 0, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO" };
    const GE = { Q1: 300, Q2: 4, Q5: "YES", Q7: "YES", Q8: "FORMAL", Q11: "YES" };
    const QV = QUESTIONNAIRE_VERSION;
    const profileState = (tenant: string) => rows<{ version: number; status: string; regime: string | null; answers: { Q1: number } }>(
      `SELECT version, status, regime, answers FROM organization_profiles WHERE tenant_id = $1 ORDER BY version`, [tenant]);

    it("F-PNL-03 variants: hike and drop submitted at the same time, five rounds -> the drop is never ACTIVE without a confirmation or the 'alone' marker while a third party exists; at most one PENDING; no raw SQL error", async () => {
      for (let i = 0; i < 5; i += 1) {
        const w = await world();
        const admin2 = await w.user("admin2");
        const svc = new OrganizationProfileService(new PostgresOrganizationProfileRepository(pool), auditRepo());
        const submitter = (id: string) => w.as(id, ["orgprofile.read", "orgprofile.submit"]);
        await svc.submit(submitter(w.admin), { questionnaireVersion: QV, answers: PME, reason: "initial" }, "r0");
        const res = await Promise.allSettled([
          svc.submit(submitter(w.admin), { questionnaireVersion: QV, answers: GE, reason: "hausse" }, "ra"),
          svc.submit(submitter(admin2), { questionnaireVersion: QV, answers: TPE, reason: "baisse" }, "rb"),
        ]);
        for (const r of res) if (r.status === "rejected") expect(["ConflictError"]).toContain((r.reason as Error).name);
        const st = await profileState(w.tenant);
        expect(st.filter((x) => x.status === "PENDING").length).toBeLessThanOrEqual(1);
        expect(st.filter((x) => x.status === "ACTIVE" && x.answers.Q1 === 5), `round ${i}`).toEqual([]); // TPE can only be PENDING (or refused)
        expect(st.filter((x) => x.status === "ACTIVE")).toHaveLength(1);
      }
    });

    it("q157: the Audit group is no approver any more -- a drop with only Audit members around is applied alone (marked); with a Risk Manager around it waits, and Audit cannot approve it", async () => {
      const aloneWorld = await world();
      await aloneWorld.suspend(aloneWorld.rm); await aloneWorld.suspend(aloneWorld.committee); // only Audit (and the author) left
      const svc = new OrganizationProfileService(new PostgresOrganizationProfileRepository(pool), auditRepo());
      const sub = (w: World, id = w.admin) => w.as(id, ["orgprofile.read", "orgprofile.submit"]);
      await svc.submit(sub(aloneWorld), { questionnaireVersion: QV, answers: GE, reason: "initial" }, "r0");
      const drop = await svc.submit(sub(aloneWorld), { questionnaireVersion: QV, answers: TPE, reason: "baisse seul" }, "r1");
      expect(drop).toMatchObject({ status: "ACTIVE", regime: "ALONE" });
      expect((await aloneWorld.auditRows("OrganizationProfile")).filter((a) => a.governance_exception === "orgprofile.adminAlone")).toHaveLength(1);

      const w = await world();
      await svc.submit(sub(w), { questionnaireVersion: QV, answers: GE, reason: "initial" }, "r0");
      const pending = await svc.submit(sub(w), { questionnaireVersion: QV, answers: TPE, reason: "baisse" }, "r1");
      expect(pending.status).toBe("PENDING");
      await expect(svc.approve(w.auditActor(), pending.id, "r2")).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(svc.reject(w.auditActor(), pending.id, "non", "r2")).rejects.toMatchObject({ name: "ForbiddenError" });
      const ok = await svc.approve(w.rmActor(), pending.id, "r3");
      expect(ok).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED" });
    });

    it("q157: the size-lowering notice reaches the audit.read holders; pending also warns the approvers; the author is never told; the Audit can contest the submission", async () => {
      const w = await world();
      const svc = new OrganizationProfileService(new PostgresOrganizationProfileRepository(pool), auditRepo());
      const sub = w.as(w.admin, ["orgprofile.read", "orgprofile.submit"]);
      await svc.submit(sub, { questionnaireVersion: QV, answers: GE, reason: "initial" }, "r0");
      const sent: Array<{ recipientUserId: string; eventType: string }> = [];
      const notifier = new GovernanceNotifier({ emit: async (i: { recipientUserId: string; eventType: string }) => { sent.push(i); return null; } } as never, governance());
      await svc.submit(sub, { questionnaireVersion: QV, answers: TPE, reason: "baisse" }, "req-drop");
      await notifier.processRequest(w.tenant, w.admin, "req-drop");
      const to = (t: string) => sent.filter((s) => s.eventType === t).map((s) => s.recipientUserId).sort();
      expect(to("ORGPROFILE_SIZE_LOWERED")).toEqual([w.audit]); // audit.read holders = Audit only (RM / Committee hold no audit.read)
      expect(to("ORGPROFILE_APPROVAL_PENDING")).toEqual([w.rm, w.committee].sort());
      const lowering = (await w.auditRows("OrganizationProfile")).find((a) => a.action === "SUBMIT" && (a.new_value as { lowersSize?: boolean }).lowersSize === true)!;
      const entry = await new PostgresGovernanceExceptionReviewRepository(pool).getAuditEntry(w.tenant, (await rows<{ id: string }>(`SELECT id FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 AND action = 'SUBMIT'`, [w.tenant, lowering.entity_id]))[0]!.id);
      expect(entry!.reviewable).toBe(true);
    });

    // ---- D2b ------------------------------------------------------------------------------------------------
    it("F-PNL-06 variants: an upper-case id of ANOTHER user is stored canonical; one's own id in either case is refused as owner, champion and deputy; re-naming the current holder in another case writes nothing", async () => {
      const w = await world();
      const other = await w.user("other");
      const proc = (await one(`INSERT INTO processes (tenant_id, level, name, owner) VALUES ($1,'PROCESS',$2,'x') RETURNING id`, [w.tenant, `p-${randomUUID()}`]))["id"]!;
      const svc = new ProcessService(new PostgresProcessRepository(pool), auditRepo(), undefined, undefined, undefined, undefined, new PostgresUserRepository(pool));
      const actor = w.as(w.admin, ["process.read", "process.responsibility.assign"]);
      for (const field of ["ownerUserId", "riskChampionUserId", "deputyUserId"] as const) {
        for (const own of [w.admin, w.admin.toUpperCase()]) {
          await expect(svc.setResponsibilities(actor, proc, { [field]: own } as never, "r"), `${field} ${own === w.admin ? "lower" : "UPPER"}`).rejects.toMatchObject({ name: "ValidationError" });
        }
      }
      const done = await svc.setResponsibilities(actor, proc, { ownerUserId: other.toUpperCase() } as never, "r1");
      expect((done as unknown as { ownerUserId: string }).ownerUserId).toBe(other);
      expect((await rows<{ owner_user_id: string }>(`SELECT owner_user_id FROM processes WHERE id = $1`, [proc]))[0]!.owner_user_id).toBe(other);
      const before = (await w.auditRows("Process", proc)).length;
      expect(before).toBeGreaterThan(0);
      await svc.setResponsibilities(actor, proc, { ownerUserId: other.toUpperCase() } as never, "r2");
      expect((await w.auditRows("Process", proc)).length).toBe(before);
    });
  });
  // =============================================================================================================
  // (2c) the SEC-PNL-01 class beyond the governance routes: a control character in a reason that feeds the audit
  // =============================================================================================================
  describe("SEC-PNL-01 residual: NUL in a reason", () => {
    const NUL = "motif\u0000piégé";
    const enforcedOf = async (tenant: string) => (await rows<{ e: boolean }>(`SELECT committee_evaluation_enforced AS e FROM configs WHERE tenant_id = $1`, [tenant]))[0]?.e ?? true;
    // This service is built WITHOUT frameworks (server.ts wires them, which makes the Committee setters answer "owned by the Dispositif"); the audit path is the same.
    const cfgForGovernanceSettings = () => new ConfigService(new PostgresConfigRepository(pool), auditRepo());

    it("control: a clean reason turns committee enforcement off and leaves exactly one audit row", async () => {
      const w = await world();
      const actor = w.as(w.admin, ["config.read", "config.committeeenforcement.set"]);
      await cfgForGovernanceSettings().setCommitteeEnforcement(actor, false, "motif propre", "r1");
      expect(await enforcedOf(w.tenant)).toBe(false);
      expect((await w.auditRows("Config")).map((a) => a.action)).toEqual(["UPDATE"]);
    });

    it("F-PNL2-06: a NUL in the reason of config.committeeenforcement.set is refused BEFORE the effect (today the setting is turned off, the audit insert fails, the call ends in an error: an untraced change)", async () => {
      const w = await world();
      const actor = w.as(w.admin, ["config.read", "config.committeeenforcement.set"]);
      await cfgForGovernanceSettings().setCommitteeEnforcement(actor, false, NUL, "r1").catch(() => undefined);
      expect(await enforcedOf(w.tenant), "enforcement state").toBe(true); // oracle: refused, nothing written
      expect(await w.auditRows("Config")).toEqual([]);
    });

    it("F-PNL2-06b: same for config.cumul.set (Committee + Audit cumul)", async () => {
      const w = await world();
      const actor = w.as(w.admin, ["config.read", "config.cumul.set"]);
      await cfgForGovernanceSettings().setCommitteeAuditCumul(actor, false, NUL, "r1").catch(() => undefined);
      expect((await rows<{ a: boolean }>(`SELECT committee_audit_cumul_allowed AS a FROM configs WHERE tenant_id = $1`, [w.tenant]))[0]?.a ?? true).toBe(true);
    });

    it("the HTTP face: PUT /config/committee-enforcement with a NUL reason is answered 400 (reasonText on the body)", async () => {
      const w = await world();
      const users = new Map<string, AuthenticatedUser>([["admin", w.as(w.admin, ["config.read", "config.committeeenforcement.set"])]]);
      const srv = await serve((app) => { app.use(withUser(users)); app.use("/api/v1/config", configRouter(cfgForGovernanceSettings())); }, () => undefined);
      try {
        const res = await call(srv.base, "admin", "PUT", "/api/v1/config/committee-enforcement", { enforced: false, reason: NUL });
        expect(res.status).toBe(400);
      } finally { await srv.close(); }
    });
  });
});
