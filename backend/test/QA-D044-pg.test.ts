import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresUserRepository } from "../src/infrastructure/database/postgres/PostgresUserRepository.js";
import { PostgresRatingScaleRepository } from "../src/infrastructure/database/postgres/PostgresRatingScaleRepository.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * QA-D044 / q90 on a REAL PostgreSQL 16 (disposable, local unix socket): the audit_log row is inserted in the
 * same transaction as the action. Skipped unless QA_D044_PGHOST is a unix socket DIRECTORY (starts with "/");
 * a TCP host / URL is refused on purpose (never a remote database). Database: QA_D044_PGDB (default grc_qa), user postgres.
 *   Prerequisite: migrations 001..058 applied on that database.
 */
const HOST = process.env.QA_D044_PGHOST ?? "";
const enabled = HOST.startsWith("/");
const DB = process.env.QA_D044_PGDB ?? "grc_qa";

const level = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const RM_PERMS = ["riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive"];

describe.skipIf(!enabled)("QA-D044 q90 on real PostgreSQL", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ host: HOST, user: "postgres", database: DB, max: 8 });
    await pool.query(`CREATE TABLE IF NOT EXISTS qa_fail_audit (tenant_id uuid, entity_type text)`);
    await pool.query(`CREATE OR REPLACE FUNCTION qa_fail_audit_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM qa_fail_audit q WHERE q.tenant_id = NEW.tenant_id AND (q.entity_type IS NULL OR q.entity_type = NEW.entity_type))
        THEN RAISE EXCEPTION 'qa: audit insert refused'; END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`DROP TRIGGER IF EXISTS qa_fail_audit_trg ON audit_log`);
    await pool.query(`CREATE TRIGGER qa_fail_audit_trg BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION qa_fail_audit_fn()`);
  });
  afterAll(async () => {
    await pool?.query(`DROP TRIGGER IF EXISTS qa_fail_audit_trg ON audit_log`);
    await pool?.query(`DROP FUNCTION IF EXISTS qa_fail_audit_fn()`);
    await pool?.query(`DROP TABLE IF EXISTS qa_fail_audit`);
    await pool?.end();
  });

  async function world(opts: { throwingHolders?: boolean } = {}) {
    const t = (await pool.query<{ id: string }>(`INSERT INTO tenants (name) VALUES ('qa-d044') RETURNING id`)).rows[0]!.id;
    const user = async (n: string) =>
      (await pool.query<{ id: string }>(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [t, `${n}-${t}@x`])).rows[0]!.id;
    const [rm1, rm2, rm3, rm4] = [await user("rm1"), await user("rm2"), await user("rm3"), await user("rm4")] as [string, string, string, string];
    const roleId = (await pool.query<{ id: string }>(
      `INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'Risk Manager', $2, 'RISK_MANAGER') RETURNING id`, [t, RM_PERMS])).rows[0]!.id;
    for (const u of [rm1, rm2, rm3, rm4]) {
      await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [t, roleId, u, rm1]);
    }
    const scaleId = (await pool.query<{ id: string }>(
      `INSERT INTO rating_scales (tenant_id, name, version, status, probability_levels, probability_labels, impact_levels, impact_labels, impact_axes)
       VALUES ($1, 's', '1', 'ACTIVE', 5, $2, 5, $2, $3) RETURNING id`,
      [t, JSON.stringify(level(5)), JSON.stringify({ axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: level(5) }], retainedImpactRule: "MAX" })])).rows[0]!.id;

    const users = new PostgresUserRepository(pool);
    const usersDep = opts.throwingHolders
      ? { getById: users.getById.bind(users), listWithPermission: async () => { throw new Error("lookup down"); } }
      : users;
    const notified: Array<{ type: string; ids: string[] }> = [];
    const notifications = {
      record: async (input: { type?: string; recipientUserId?: string }) => { notified.push({ type: String(input.type), ids: [String(input.recipientUserId)] }); return undefined as never; },
    };
    const repo = new PostgresRiskFrameworkRepository(pool);
    const svc = new RiskFrameworkService(
      repo, new PostgresRatingScaleRepository(pool), new PostgresRoleRepository(pool), usersDep, new PostgresAuditRepository(pool),
      undefined, notifications as never,
    );
    const actor = (id: string) => ({ userId: id, tenantId: t, email: `${id}@x`, displayName: id, roles: RM_PERMS }) as AuthenticatedUser;
    const failAudit = (entityType: string | null = null) => pool.query(`INSERT INTO qa_fail_audit VALUES ($1, $2)`, [t, entityType]);
    const heal = () => pool.query(`DELETE FROM qa_fail_audit WHERE tenant_id = $1`, [t]);
    const q = async <R extends object = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<R>(sql, [t, ...params])).rows;
    const count = async (table: string, extra = "") => Number((await q<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1 ${extra}`))[0]!.n);
    const audits = async () => (await q<{ entity_type: string; action: string }>(`SELECT entity_type, action FROM audit_log WHERE tenant_id = $1 ORDER BY timestamp, action`)).map((r) => `${r.entity_type}:${r.action}`);
    const create = async (by = rm1) => svc.create(actor(by), { name: `F-${Math.random()}`, ratingScaleId: scaleId, params: {} }, "r-create");
    return { t, rm1, rm2, rm3, rm4, scaleId, svc, repo, actor, failAudit, heal, q, count, audits, notified, create };
  }
  type W = Awaited<ReturnType<typeof world>>;

  /** framework + draft (by rm1), submitted by rm1; returns ids. */
  async function submitted(w: W) {
    const { framework, version } = await w.create();
    const req = await w.svc.requestActivation(w.actor(w.rm1), framework.id, version.id, "go", "r-submit");
    return { framework, version, req };
  }

  it("create: audit failure leaves no framework, no version, no audit row (ROLLBACK)", async () => {
    const w = await world();
    await w.failAudit();
    await expect(w.create()).rejects.toThrow(/audit insert refused/);
    expect(await w.count("risk_frameworks")).toBe(0);
    expect(await w.count("risk_framework_versions")).toBe(0);
    expect(await w.count("audit_log")).toBe(0);
  });

  it("create: failure on the SECOND audit event (version) also removes the first (framework) row", async () => {
    const w = await world();
    await w.failAudit("RiskFrameworkVersion");
    await expect(w.create()).rejects.toThrow(/audit insert refused/);
    expect(await w.count("risk_frameworks")).toBe(0);
    expect(await w.count("audit_log")).toBe(0);
  });

  it("create: success writes both audit rows and the connection pool is still usable after the failure", async () => {
    const w = await world();
    await w.failAudit();
    await expect(w.create()).rejects.toThrow();
    await w.heal();
    await w.create();
    expect(await w.audits()).toEqual(["RiskFramework:CREATE", "RiskFrameworkVersion:CREATE"]);
    expect((await pool.query(`SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND state = 'idle in transaction'`, [DB])).rowCount).toBe(0);
  });

  it("updateIdentity: audit failure keeps the old name and adds no audit row", async () => {
    const w = await world();
    const { framework } = await w.create();
    const before = await w.audits();
    await w.failAudit();
    await expect(w.svc.updateIdentity(w.actor(w.rm1), framework.id, { name: "Renamed", reason: "why" }, "r-up")).rejects.toThrow(/audit insert refused/);
    expect((await w.q<{ name: string }>(`SELECT name FROM risk_frameworks WHERE tenant_id = $1`))[0]!.name).toBe(framework.name);
    expect(await w.audits()).toEqual(before);
    await w.heal();
    await w.svc.updateIdentity(w.actor(w.rm1), framework.id, { name: "Renamed", reason: "why" }, "r-up");
    expect([...(await w.audits())].sort()).toEqual([...before, "RiskFramework:UPDATE"].sort());
  });

  it("updateDraft: audit failure keeps parameters AND last_edited_by (no phantom edit, no exclusion)", async () => {
    const w = await world();
    const { framework, version } = await w.create();
    await w.failAudit();
    await expect(w.svc.updateDraft(w.actor(w.rm2), framework.id, version.id, { selfProposalAllowed: true }, "r-ud")).rejects.toThrow(/audit insert refused/);
    const row = (await w.q<{ self_proposal_allowed: boolean; last_edited_by: string }>(`SELECT self_proposal_allowed, last_edited_by FROM risk_framework_versions WHERE tenant_id = $1`))[0]!;
    expect(row.self_proposal_allowed).toBe(false);
    expect(row.last_edited_by).toBe(w.rm1);
    expect(await w.count("audit_log", "AND action = 'UPDATE'")).toBe(0);
    await w.heal();
    await w.svc.updateDraft(w.actor(w.rm2), framework.id, version.id, { selfProposalAllowed: true }, "r-ud");
    expect(await w.count("audit_log", "AND action = 'UPDATE'")).toBe(1);
  });

  it("discardDraft: audit failure leaves the DRAFT, with no archived_* columns; success archives and audits", async () => {
    const w = await world();
    const { framework, version } = await w.create();
    await w.failAudit();
    await expect(w.svc.discardDraft(w.actor(w.rm1), framework.id, version.id, "abandon", "r-d")).rejects.toThrow(/audit insert refused/);
    const row = (await w.q<{ status: string; archived_at: Date | null; archived_by: string | null; archive_reason: string | null }>(`SELECT status, archived_at, archived_by, archive_reason FROM risk_framework_versions WHERE tenant_id = $1`))[0]!;
    expect(row).toEqual({ status: "DRAFT", archived_at: null, archived_by: null, archive_reason: null });
    expect(await w.count("audit_log", "AND action = 'STATUS_CHANGE'")).toBe(0);
    await w.heal();
    await w.svc.discardDraft(w.actor(w.rm1), framework.id, version.id, "abandon", "r-d");
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1`))[0]!.status).toBe("ARCHIVED");
    expect(await w.count("audit_log", "AND action = 'STATUS_CHANGE'")).toBe(1);
  });

  it("submit: audit failure leaves the version DRAFT, no request row, no audit row and NO notification", async () => {
    const w = await world();
    const { framework, version } = await w.create();
    await w.failAudit("RiskFrameworkChangeRequest");
    await expect(w.svc.requestActivation(w.actor(w.rm1), framework.id, version.id, "go", "r-s")).rejects.toThrow(/audit insert refused/);
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1`))[0]!.status).toBe("DRAFT");
    expect(await w.count("risk_framework_change_requests")).toBe(0);
    expect(await w.audits()).toEqual(["RiskFramework:CREATE", "RiskFrameworkVersion:CREATE"]);
    expect(w.notified).toEqual([]);
    // the draft is still submittable (no residual PENDING / open-version conflict)
    await w.heal();
    await w.svc.requestActivation(w.actor(w.rm1), framework.id, version.id, "go", "r-s2");
    expect(await w.count("risk_framework_change_requests", "AND status = 'PENDING'")).toBe(1);
    expect(w.notified.length).toBeGreaterThan(0);
  });

  it("decide APPROVE: audit failure on the 2nd event rolls back version activation, request decision and the 1st audit row", async () => {
    const w = await world();
    const { framework, version, req } = await submitted(w);
    const auditBefore = await w.audits();
    w.notified.length = 0;
    await w.failAudit("RiskFrameworkChangeRequest"); // APPROVE event is the second one: the Version STATUS_CHANGE is inserted first
    await expect(w.svc.approve(w.actor(w.rm2), req.id, undefined, "r-a")).rejects.toThrow(/audit insert refused/);
    const r = (await w.q<{ status: string; decided_by: string | null }>(`SELECT status, decided_by FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]!;
    expect(r).toEqual({ status: "PENDING", decided_by: null });
    const v = (await w.q<{ status: string; activated_at: Date | null }>(`SELECT status, activated_at FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!;
    expect(v).toEqual({ status: "PENDING_APPROVAL", activated_at: null });
    expect(await w.audits()).toEqual(auditBefore);
    expect((await w.q<{ is_default: boolean }>(`SELECT is_default FROM risk_frameworks WHERE tenant_id = $1 AND id = $2`, [framework.id]))[0]!.is_default).toBe(false);
    expect(w.notified).toEqual([]); // nobody told about a decision that did not happen
    // retry works after healing
    await w.heal();
    await w.svc.approve(w.actor(w.rm2), req.id, undefined, "r-a2");
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status).toBe("ACTIVE");
    expect((await w.audits()).filter((a) => a.endsWith(":APPROVE") || a.endsWith(":STATUS_CHANGE")).sort()).toEqual(["RiskFrameworkChangeRequest:APPROVE", "RiskFrameworkVersion:STATUS_CHANGE"]);
  });

  it("decide REJECT: audit failure keeps the request PENDING and the version PENDING_APPROVAL", async () => {
    const w = await world();
    const { version, req } = await submitted(w);
    await w.failAudit();
    await expect(w.svc.reject(w.actor(w.rm2), req.id, "no", "r-rj")).rejects.toThrow(/audit insert refused/);
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]!.status).toBe("PENDING");
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status).toBe("PENDING_APPROVAL");
    await w.heal();
    await w.svc.reject(w.actor(w.rm2), req.id, "no", "r-rj2");
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status).toBe("DRAFT");
    expect(await w.count("audit_log", "AND action = 'REJECT'")).toBe(1);
  });

  it("withdraw: audit failure keeps the request PENDING; success returns the version to DRAFT with one audit row", async () => {
    const w = await world();
    const { version, req } = await submitted(w);
    await w.failAudit();
    await expect(w.svc.withdraw(w.actor(w.rm1), req.id, "oops", "r-w")).rejects.toThrow(/audit insert refused/);
    expect((await w.q<{ status: string; decided_at: Date | null }>(`SELECT status, decided_at FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]).toEqual({ status: "PENDING", decided_at: null });
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status).toBe("PENDING_APPROVAL");
    await w.heal();
    await w.svc.withdraw(w.actor(w.rm1), req.id, "oops", "r-w2");
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status).toBe("DRAFT");
    expect(await w.count("audit_log", "AND entity_type = 'RiskFrameworkChangeRequest' AND action = 'STATUS_CHANGE'")).toBe(1);
  });

  it("concurrency: two simultaneous approvals -> exactly one wins, exactly 2 APPROVE-side audit rows, no 409-loser audit row", async () => {
    const w = await world();
    const { req } = await submitted(w);
    const res = await Promise.allSettled([
      w.svc.approve(w.actor(w.rm2), req.id, undefined, "r-c1"),
      w.svc.approve(w.actor(w.rm3), req.id, undefined, "r-c2"),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await w.count("audit_log", "AND action = 'APPROVE'")).toBe(1);
    expect(await w.count("audit_log", "AND entity_type = 'RiskFrameworkVersion' AND action = 'STATUS_CHANGE'")).toBe(1);
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]!.status).toBe("APPROVED");
  });

  it("concurrency: approve vs withdraw -> one outcome, one decision audit row, consistent version state", async () => {
    const w = await world();
    const { version, req } = await submitted(w);
    const res = await Promise.allSettled([
      w.svc.approve(w.actor(w.rm2), req.id, undefined, "r-c1"),
      w.svc.withdraw(w.actor(w.rm1), req.id, "retrait", "r-c2"),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const status = (await w.q<{ status: string }>(`SELECT status FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]!.status;
    const vstatus = (await w.q<{ status: string }>(`SELECT status FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!.status;
    expect(status === "APPROVED" ? vstatus === "ACTIVE" : status === "WITHDRAWN" && vstatus === "DRAFT").toBe(true);
    expect(await w.count("audit_log", "AND entity_type = 'RiskFrameworkChangeRequest' AND action IN ('APPROVE','STATUS_CHANGE')")).toBe(1);
  });

  it("q87: a draft copied from a version stored with COMMITTEE is RISK_MANAGER (SQL literal) and audited in the same transaction", async () => {
    const w = await world();
    const { framework, version } = await w.create();
    // legacy-shaped data: a stored COMMITTEE approver on the draft, written directly in SQL
    await pool.query(`UPDATE risk_framework_versions SET change_approver = 'COMMITTEE' WHERE id = $1`, [version.id]);
    await w.svc.requestActivation(w.actor(w.rm1), framework.id, version.id, "go", "r-s").catch(() => undefined);
    const reqs = await w.q<{ id: string }>(`SELECT id FROM risk_framework_change_requests WHERE tenant_id = $1`);
    if (reqs[0]) await w.svc.approve(w.actor(w.rm2), reqs[0].id, undefined, "r-a");
    const src = (await w.q<{ status: string; change_approver: string }>(`SELECT status, change_approver FROM risk_framework_versions WHERE tenant_id = $1 AND id = $2`, [version.id]))[0]!;
    expect(src.change_approver).toBe("COMMITTEE");
    await w.failAudit();
    await expect(w.svc.createDraft(w.actor(w.rm3), framework.id, undefined, "r-cd")).rejects.toThrow(/audit insert refused/);
    expect(await w.count("risk_framework_versions", "AND status = 'DRAFT'")).toBe(0);
    await w.heal();
    const d = await w.svc.createDraft(w.actor(w.rm3), framework.id, undefined, "r-cd");
    expect(d.changeApprover).toBe("RISK_MANAGER");
    expect(d.versionNumber).toBe(2); // the rolled-back attempt did not consume a number
  });

  it("holders(): a failing recipient lookup does not undo or fail the submit (best effort), audit row present", async () => {
    const w = await world({ throwingHolders: true });
    const { req } = await submitted(w);
    expect(req.status).toBe("PENDING");
    expect(await w.count("audit_log", "AND action = 'SUBMIT'")).toBe(1);
  });

  it("tenant: an actor of another tenant cannot decide / withdraw / discard (404, nothing written)", async () => {
    const w = await world();
    const other = await world();
    const { framework, version, req } = await submitted(w);
    const foreign = other.actor(other.rm2);
    await expect(w.svc.approve(foreign, req.id, undefined, "r-x")).rejects.toThrow();
    await expect(w.svc.withdraw(other.actor(other.rm1), req.id, "x", "r-x")).rejects.toThrow();
    await expect(other.svc.discardDraft(other.actor(other.rm1), framework.id, version.id, "x", "r-x")).rejects.toThrow();
    expect(await w.count("audit_log", "AND request_id IN ('r-x')")).toBe(0);
    expect(await other.count("audit_log")).toBe(0);
    expect((await w.q<{ status: string }>(`SELECT status FROM risk_framework_change_requests WHERE tenant_id = $1`))[0]!.status).toBe("PENDING");
  });
});
