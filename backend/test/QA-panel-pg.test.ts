import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresGovernanceDesignationRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceDesignationRepository.js";
import { PostgresOrganizationProfileRepository } from "../src/infrastructure/database/postgres/PostgresOrganizationProfileRepository.js";
import { PostgresProcessRepository } from "../src/infrastructure/database/postgres/PostgresProcessRepository.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { RoleService } from "../src/services/RoleService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import { OrganizationProfileService } from "../src/services/OrganizationProfileService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import type { GovernanceDesignation } from "../src/domain/entities/GovernanceDesignation.js";
import type { GovernanceDesignationRepository } from "../src/domain/repositories/GovernanceDesignationRepository.js";
import { QUESTIONNAIRE_VERSION } from "../src/domain/governance/organizationQuestionnaire.js";
import type { OrganizationAnswers } from "../src/domain/governance/organizationQuestionnaire.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-panel on REAL PostgreSQL (socket, never Neon). Skipped unless QA_SWP_PGHOST is a unix socket directory.
 *   QA_SWP_PGHOST=/tmp/claude-0/pgsock QA_SWP_PGPORT=5531 QA_SWP_PGDB=grc_qa_a08 (default), migrations 001..071 applied.
 * Every test creates its own tenant (unique), nothing is shared between tests.
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const enabled = HOST.startsWith("/");

const asUser = (tenantId: string, userId: string, roles: string[]): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x`, displayName: userId, roles }) as unknown as AuthenticatedUser;

describe.skipIf(!enabled)("QA-panel real PostgreSQL", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({
      host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08",
      max: 10, application_name: "qa-panel-own",
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS qa_panel_fail_audit (tenant_id uuid)`);
    await pool.query(`CREATE OR REPLACE FUNCTION qa_panel_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM qa_panel_fail_audit q WHERE q.tenant_id = NEW.tenant_id) THEN RAISE EXCEPTION 'qa-panel: audit insert refused'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`DROP TRIGGER IF EXISTS qa_panel_fail_audit_trg ON audit_log`);
    await pool.query(`CREATE TRIGGER qa_panel_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_panel_fail_audit_fn()`);
  });
  afterAll(async () => {
    await pool?.query(`DROP TRIGGER IF EXISTS qa_panel_fail_audit_trg ON audit_log`);
    await pool?.query(`DROP FUNCTION IF EXISTS qa_panel_fail_audit_fn()`);
    await pool?.query(`DROP TABLE IF EXISTS qa_panel_fail_audit`);
    await pool?.end();
  });

  const one = async <T = string>(sql: string, p: unknown[] = []) => ((await pool.query(sql, p)).rows[0] ?? {}) as Record<string, T>;
  const rows = async <T extends object = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows;

  async function tenantWorld() {
    const tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qa-panel-${randomUUID()}`]))["id"]!;
    const user = async (n: string) =>
      (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1,$2,$3) RETURNING id`, [tenant, `${n}-${randomUUID()}@qa-panel.test`, n]))["id"]!;
    const role = async (name: string, permissions: string[], systemGroup: string | null = null) =>
      (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, name, permissions, systemGroup]))["id"]!;
    const grant = async (roleId: string, userId: string, by: string) =>
      (await one(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1,$2,$3,$4) RETURNING id`, [tenant, roleId, userId, by]))["id"]!;
    const audits = (entityId: string) => rows<{ action: string; governance_exception: string | null; entity_type: string }>(
      `SELECT action, governance_exception, entity_type FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 ORDER BY "timestamp"`, [tenant, entityId]);
    return { tenant, user, role, grant, audits };
  }

  // =============================================================================================================
  // (b) D2c: hand-over of the last Risk Manager
  // =============================================================================================================
  async function d2cWorld(designationsOverride?: (real: GovernanceDesignationRepository) => GovernanceDesignationRepository) {
    const w = await tenantWorld();
    const [adminA, adminB, leaving, interim, newcomer] = [await w.user("adminA"), await w.user("adminB"), await w.user("leaving"), await w.user("interim"), await w.user("newcomer")] as [string, string, string, string, string];
    const rm = await w.role("Risk Manager", ["risk.read"], "RISK_MANAGER");
    const auditRole = await w.role("Audit", ["audit.read"], "AUDIT");
    const lecteur = await w.role("Lecteur", ["risk.read"]);
    await w.grant(rm, leaving, adminA);
    await w.grant(lecteur, leaving, adminA); // the leaving member keeps another role (a user cannot lose their last role)
    const realDesignations = new PostgresGovernanceDesignationRepository(pool);
    const designations = designationsOverride ? designationsOverride(realDesignations) : realDesignations;
    const roleRepo = new PostgresRoleRepository(pool);
    const userRepo = new PostgresUserRepository(pool);
    const audit = new PostgresAuditRepository(pool);
    const svc = new RoleService(roleRepo, audit, userRepo, undefined, undefined, undefined, undefined, undefined, designations);
    const designationSvc = new GovernanceDesignationService(realDesignations, audit, userRepo, roleRepo);
    const adminActor = (id: string) => asUser(w.tenant, id, ["role.assign", "role.read", "designation.manage"]);
    const designate = async (validUntil = new Date(Date.now() + 86_400_000)) =>
      realDesignations.create({ tenantId: w.tenant, kind: "RISK_MANAGER_INTERIM", userId: interim, reason: "intérim", validUntil, designatedBy: adminA });
    const members = async () =>
      (await rows<{ user_id: string }>(`SELECT user_id FROM user_roles WHERE tenant_id=$1 AND role_id=$2 AND revoked_at IS NULL`, [w.tenant, rm])).map((r) => r.user_id).sort();
    const designationRow = async (id: string) => (await rows<{ activated_at: Date | null; ended_at: Date | null }>(`SELECT activated_at, ended_at FROM governance_designations WHERE id=$1`, [id]))[0]!;
    return { ...w, adminA, adminB, leaving, interim, newcomer, rm, auditRole, lecteur, svc, designationSvc, adminActor, designate, members, designationRow, designationsRepo: realDesignations };
  }
  const DOMAIN_ERRORS = ["ConflictError", "NotFoundError", "ValidationError", "ForbiddenError"];

  it("D2c: two administrators remove the last Risk Manager at the same time -> exactly one hand-over, one domain error, never two audits or two members", async () => {
    const w = await d2cWorld();
    const d = await w.designate();
    const results = await Promise.allSettled([
      w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ"),
      w.svc.revokeFromUser(w.adminActor(w.adminB), w.rm, w.leaving, "r2", "départ"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(DOMAIN_ERRORS).toContain((failure.reason as Error).name);
    expect(await w.members()).toEqual([w.interim]);
    expect((await w.designationRow(d.id)).activated_at).not.toBeNull();
    const a = await w.audits(w.rm);
    expect(a.filter((x) => x.action === "ROLE_CHANGE")).toHaveLength(2); // revoke + assign of ONE hand-over
    expect(a.some((x) => x.governance_exception)).toBe(false);
  });

  it("D2c: hand-over racing an ordinary assignment of a new Risk Manager -> never empty; if the departure loses it gets a 'retry' Conflict, and the retry succeeds WITHOUT consuming the interim", async () => {
    // run it several times: the interleaving is not deterministic, the invariants are
    for (let i = 0; i < 6; i++) {
      const w = await d2cWorld();
      const d = await w.designate();
      await w.grant(w.lecteur, w.newcomer, w.adminA);
      const [assign, revoke] = await Promise.allSettled([
        w.svc.assignToUser(w.adminActor(w.adminB), w.rm, w.newcomer, "r2", "arrivée"),
        w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ"),
      ]);
      expect((await w.members()).length).toBeGreaterThanOrEqual(1);
      if (assign.status === "rejected") expect(DOMAIN_ERRORS).toContain((assign.reason as Error).name);
      if (revoke.status === "rejected") {
        expect((revoke.reason as Error).name).toBe("ConflictError");
        expect((revoke.reason as Error).message).toMatch(/retry/);
        await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r3", "départ"); // ordinary path now
      }
      const m = await w.members();
      expect(m).not.toContain(w.leaving);
      const used = Boolean((await w.designationRow(d.id)).activated_at);
      expect(used).toBe(m.includes(w.interim));
      if (assign.status === "fulfilled") expect(m).toContain(w.newcomer);
    }
  });

  it("D2c: two Risk Managers removed at once, both with confirmEmptyGroup -> the atomic guard keeps one", async () => {
    const w = await d2cWorld();
    await w.grant(w.rm, w.newcomer, w.adminA);
    await w.grant(w.lecteur, w.newcomer, w.adminA);
    const results = await Promise.allSettled([
      w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ", true),
      w.svc.revokeFromUser(w.adminActor(w.adminB), w.rm, w.newcomer, "r2", "départ", true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await w.members())).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(DOMAIN_ERRORS).toContain((failure.reason as Error).name);
  });

  it("D2c: two removals of the last Risk Manager both confirming the empty group -> one vacancy row, the second a 404-style domain error", async () => {
    const w = await d2cWorld();
    const results = await Promise.allSettled([
      w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ", true),
      w.svc.revokeFromUser(w.adminActor(w.adminB), w.rm, w.leaving, "r2", "départ", true),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(DOMAIN_ERRORS).toContain((failure.reason as Error).name);
    expect(await w.members()).toEqual([]);
    expect((await w.audits(w.rm)).filter((x) => x.governance_exception === "riskManager.vacancy")).toHaveLength(1);
  });

  it("D2c: interim suspended between the service check and the transaction -> rolled back, nothing activated, the confirmed empty-group exit then works", async () => {
    let interimId = "";
    const w = await d2cWorld((real) => ({
      ...real,
      getById: real.getById.bind(real), list: real.list.bind(real), create: real.create.bind(real), end: real.end.bind(real),
      getActive: async (t, k) => {
        const d = await real.getActive(t, k);
        if (d) await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [interimId]); // suspension lands right after the read
        return d;
      },
    }));
    interimId = w.interim;
    const d = await w.designate();
    await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ")).rejects.toMatchObject({ name: "ValidationError" });
    expect(await w.members()).toEqual([w.leaving]);
    expect((await w.designationRow(d.id)).activated_at).toBeNull();
    expect(await w.audits(w.rm)).toEqual([]);
    // the interim is now suspended: the ordinary q149 path (reason + confirmation) is available
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r2", "départ", true);
    expect(await w.members()).toEqual([]);
  });

  it("D2c: a cumul rule broken AFTER the designation (interim joined Audit) -> the whole departure rolls back", async () => {
    const w = await d2cWorld();
    const d = await w.designate();
    await w.grant(w.auditRole, w.interim, w.adminA);
    await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ")).rejects.toMatchObject({ name: "ValidationError" });
    expect(await w.members()).toEqual([w.leaving]);
    expect((await w.designationRow(d.id)).activated_at).toBeNull();
    expect(await w.audits(w.rm)).toEqual([]);
    expect(await rows(`SELECT 1 FROM user_roles WHERE tenant_id=$1 AND role_id=$2 AND user_id=$3`, [w.tenant, w.rm, w.interim])).toEqual([]);
  });

  // F-PNL-01 (MAJOR): the unusable interim also blocks the confirmed "empty group" exit (q149 says the departure with
  // reason + confirmation is ACCEPTED when no usable interim exists; DECISION-066: never block).
  it("F-PNL-01: an interim who can no longer receive the role (cumul) must not block the confirmed departure", async () => {
    const w = await d2cWorld();
    await w.designate();
    await w.grant(w.auditRole, w.interim, w.adminA);
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ", true);
    expect(await w.members()).toEqual([]);
  });

  it("D2c: an audit failure inside the hand-over rolls back revoke, assignment and activation", async () => {
    const w = await d2cWorld();
    const d = await w.designate();
    await pool.query(`INSERT INTO qa_panel_fail_audit VALUES ($1)`, [w.tenant]);
    try {
      await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ")).rejects.toThrow(/audit insert refused/);
    } finally {
      await pool.query(`DELETE FROM qa_panel_fail_audit WHERE tenant_id = $1`, [w.tenant]);
    }
    expect(await w.members()).toEqual([w.leaving]);
    expect((await w.designationRow(d.id)).activated_at).toBeNull();
    // and nothing is left half done: the same call now succeeds
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r2", "départ");
    expect(await w.members()).toEqual([w.interim]);
  });

  it("D2c: an audit failure in the confirmed empty-group exit rolls the revoke back", async () => {
    const w = await d2cWorld();
    await pool.query(`INSERT INTO qa_panel_fail_audit VALUES ($1)`, [w.tenant]);
    try {
      await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ", true)).rejects.toThrow(/audit insert refused/);
    } finally {
      await pool.query(`DELETE FROM qa_panel_fail_audit WHERE tenant_id = $1`, [w.tenant]);
    }
    expect(await w.members()).toEqual([w.leaving]);
  });

  it("D2c: an expired designation is not used; without the confirmation the departure is refused, with it the group is left empty and the designation untouched", async () => {
    const w = await d2cWorld();
    const d = await w.designate(new Date(Date.now() + 86_400_000));
    await pool.query(`UPDATE governance_designations SET valid_until = now() - interval '1 minute' WHERE id = $1`, [d.id]);
    await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ")).rejects.toMatchObject({ name: "ValidationError" });
    expect(await w.members()).toEqual([w.leaving]);
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r2", "départ", true);
    expect(await w.members()).toEqual([]);
    expect((await w.designationRow(d.id)).activated_at).toBeNull();
    expect((await w.audits(w.rm)).map((x) => x.governance_exception)).toEqual(["riskManager.vacancy"]);
  });

  it("D2c: the designation of the leaving member himself, or of the acting administrator, is not a usable interim", async () => {
    const w = await d2cWorld();
    // interim == acting administrator (inserted directly: the service forbids self-designation, the table only checks designated_by <> user_id)
    await pool.query(
      `INSERT INTO governance_designations (tenant_id, kind, user_id, reason, valid_until, designated_by) VALUES ($1,'RISK_MANAGER_INTERIM',$2,'x',now()+interval '1 day',$3)`,
      [w.tenant, w.adminB, w.adminA]);
    await expect(w.svc.revokeFromUser(w.adminActor(w.adminB), w.rm, w.leaving, "r1", "départ")).rejects.toMatchObject({ name: "ValidationError" });
    expect(await w.members()).toEqual([w.leaving]);
  });

  it("D2c: removing a NON member from a group with a single Risk Manager and an interim never touches the real member", async () => {
    const w = await d2cWorld();
    const d = await w.designate();
    await w.grant(w.lecteur, w.newcomer, w.adminA);
    const err = await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.newcomer, "r1", "x").catch((e: Error) => e);
    expect(DOMAIN_ERRORS).toContain((err as Error).name);
    expect(await w.members()).toEqual([w.leaving]);
    expect((await w.designationRow(d.id)).activated_at).toBeNull();
  });

  // F-PNL-02 (MINOR): wrong diagnosis. Revoking someone who is not a member says "retry" (Conflict) when an interim exists,
  // and "Cannot remove the last member" otherwise, instead of "not a member" (404).
  it("F-PNL-02: revoking a user who is not in the Risk Manager group answers NotFound, whatever the interim", async () => {
    const w = await d2cWorld();
    await w.designate();
    await w.grant(w.lecteur, w.newcomer, w.adminA);
    await expect(w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.newcomer, "r1", "x")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("D2c: after a hand-over the USED designation stays active (ended_at NULL), is never reusable, and blocks any new interim until ended", async () => {
    const w = await d2cWorld();
    const d = await w.designate();
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ");
    const next = await w.designationSvc.designate(w.adminActor(w.adminA), { kind: "RISK_MANAGER_INTERIM", userId: w.newcomer, reason: "suite", validUntil: new Date(Date.now() + 1e9) }, "r2")
      .catch((e: Error) => e);
    expect((next as Error).name).toBe("ConflictError"); // pinned: the admin must end the used designation first (F-PNL-09, INFO)
    const ended = await w.designationSvc.end(w.adminActor(w.adminA), d.id, "intérim terminé", "r3");
    expect(ended.endedAt).not.toBeNull();
    expect(await w.members()).toEqual([w.interim]); // ending never removes the role the interim received
  });

  it("D2c: designations are tenant scoped (read, end, designate)", async () => {
    const a = await d2cWorld();
    const b = await d2cWorld();
    const da = await a.designate();
    expect(await b.designationSvc.list(b.adminActor(b.adminA), true)).toEqual([]);
    await expect(b.designationSvc.end(b.adminActor(b.adminA), da.id, "x", "r")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(b.designationSvc.end(b.adminActor(b.adminA), da.id.toUpperCase(), "x", "r")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(b.designationSvc.designate(b.adminActor(b.adminA), { kind: "MANAGER", userId: a.newcomer, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    expect((await a.designationRow(da.id)).ended_at).toBeNull();
    // self-designation with an upper-case id is still refused
    await expect(a.designationSvc.designate(a.adminActor(a.adminB), { kind: "MANAGER", userId: a.adminB.toUpperCase(), reason: "x" }, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  // =============================================================================================================
  // (c) D3: organization profile
  // =============================================================================================================
  const TPE: OrganizationAnswers = { Q1: 5, Q2: 0, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "NO" };
  const PME: OrganizationAnswers = { Q1: 50, Q2: 1, Q5: "NO", Q7: "NO", Q8: "NO", Q11: "UNKNOWN" };
  const GE: OrganizationAnswers = { Q1: 300, Q2: 4, Q5: "YES", Q7: "YES", Q8: "FORMAL", Q11: "YES" };
  const QV = QUESTIONNAIRE_VERSION;

  async function d3World(opts: { thirdParty?: boolean } = {}) {
    const w = await tenantWorld();
    const [admin, admin2, approver] = [await w.user("admin"), await w.user("admin2"), await w.user("approver")] as [string, string, string];
    if (opts.thirdParty !== false) {
      const rm = await w.role("Risk Manager", ["orgprofile.approve"], "RISK_MANAGER");
      await w.grant(rm, approver, admin);
    }
    const repo = new PostgresOrganizationProfileRepository(pool);
    const audit = new PostgresAuditRepository(pool);
    const svc = new OrganizationProfileService(repo, audit);
    const submitter = (id = admin) => asUser(w.tenant, id, ["orgprofile.read", "orgprofile.submit"]);
    const approverActor = (id = approver) => asUser(w.tenant, id, ["orgprofile.read", "orgprofile.approve"]);
    const submit = (answers: OrganizationAnswers, who = admin, reason = "mise à jour") =>
      svc.submit(submitter(who), { questionnaireVersion: QV, answers, reason }, randomUUID());
    const statuses = async () => (await rows<{ version: number; status: string; regime: string | null }>(
      `SELECT version, status, regime FROM organization_profiles WHERE tenant_id=$1 ORDER BY version`, [w.tenant]));
    return { ...w, admin, admin2, approver, repo, audit, svc, submitter, approverActor, submit, statuses };
  }

  it("D3: size changes: first submit and upgrades apply at once; a downgrade with a third party waits, and the active size does not move meanwhile", async () => {
    const w = await d3World();
    expect((await w.submit(PME)).status).toBe("ACTIVE");
    expect((await w.submit(GE)).status).toBe("ACTIVE"); // upgrade
    const pending = await w.submit(TPE); // GE -> TPE with a third party
    expect(pending.status).toBe("PENDING");
    const view = await w.svc.get(w.submitter());
    expect(view.classification?.value).toBe("GRANDE_ENTREPRISE");
    expect(view.pendingClassification?.value).toBe("TPE");
    expect(await w.statuses()).toEqual([
      { version: 1, status: "SUPERSEDED", regime: null }, { version: 2, status: "ACTIVE", regime: null }, { version: 3, status: "PENDING", regime: null },
    ]);
  });

  it("D3: the author cannot confirm or reject; a third party confirms: ACTIVE + CONFIRMED, previous SUPERSEDED, audited by the approver", async () => {
    const w = await d3World();
    await w.submit(GE);
    const pending = await w.submit(TPE);
    await expect(w.svc.approve(w.approverActor(w.admin), pending.id, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(w.svc.reject(w.approverActor(w.admin), pending.id, "non", "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    // the database refuses it too (CHECK), whatever the service says
    await expect(pool.query(`UPDATE organization_profiles SET status='ACTIVE', regime='CONFIRMED', decided_by=submitted_by, decided_at=now() WHERE id=$1`, [pending.id]))
      .rejects.toThrow();
    const approved = await w.svc.approve(w.approverActor(), pending.id, "r-ok");
    expect(approved).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", decidedBy: w.approver });
    expect((await w.statuses()).map((s) => s.status)).toEqual(["SUPERSEDED", "ACTIVE"]);
    const a = await w.audits(pending.id);
    expect(a.map((x) => x.action)).toEqual(["SUBMIT", "APPROVE"]);
    await expect(w.svc.approve(w.approverActor(), pending.id, "again")).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("D3: downgrade with NO third party applies at once, regime ALONE, journal marked orgprofile.adminAlone", async () => {
    const w = await d3World({ thirdParty: false });
    await w.submit(GE);
    const v = await w.submit(TPE);
    expect(v).toMatchObject({ status: "ACTIVE", regime: "ALONE" });
    expect((await w.audits(v.id))[0]).toMatchObject({ action: "SUBMIT", governance_exception: "orgprofile.adminAlone" });
  });

  it("D3: the third party counted is another person: an administrator who is himself the only Risk Manager is still 'alone'", async () => {
    const w = await d3World({ thirdParty: false });
    const rm = await w.role("Risk Manager", [], "RISK_MANAGER");
    await w.grant(rm, w.admin, w.admin2);
    await w.submit(GE);
    expect((await w.submit(TPE)).regime).toBe("ALONE");
  });

  it("D3: a second submission while one waits is a ConflictError, also when two arrive at the same time (one PENDING, never two)", async () => {
    const w = await d3World();
    await w.submit(GE);
    const results = await Promise.allSettled([w.submit(TPE, w.admin), w.submit({ ...TPE, Q1: 6 }, w.admin2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failure.reason as Error).name).toBe("ConflictError");
    expect((await w.statuses()).filter((s) => s.status === "PENDING")).toHaveLength(1);
  });

  it("D3: confirm and reject at the same time -> one wins, the other a NotFoundError, exactly one ACTIVE remains", async () => {
    const w = await d3World();
    await w.submit(GE);
    const pending = await w.submit(TPE);
    const second = await w.user("approver2");
    const results = await Promise.allSettled([w.svc.approve(w.approverActor(), pending.id, "r1"), w.svc.reject(w.approverActor(second), pending.id, "non", "r2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(["NotFoundError", "ValidationError"]).toContain((failure.reason as Error).name);
    const s = await w.statuses();
    expect(s.filter((x) => x.status === "ACTIVE")).toHaveLength(1);
    expect(s.filter((x) => x.status === "PENDING")).toHaveLength(0);
  });

  // F-PNL-08 (MINOR): a waiting version has no exit when its only possible approver disappears. The author cannot
  // withdraw or reject it (maker-checker), nobody else holds orgprofile.approve, and while it waits NO new version (not even
  // an upgrade) can be submitted. Pinned as observed; the fix is a product choice (withdraw by the author, or expiry).
  it("D3: the third party suspended while a reduction waits -> pending is stuck: no withdrawal, no new submission (observed, F-PNL-08)", async () => {
    const w = await d3World();
    await w.submit(GE);
    const pending = await w.submit(TPE);
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [w.approver]);
    await expect(w.svc.reject(w.submitter(), pending.id, "je retire", "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(w.svc.approve(w.submitter(w.admin2), pending.id, "r")).rejects.toMatchObject({ name: "ForbiddenError" }); // no orgprofile.approve
    await expect(w.submit(GE, w.admin2)).rejects.toMatchObject({ name: "ConflictError" }); // an upgrade is blocked too
    expect((await w.statuses()).filter((s) => s.status === "PENDING")).toHaveLength(1);
  });

  it("D3: reject keeps the active version, records the reason, and the author may then submit again", async () => {
    const w = await d3World();
    await w.submit(GE);
    const pending = await w.submit(TPE);
    const rejected = await w.svc.reject(w.approverActor(), pending.id, "pas assez d'éléments", "r");
    expect(rejected).toMatchObject({ status: "REJECTED", decisionReason: "pas assez d'éléments" });
    expect((await w.svc.get(w.submitter())).classification?.value).toBe("GRANDE_ENTREPRISE");
    expect((await w.submit(TPE)).status).toBe("PENDING");
  });

  // F-PNL-03 (MAJOR): time-of-check/time-of-use on the size comparison. "Lowers the size" is decided from the active
  // version read BEFORE the transaction; a concurrent upgrade makes the second submission look neutral and it replaces the
  // new active version with no second confirmation.
  it("F-PNL-03: a submission prepared against a stale active version cannot lower the size without the second confirmation", async () => {
    const w = await d3World();
    await w.submit(PME); // active: PME
    let reached!: () => void;
    const atGate = new Promise<void>((r) => { reached = r; });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    class Stalled extends PostgresOrganizationProfileRepository {
      override async insertVersion(...args: Parameters<PostgresOrganizationProfileRepository["insertVersion"]>) {
        reached();
        await gate;
        return super.insertVersion(...args);
      }
    }
    const slow = new OrganizationProfileService(new Stalled(pool), w.audit);
    const lowering = slow.submit(w.submitter(w.admin2), { questionnaireVersion: QV, answers: { ...PME, Q1: 60 }, reason: "même taille" }, randomUUID());
    await atGate; // the slow request has read active = PME and found "not lowering"
    await w.submit(GE); // meanwhile another administrator upgrades to GE (immediate)
    release();
    const late = await lowering.catch((e: Error) => e);
    const s = await w.statuses();
    // ideal: the late PME-class version cannot become ACTIVE over a GE version without a third party confirming
    expect(s.filter((x) => x.status === "ACTIVE" && x.regime === null && x.version === 3)).toEqual([]);
    expect(late).toBeDefined();
  });

  it("D3: version content and history are immutable at the database; transitions are limited; no delete, no truncate", async () => {
    const w = await d3World();
    const v1 = await w.submit(PME);
    const v2 = await w.submit(GE);
    await expect(pool.query(`UPDATE organization_profiles SET answers = '{}'::jsonb WHERE id=$1`, [v2.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE organization_profiles SET reason = 'x' WHERE id=$1`, [v2.id])).rejects.toThrow(/immutable/);
    await expect(pool.query(`UPDATE organization_profiles SET status='ACTIVE' WHERE id=$1`, [v1.id])).rejects.toThrow(/not allowed|unique/);
    await expect(pool.query(`UPDATE organization_profiles SET regime='ALONE' WHERE id=$1`, [v2.id])).rejects.toThrow(/set once/);
    await expect(pool.query(`DELETE FROM organization_profiles WHERE id=$1`, [v1.id])).rejects.toThrow(/never deleted/);
    await expect(pool.query(`TRUNCATE organization_profiles`)).rejects.toThrow(/cannot be truncated/);
    expect(await w.statuses()).toHaveLength(2);
  });

  it("D3: tenant scoping: another tenant's pending version can be neither confirmed nor rejected, and is not listed", async () => {
    const a = await d3World();
    const b = await d3World();
    await a.submit(GE);
    const pending = await a.submit(TPE);
    await expect(b.svc.approve(b.approverActor(), pending.id, "r")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(b.svc.reject(b.approverActor(), pending.id, "non", "r")).rejects.toMatchObject({ name: "NotFoundError" });
    expect((await b.svc.get(b.submitter())).history).toEqual([]);
    expect((await a.statuses()).map((s) => s.status)).toContain("PENDING");
  });

  it("D3: input edges: stale questionnaire version, unknown/missing question, out-of-range, Q2 > Q1 (accepted: pinned)", async () => {
    const w = await d3World();
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: "0.1", answers: PME, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: { ...PME, Q3: 1 }, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: { ...PME, Q1: 0 }, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: { ...PME, Q1: 1.5 }, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: { ...PME, Q8: "MAYBE" }, reason: "x" }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: PME, reason: "  " }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(w.svc.submit(w.submitter(), { questionnaireVersion: QV, answers: PME, reason: "x".repeat(501) }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    expect(await w.statuses()).toEqual([]);
    // pinned (F-PNL-10, INFO): 500 people in the risk function out of a headcount of 1 is accepted
    expect((await w.submit({ ...PME, Q1: 1, Q2: 500 })).status).toBe("ACTIVE");
  });

  it("D3: observed accounts raise the size (the more demanding of declared and observed applies); a downgrade stays a downgrade against that floor", async () => {
    const w = await d3World({ thirdParty: false });
    for (let i = 0; i < 25; i++) await w.user(`extra${i}`); // 28 active accounts: above the TPE limit (20)
    const v = await w.submit(TPE); // declared TPE but 28 accounts observed -> PME
    expect((await w.svc.get(w.submitter())).classification?.value).toBe("PME");
    expect(v.status).toBe("ACTIVE");
  });

  // =============================================================================================================
  // (e) D2b / D4 / D2a: tenant scoping, identifiers, permissions on the other new surfaces
  // =============================================================================================================
  async function processWorld() {
    const w = await tenantWorld();
    const [assigner, candidate, other] = [await w.user("assigner"), await w.user("candidate"), await w.user("other")] as [string, string, string];
    const processId = (await one(`INSERT INTO processes (tenant_id, level, name, owner) VALUES ($1,'PROCESS',$2,'Candidate') RETURNING id`, [w.tenant, `p-${randomUUID()}`]))["id"]!;
    const svc = new ProcessService(new PostgresProcessRepository(pool), new PostgresAuditRepository(pool), undefined, undefined, undefined, undefined, new PostgresUserRepository(pool));
    const actor = (roles = ["process.read", "process.responsibility.assign"], id = assigner) => asUser(w.tenant, id, roles);
    return { ...w, assigner, candidate, other, processId, svc, actor };
  }

  it("D2b: responsibilities: omitted = untouched, null = cleared, cross-tenant / suspended / unknown accounts refused, other tenant's process 404", async () => {
    const w = await processWorld();
    const foreign = await tenantWorld();
    const foreignUser = await foreign.user("foreign");
    const suspended = await w.user("susp");
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [suspended]);
    const set = await w.svc.setResponsibilities(w.actor(), w.processId, { ownerUserId: w.candidate, deputyUserId: w.other }, "r");
    expect(set).toMatchObject({ ownerUserId: w.candidate, deputyUserId: w.other, riskChampionUserId: null });
    const cleared = await w.svc.setResponsibilities(w.actor(), w.processId, { deputyUserId: null }, "r");
    expect(cleared).toMatchObject({ ownerUserId: w.candidate, deputyUserId: null });
    for (const bad of [foreignUser, suspended, randomUUID()]) {
      await expect(w.svc.setResponsibilities(w.actor(), w.processId, { riskChampionUserId: bad }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    }
    await expect(w.svc.setResponsibilities(w.actor(["process.read", "process.responsibility.assign"], w.assigner), randomUUID(), { ownerUserId: w.candidate }, "r")).rejects.toMatchObject({ name: "NotFoundError" });
    const otherTenant = asUser(foreign.tenant, foreignUser, ["process.read", "process.responsibility.assign"]);
    await expect(w.svc.setResponsibilities(otherTenant, w.processId, { ownerUserId: foreignUser }, "r")).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(w.svc.setResponsibilities(w.actor(["process.read", "process.update"]), w.processId, { ownerUserId: w.other }, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    expect((await rows<{ owner_user_id: string }>(`SELECT owner_user_id FROM processes WHERE id=$1`, [w.processId]))[0]!.owner_user_id).toBe(w.candidate);
  });

  it("D2b: nobody designates themselves (lower case)", async () => {
    const w = await processWorld();
    for (const key of ["ownerUserId", "riskChampionUserId", "deputyUserId"] as const) {
      await expect(w.svc.setResponsibilities(w.actor(), w.processId, { [key]: w.assigner }, "r")).rejects.toMatchObject({ name: "ValidationError" });
    }
  });

  // F-PNL-06 (MAJOR, to confirm with Security): the self-designation guard compares raw text. Postgres reads the upper-case
  // form of the same uuid as the same account (QA-B6d-01 / SEC-ID-01 were the same class; RoleService and
  // GovernanceDesignationService call canonicalId, ProcessService does not).
  it("F-PNL-06: the upper-case form of one's own id is still a self-designation", async () => {
    const w = await processWorld();
    await expect(w.svc.setResponsibilities(w.actor(), w.processId, { ownerUserId: w.assigner.toUpperCase() }, "r")).rejects.toMatchObject({ name: "ValidationError" });
  });

  // Second symptom of F-PNL-06: the same raw comparison sees the upper-case form of the CURRENT owner as a change.
  it("F-PNL-06b: naming the current owner again (upper-case id) is a no-op: no audit row, no write", async () => {
    const w = await processWorld();
    await w.svc.setResponsibilities(w.actor(), w.processId, { ownerUserId: w.candidate }, "r1");
    const before = (await w.audits(w.processId)).length;
    await w.svc.setResponsibilities(w.actor(), w.processId, { ownerUserId: w.candidate.toUpperCase() }, "r2");
    expect((await w.audits(w.processId)).length - before).toBe(0);
  });

  it("D2b: the legacy owner text is proposed to an assigner only, never applied, and a proposal from another tenant never appears", async () => {
    const w = await processWorld();
    const view = await w.svc.getResponsibilities(w.actor(), w.processId);
    expect(view.ownerCandidates.map((c) => c.id)).toEqual([w.candidate]); // 'Candidate' matches display name
    expect(view.ownerUserId).toBeNull();
    expect((await w.svc.getResponsibilities(w.actor(["process.read"]), w.processId)).ownerCandidates).toEqual([]);
    const twin = await tenantWorld();
    await twin.user("Candidate");
    expect((await w.svc.getResponsibilities(w.actor(), w.processId)).ownerCandidates.map((c) => c.id)).toEqual([w.candidate]);
  });

  it("D4: setSelfValidationPolicy writes only the caller's tenant config and audits before/after with the marker", async () => {
    const a = await tenantWorld();
    const b = await tenantWorld();
    const adminA = await a.user("admin");
    const svc = new ConfigService(new PostgresConfigRepository(pool), new PostgresAuditRepository(pool), undefined, undefined, new PostgresGovernanceQueries(pool));
    const after = await svc.setSelfValidationPolicy(asUser(a.tenant, adminA, ["config.read", "config.selfvalidation.set"]), "DOUBLE_CONFIRMATION", "structure à une personne", "r");
    expect(after.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
    expect(await rows(`SELECT 1 FROM configs WHERE tenant_id=$1 AND self_validation_policy='DOUBLE_CONFIRMATION'`, [b.tenant])).toEqual([]);
    const a1 = await rows<{ governance_exception: string | null }>(`SELECT governance_exception FROM audit_log WHERE tenant_id=$1 AND entity_type='Config'`, [a.tenant]);
    expect(a1.map((x) => x.governance_exception)).toEqual(["config.selfvalidation.adminAlone"]);
    // a database CHECK refuses a value outside the two policies
    await expect(pool.query(`UPDATE configs SET self_validation_policy='ALLOW' WHERE tenant_id=$1`, [a.tenant])).rejects.toThrow();
  });

  it("D4: the real validator query ignores a maker, a suspended account, a revoked assignment, a disabled role and another tenant", async () => {
    const w = await tenantWorld();
    const q = new PostgresGovernanceQueries(pool);
    const [me, maker, suspended, revoked, onDeleted, holder] = [await w.user("me"), await w.user("maker"), await w.user("susp"), await w.user("rev"), await w.user("del"), await w.user("holder")] as string[] as [string, string, string, string, string, string];
    const role = await w.role("V", ["actionplan.validate"]);
    const deleted = await w.role("D", ["actionplan.validate"]);
    for (const u of [maker, suspended]) await w.grant(role, u, me);
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [suspended]);
    await pool.query(`UPDATE user_roles SET revoked_at = now() WHERE id = $1`, [await w.grant(role, revoked, me)]);
    await w.grant(deleted, onDeleted, me);
    await pool.query(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [deleted]);
    expect(await q.existsOther(w.tenant, me, "actionplan.validate", [maker])).toBe(false);
    await w.grant(role, holder, me);
    expect(await q.existsOther(w.tenant, me, "actionplan.validate", [maker])).toBe(true);
    expect(await q.existsOther(w.tenant, me, "actionplan.validate", [maker, holder])).toBe(false);
    // upper-case ids in the exclusion list still exclude (uuid cast)
    expect(await q.existsOther(w.tenant, me.toUpperCase(), "actionplan.validate", [maker.toUpperCase(), holder.toUpperCase()])).toBe(false);
  });

  it("D2a: last_seen_at is written at most once an hour, only for an active user of the right tenant, and a failing pool never throws", async () => {
    const a = await tenantWorld();
    const b = await tenantWorld();
    const u = await a.user("seen");
    const susp = await a.user("susp");
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [susp]);
    const record = createLastSeenRecorder(pool);
    record(b.tenant, u); // wrong tenant
    record(a.tenant, susp); // suspended
    record(a.tenant, u);
    await new Promise((r) => setTimeout(r, 300));
    const get = async (id: string) => (await one<Date | null>(`SELECT last_seen_at FROM users WHERE id=$1`, [id]))["last_seen_at"] ?? null;
    const first = await get(u);
    expect(first).not.toBeNull();
    expect(await get(susp)).toBeNull();
    record(a.tenant, u); // same process, within the hour
    await new Promise((r) => setTimeout(r, 200));
    expect((await get(u))!.getTime()).toBe(first!.getTime());
    // a different process (fresh recorder) is held by the SQL condition itself
    createLastSeenRecorder(pool)(a.tenant, u);
    await new Promise((r) => setTimeout(r, 200));
    expect((await get(u))!.getTime()).toBe(first!.getTime());
    // a failing pool: no exception, no unhandled rejection
    const broken = createLastSeenRecorder({ query: async () => { throw new Error("db down"); } } as never);
    expect(() => broken(a.tenant, u)).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
  });

  // =============================================================================================================
  // D1/D2d: governance_exception column and single-person regime guards, on a real database
  // =============================================================================================================
  it("D1: audit_log stays append-only with the new column (no UPDATE/DELETE of a marked row by the runtime role)", async () => {
    const w = await tenantWorld();
    const u = await w.user("u");
    const audit = new PostgresAuditRepository(pool);
    const entityId = randomUUID();
    await audit.record({ tenantId: w.tenant, userId: u, entityType: "X", entityId, action: "VALIDATE", oldValue: null, newValue: {}, reason: null, requestId: "r", governanceException: "noSelfValidation" });
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE grc_app_runtime");
      await expect(c.query(`UPDATE audit_log SET governance_exception = NULL WHERE entity_id = $1`, [entityId])).rejects.toThrow(/permission denied|append/i);
      await c.query("ROLLBACK");
      await c.query("BEGIN");
      await c.query("SET LOCAL ROLE grc_app_runtime");
      await expect(c.query(`DELETE FROM audit_log WHERE entity_id = $1`, [entityId])).rejects.toThrow(/permission denied|append/i);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
    expect((await audit.search(w.tenant, { governanceException: true }))!.map((e) => e.entityId)).toContain(entityId);
    expect((await audit.search(w.tenant, { governanceException: "other.rule" }))!).toEqual([]);
  });

  it("D2d: the single-person regime: declared with one person, lifted for good by the second person, never re-declared, not lifted by an inactive one", async () => {
    const w = await tenantWorld();
    const [p1, p2, p3] = [await w.user("p1"), await w.user("p2"), await w.user("p3")] as [string, string, string];
    const role = await w.role("R", ["risk.read"]);
    await w.grant(role, p1, p1);
    await pool.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id=$1`, [w.tenant]);
    const state = async () => (await rows<{ declared: Date | null; lifted: Date | null; ref: string | null }>(
      `SELECT single_person_regime_declared_at AS declared, single_person_regime_lifted_at AS lifted, single_person_regime_lift_ref AS ref FROM tenants WHERE id=$1`, [w.tenant]))[0]!;
    expect((await state()).lifted).toBeNull();
    await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [p3]); // suspended person with a role does not count
    await w.grant(role, p3, p1);
    expect((await state()).lifted).toBeNull();
    const second = await w.grant(role, p2, p1);
    const lifted = await state();
    expect(lifted.lifted).not.toBeNull();
    expect(lifted.ref).toBe(second);
    await pool.query(`UPDATE user_roles SET revoked_at = now() WHERE id = $1`, [second]); // leaving again does not re-open it
    expect((await state()).lifted).not.toBeNull();
    await expect(pool.query(`UPDATE tenants SET single_person_regime_lifted_at = NULL WHERE id=$1`, [w.tenant])).rejects.toThrow(/definitive/);
    await expect(pool.query(`UPDATE tenants SET single_person_regime_declared_at = NULL WHERE id=$1`, [w.tenant])).rejects.toThrow(/set-once/);
    await expect(pool.query(`UPDATE tenants SET single_person_regime_lift_threshold = 5 WHERE id=$1`, [w.tenant])).rejects.toThrow(/definitive/);
  });

  it("D2d: declaring the regime when two people already hold a role is refused; a threshold below 2 is refused", async () => {
    const w = await tenantWorld();
    const [p1, p2] = [await w.user("p1"), await w.user("p2")] as [string, string];
    const role = await w.role("R", ["risk.read"]);
    await w.grant(role, p1, p1);
    await w.grant(role, p2, p1);
    await expect(pool.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id=$1`, [w.tenant])).rejects.toThrow(/already reached/);
    await expect(pool.query(`UPDATE tenants SET single_person_regime_lift_threshold = 1 WHERE id=$1`, [w.tenant])).rejects.toThrow();
  });

  it("D2d + D2c: the hand-over lifts the regime only because the interim is a second person holding a role (revoke before assign, the trigger sees the true count)", async () => {
    const w = await d2cWorld();
    await pool.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id=$1`, [w.tenant]);
    // people holding a role before: leaving only (the admins have no role row)
    await w.designate();
    await w.svc.revokeFromUser(w.adminActor(w.adminA), w.rm, w.leaving, "r1", "départ");
    const lifted = (await one<Date | null>(`SELECT single_person_regime_lifted_at FROM tenants WHERE id=$1`, [w.tenant]))["single_person_regime_lifted_at"] ?? null;
    // leaving still holds "Lecteur" (active person #1) and the interim now holds the RM role (person #2): the regime IS lifted
    expect(lifted).not.toBeNull();
  });

  it("migrations: every trigger/guard function created from 058 on pins search_path with pg_temp LAST (catalog check on the live database)", async () => {
    const fns = await rows<{ proname: string; cfg: string[] | null }>(
      `SELECT p.proname, p.proconfig AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname IN ('single_person_regime_people','tenants_single_person_regime_guard','single_person_regime_lift_mark','organization_profiles_guard','organization_profiles_truncate_guard')`);
    expect(fns.map((f) => f.proname).sort()).toEqual([
      "organization_profiles_guard", "organization_profiles_truncate_guard", "single_person_regime_lift_mark", "single_person_regime_people", "tenants_single_person_regime_guard",
    ]);
    for (const f of fns) expect(f.cfg, f.proname).toContain("search_path=pg_catalog, public, pg_temp");
  });

  it("migrations: temp-table shadowing cannot disarm the new guards (a temp 'tenants'/'organization_profiles' in the session is ignored)", async () => {
    const w = await tenantWorld();
    const u = await w.user("u");
    const c = await pool.connect();
    try {
      await c.query(`CREATE TEMP TABLE user_roles (LIKE public.user_roles INCLUDING DEFAULTS)`);
      await c.query(`CREATE TEMP TABLE roles (LIKE public.roles INCLUDING DEFAULTS)`);
      await c.query(`CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS)`);
      await c.query(`UPDATE tenants SET single_person_regime_declared_at = now() WHERE id=$1`, [w.tenant]);
      const r = await c.query(`SELECT single_person_regime_people($1) AS n`, [w.tenant]);
      expect(r.rows[0].n).toBe(0); // computed from public.*, not from the (empty or filled) temp copies
      await c.query(`INSERT INTO pg_temp.users (tenant_id, email, display_name) VALUES ($1,'t@t','t')`, [w.tenant]);
      expect((await c.query(`SELECT single_person_regime_people($1) AS n`, [w.tenant])).rows[0].n).toBe(0);
    } finally {
      await c.query("DROP TABLE IF EXISTS pg_temp.user_roles, pg_temp.roles, pg_temp.users").catch(() => undefined);
      c.release();
    }
    expect(u).toBeTruthy();
  });

  it("migrations: the runtime role cannot DELETE or TRUNCATE the new append-style tables (organization_profiles) — governance_designations is checked in the next test", async () => {
    const priv = await one<boolean>(`SELECT has_table_privilege('grc_app_runtime','organization_profiles','DELETE') AS d, has_table_privilege('grc_app_runtime','organization_profiles','TRUNCATE') AS t`);
    expect(priv["d"]).toBe(false);
    expect(priv["t"]).toBe(false);
  });

  // F-PNL-07 (MINOR): 070 forgets the REVOKE that 055 and 071 do; the default privileges (043) leave DELETE to the
  // runtime role, and there is no guard trigger, so "soft end only" is a convention, not a rule, on governance_designations.
  it.fails("F-PNL-07: governance_designations is protected against physical DELETE for the runtime role", async () => {
    const priv = await one<boolean>(`SELECT has_table_privilege('grc_app_runtime','governance_designations','DELETE') AS d`);
    expect(priv["d"]).toBe(false);
  });
});
