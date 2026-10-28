import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { configRouter } from "../src/api/v1/config.routes.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { usersRouter } from "../src/api/v1/users.routes.js";
import { governanceDesignationsRouter } from "../src/api/v1/governanceDesignations.routes.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { RoleService } from "../src/services/RoleService.js";
import { UserService } from "../src/services/UserService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { GovernancePrincipleAcceptanceService } from "../src/services/GovernancePrincipleAcceptanceService.js";
import { FIXED_GROUP_PERMISSIONS, GOVERNANCE_DECISION_RIGHTS } from "../src/domain/fixedGroupPermissions.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresGovernancePrincipleAcceptanceRepository } from "../src/infrastructure/database/postgres/PostgresGovernancePrincipleAcceptanceRepository.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { Permission } from "../src/domain/permissions.js";
import type { GovernanceAuditRow } from "../src/domain/governance/governanceEvents.js";
import type { GovernancePrincipleAcceptance } from "../src/domain/entities/GovernanceReviews.js";
import type { GovernancePrincipleAcceptanceRepository } from "../src/domain/repositories/GovernanceReviewRepositories.js";
import { fakeDelayRequests } from "./fakeDelayRequests.js";

/**
 * QA-suites2 (level 2): DECISION-092/094/095 (q178, q179, q181, q182, q183). Oracles written before running:
 *  - q182: lengthening or clearing a configured delay = a PENDING request (config unchanged) when another holder of
 *    config.selfvalidation.approve exists; shortening, configuring an unset delay or re-sending the same value is direct and
 *    unmarked; a mixed change is a relaxation as a whole; the author never decides; an expired request is never approvable
 *    (409) but stays rejectable and replaceable; no other approver => applied by the administrator, marked adminAlone.
 *  - q179: the four rights live on fixed groups only; the Audit holds the review alone; the last group of a right cannot be
 *    removed; a refusal moves nothing (no half-moved right, no audit row).
 *  - q178: overdue only strictly past `maxDays` (exactly 60 days = not overdue; +1 ms = overdue); notified to Audit + Committee.
 *  - q181: renewing alone needs the previous alone-acceptance REVIEWED; CONTESTED is an objection, not a review.
 *  - q183: audit.mission.create opens the account directory; nothing else is added.
 */
const T = "00000000-0000-4000-8000-000000000001";
const T2 = "00000000-0000-4000-8000-000000000002";
const DAY = 86_400_000;
const user = (userId: string, roles: string[], tenantId = T): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x.io`, displayName: userId, roles }) as unknown as AuthenticatedUser;

async function http(mount: (app: express.Express) => void, who: AuthenticatedUser, method: string, path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser }).user = who;
    (req as unknown as { requestId: string }).requestId = "req";
    next();
  });
  mount(app);
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  } finally {
    server.close();
  }
}

// -- q182 world ------------------------------------------------------------------------------------------------------
function configWorld(opts: { approver?: boolean } = {}) {
  const events: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const rows = new Map<string, Config>();
  const upsert = async (t: string, patch: Record<string, unknown>, by: string) => {
    const cur =
      rows.get(t) ??
      ({ id: `cfg-${t}`, tenantId: t, version: 1, selfValidationPolicy: "REFUSE", committeeAuditCumulAllowed: true, exceptionReviewDelayDays: null, acceptanceMaxDays: null, policyRequestExpiryDays: null, riskManagerVacancyMaxDays: 60 } as unknown as Config);
    const next = { ...cur, version: cur.version + 1, updatedBy: by } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v;
    rows.set(t, next as unknown as Config);
    return next as unknown as Config;
  };
  const delays = fakeDelayRequests(upsert as never, events);
  const service = new ConfigService(
    { getByTenant: async (t: string) => rows.get(t) ?? null, upsert } as never,
    { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never,
    undefined,
    undefined,
    { existsOther: async () => opts.approver ?? true },
    { getPending: async () => null, getById: async () => null, create: async () => null, decide: async () => null, reopen: async () => undefined } as never,
    delays.repo,
  );
  return { service, events, rows, delays, row: (t = T) => rows.get(t)! };
}
const author = user("author", ["config.read", "config.governancedelays.set"]);
const approver = user("rm", ["config.read", "config.selfvalidation.approve"]);
const pendingOf = async (w: ReturnType<typeof configWorld>, patch: object, who = author) => {
  const r = await w.service.setGovernanceDelays(who, patch, "Allonger", "q");
  expect(r.pendingRequest, JSON.stringify(patch)).not.toBeNull();
  return r.pendingRequest!;
};
const mount = (w: ReturnType<typeof configWorld>) => (a: express.Express) => a.use("/config", configRouter(w.service));

describe("QA-suites2 q182 governance delay requests", () => {
  it("the author of a request can neither approve nor reject it (service and HTTP), nothing changes", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30, exceptionReviewDelayDays: 10 }, "init", "q");
    const p = await pendingOf(w, { acceptanceMaxDays: 60 });
    const both = user("author", ["config.read", "config.governancedelays.set", "config.selfvalidation.approve"]);
    await expect(w.service.approveGovernanceDelays(both, p.id, "moi", "q")).rejects.toThrow(ForbiddenError);
    await expect(w.service.rejectGovernanceDelays(both, p.id, "moi", "q")).rejects.toThrow(ForbiddenError);
    expect((await http(mount(w), both, "POST", `/config/governance-delays/requests/${p.id}/approve`, { reason: "moi" })).status).toBe(403);
    expect((await http(mount(w), both, "POST", `/config/governance-delays/requests/${p.id}/reject`, { reason: "moi" })).status).toBe(403);
    // Same user id but only the delay permission: refused for lack of the approve right, not for the author rule (still 403).
    expect((await http(mount(w), author, "POST", `/config/governance-delays/requests/${p.id}/approve`, { reason: "moi" })).status).toBe(403);
    expect(w.delays.request()).toMatchObject({ id: p.id, status: "PENDING" });
    expect(w.row().acceptanceMaxDays).toBe(30);
    expect(w.events.some((e) => e.action === "APPROVE" || e.action === "REJECT")).toBe(false);
  });

  it("an expired request is never approvable (409, config unchanged) but stays rejectable and replaceable", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    const p = await pendingOf(w, { acceptanceMaxDays: 60 });
    w.delays.setRequest({ ...p, expiresAt: new Date(Date.now() - 1) });
    await expect(w.service.approveGovernanceDelays(approver, p.id, "ok", "q")).rejects.toThrow(ConflictError);
    expect((await http(mount(w), approver, "POST", `/config/governance-delays/requests/${p.id}/approve`, { reason: "ok" })).status).toBe(409);
    expect(w.row().acceptanceMaxDays).toBe(30);
    expect(w.delays.request()!.status).toBe("PENDING");
    // replaceable: a new lengthening withdraws the expired one
    const second = await pendingOf(w, { acceptanceMaxDays: 90 });
    expect(second.id).not.toBe(p.id);
    expect(w.events.filter((e) => e.entityType === "GovernanceDelayRequest" && e.action === "CLOSE")).toHaveLength(1);
    // rejectable: expire the new one too
    w.delays.setRequest({ ...second, expiresAt: new Date(Date.now() - 1) });
    await expect(w.service.rejectGovernanceDelays(approver, second.id, "Échue", "q")).resolves.toMatchObject({ status: "REJECTED" });
    expect(w.row().acceptanceMaxDays).toBe(30);
  });

  it("exactly at the expiry instant (expiresAt == now) the request is already expired", async () => {
    vi.useFakeTimers();
    try {
      const w = configWorld();
      await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30, policyRequestExpiryDays: 5 }, "init", "q");
      const p = await pendingOf(w, { acceptanceMaxDays: 60 });
      vi.setSystemTime(p.expiresAt!.getTime() - 1);
      await expect(w.service.approveGovernanceDelays(approver, p.id, "ok", "q")).resolves.toMatchObject({ acceptanceMaxDays: 60 });
      const q = await pendingOf(w, { acceptanceMaxDays: 90 });
      vi.setSystemTime(q.expiresAt!.getTime());
      await expect(w.service.approveGovernanceDelays(approver, q.id, "ok", "q")).rejects.toThrow(ConflictError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a mixed change (one key longer, one shorter) is a relaxation as a whole: nothing applied until approved, then both", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30, exceptionReviewDelayDays: 10 }, "init", "q");
    const before = { ...w.row() };
    const p = await pendingOf(w, { acceptanceMaxDays: 60, exceptionReviewDelayDays: 5 });
    expect([w.row().acceptanceMaxDays, w.row().exceptionReviewDelayDays]).toEqual([30, 10]);
    expect(w.row().version).toBe(before.version);
    const applied = await w.service.approveGovernanceDelays(approver, p.id, "ok", "q");
    expect([applied.acceptanceMaxDays, applied.exceptionReviewDelayDays]).toEqual([60, 5]);
    // no adminAlone marker when a third party decided
    expect(w.events.filter((e) => e.governanceException === "config.governancedelays.adminAlone")).toHaveLength(0);
  });

  it("a mixed change including a delay that was unset (tightening) plus a longer one is still pending as a whole", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    const p = await pendingOf(w, { acceptanceMaxDays: 31, exceptionReviewDelayDays: 7 });
    expect(w.row().exceptionReviewDelayDays).toBeNull();
    expect(p.requestedDelays).toEqual({ acceptanceMaxDays: 31, exceptionReviewDelayDays: 7 });
  });

  it("clearing the vacancy delay (60 -> null) is a relaxation; 60 -> 61 too; 60 -> 59 and 60 -> 60 are direct and unmarked", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q"); // row exists, vacancy = 60
    await pendingOf(w, { riskManagerVacancyMaxDays: null });
    await pendingOf(w, { riskManagerVacancyMaxDays: 61 });
    expect(w.row().riskManagerVacancyMaxDays).toBe(60);
    for (const v of [59, 59]) {
      const r = await w.service.setGovernanceDelays(author, { riskManagerVacancyMaxDays: v }, "Raccourcir", "q");
      expect(r).toMatchObject({ pendingRequest: null, config: { riskManagerVacancyMaxDays: 59 } });
      expect(w.events.at(-1)!.governanceException).toBeUndefined();
    }
    // the shortening withdrew the pending request
    expect(w.delays.request()!.status).toBe("WITHDRAWN");
    // configuring from "cleared" is a tightening, direct
    const w2 = configWorld();
    await w2.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    const cleared = configWorld({ approver: false });
    await cleared.service.setGovernanceDelays(author, { riskManagerVacancyMaxDays: null }, "Retirer", "q");
    const back = await cleared.service.setGovernanceDelays(author, { riskManagerVacancyMaxDays: 30 }, "Reconfigurer", "q");
    expect(back.config.riskManagerVacancyMaxDays).toBe(30);
    expect(cleared.events.at(-1)!.governanceException).toBeUndefined();
  });

  it("nobody else can approve: a mixed change is applied by the administrator, ONE marked audit row; shortening alone is never marked", async () => {
    const w = configWorld({ approver: false });
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30, exceptionReviewDelayDays: 10 }, "init", "q");
    const r = await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 60, exceptionReviewDelayDays: 5 }, "Mixte", "q");
    expect(r.pendingRequest).toBeNull();
    expect([r.config.acceptanceMaxDays, r.config.exceptionReviewDelayDays]).toEqual([60, 5]);
    const marked = w.events.filter((e) => e.governanceException === "config.governancedelays.adminAlone");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toMatchObject({ entityType: "Config", userId: "author", reason: "Mixte" });
    expect(w.delays.request()).toBeNull();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 20 }, "Raccourcir", "q");
    expect(w.events.filter((e) => e.governanceException === "config.governancedelays.adminAlone")).toHaveLength(1);
  });

  it("a newer lengthening replaces the pending one; the replaced id can no longer be decided; only one request is ever PENDING", async () => {
    const w = configWorld();
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    const first = await pendingOf(w, { acceptanceMaxDays: 60 });
    const second = await pendingOf(w, { acceptanceMaxDays: 90 });
    // the in-memory double keeps one slot (the replaced row is gone: NotFound); PostgreSQL keeps it WITHDRAWN (ValidationError "already decided")
    await expect(w.service.approveGovernanceDelays(approver, first.id, "ok", "q")).rejects.toThrow(/not found|already been decided/);
    await expect(w.service.rejectGovernanceDelays(approver, first.id, "non", "q")).rejects.toThrow(/not found|already been decided/);
    await expect(w.service.getPendingGovernanceDelayRequest(approver)).resolves.toMatchObject({ id: second.id });
    expect((await w.service.approveGovernanceDelays(approver, second.id, "ok", "q")).acceptanceMaxDays).toBe(90);
    await expect(w.service.approveGovernanceDelays(approver, second.id, "encore", "q")).rejects.toThrow(ValidationError);
    expect(w.row().acceptanceMaxDays).toBe(90);
  });

  it("Codex PR #199: the delays reason is capped at 500 like the request table (501 = 400, nothing written)", async () => {
    const w = configWorld();
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { acceptanceMaxDays: 30, reason: "x".repeat(501) })).status).toBe(400);
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { acceptanceMaxDays: 30, reason: "x".repeat(500) })).status).toBe(200);
  });

  it("HTTP: lengthening = 202 with pendingRequest and the unchanged config; shortening = 200; view needs set OR approve; unknown / foreign id", async () => {
    const w = configWorld();
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { acceptanceMaxDays: 30, reason: "init" })).status).toBe(200);
    const r = await http(mount(w), author, "PUT", "/config/governance-delays", { acceptanceMaxDays: 60, reason: "Allonger" });
    expect(r.status).toBe(202);
    expect(r.json.data.acceptanceMaxDays).toBe(30);
    expect(r.json.pendingRequest).toMatchObject({ status: "PENDING", requestedBy: "author" });
    const id = r.json.pendingRequest.id as string;
    expect((await http(mount(w), user("x", ["config.read"]), "GET", "/config/governance-delays/request")).status).toBe(403);
    expect((await http(mount(w), approver, "GET", "/config/governance-delays/request")).json.data.id).toBe(id);
    expect((await http(mount(w), author, "GET", "/config/governance-delays/request")).json.data.id).toBe(id);
    const blank = await http(mount(w), approver, "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "  " });
    expect(blank.status).toBe(400);
    expect((await http(mount(w), approver, "POST", `/config/governance-delays/requests/not-a-uuid/approve`, { reason: "ok" })).status).toBe(400);
    expect((await http(mount(w), approver, "POST", `/config/governance-delays/requests/00000000-0000-4000-8000-0000000000aa/approve`, { reason: "ok" })).status).toBe(404);
    // another tenant's approver cannot see nor decide it
    const foreign = user("rm2", ["config.read", "config.selfvalidation.approve"], T2);
    expect((await http(mount(w), foreign, "GET", "/config/governance-delays/request")).json.data).toBeNull();
    expect((await http(mount(w), foreign, "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "ok" })).status).toBe(404);
    expect(w.delays.request()!.status).toBe("PENDING");
    expect((await http(mount(w), approver, "POST", `/config/governance-delays/requests/${id}/approve`, { reason: "ok" })).json.data.acceptanceMaxDays).toBe(60);
    // strict body: the vacancy key is accepted, an attribution key is not
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { riskManagerVacancyMaxDays: 0, reason: "r" })).status).toBe(400);
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { riskManagerVacancyMaxDays: 3651, reason: "r" })).status).toBe(400);
    expect((await http(mount(w), author, "PUT", "/config/governance-delays", { riskManagerVacancyMaxDays: 30, requestedBy: "x", reason: "r" })).status).toBe(400);
  });

  it("the adminAlone application is told to the reviewers like any marked action (GOVERNANCE_EXCEPTION_RECORDED), the request SUBMIT to the approvers", async () => {
    const w = configWorld({ approver: false });
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    await w.service.setGovernanceDelays(author, { acceptanceMaxDays: 60 }, "seul", "q");
    const marked = w.events.find((e) => e.governanceException === "config.governancedelays.adminAlone")!;
    const sent: string[] = [];
    const row = (e: Omit<AuditEvent, "id" | "timestamp">, id: string): GovernanceAuditRow =>
      ({ id, userId: e.userId, entityType: e.entityType, entityId: e.entityId, action: e.action, governanceException: e.governanceException ?? null, oldValue: e.oldValue, newValue: e.newValue, systemGroup: null });
    const notifier = (rows: GovernanceAuditRow[]) =>
      new GovernanceNotifier(
        { emit: async (i) => { sent.push(`${i.recipientUserId}:${i.eventType}`); return null; } },
        { rowsForRequest: async () => rows, holdersOf: async (_t, p) => (p === "governanceexception.review" ? ["aud"] : ["rm"]), groupMembers: async () => [], managerId: async () => null, unreviewedExceptionCount: async () => 0 },
        () => undefined,
      );
    await notifier([row(marked, "a1")]).processRequest(T, "author", "r1");
    expect(sent).toEqual(["aud:GOVERNANCE_EXCEPTION_RECORDED"]);
    sent.length = 0;
    const w2 = configWorld();
    await w2.service.setGovernanceDelays(author, { acceptanceMaxDays: 30 }, "init", "q");
    await w2.service.setGovernanceDelays(author, { acceptanceMaxDays: 60 }, "demande", "q");
    const submit = w2.events.find((e) => e.entityType === "GovernanceDelayRequest" && e.action === "SUBMIT")!;
    await notifier([row(submit, "a2")]).processRequest(T, "author", "r2");
    expect(sent).toEqual(["rm:GOVERNANCE_DELAY_REQUEST_PENDING"]);
  });
});

// -- q179 world ------------------------------------------------------------------------------------------------------
function roleWorld(memberOf: Record<string, string[]> = { member: ["com"] }, pendingAuditChange = false) {
  const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role =>
    ({ id, tenantId: T, name: id, description: null, permissions: [...permissions], systemGroup, departmentId: null, dashboardScopeMode: "GLOBAL" }) as unknown as Role;
  const roles = [
    role("rm", "RISK_MANAGER", FIXED_GROUP_PERMISSIONS.RISK_MANAGER),
    role("com", "RISK_COMMITTEE", FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE),
    role("aud", "AUDIT", FIXED_GROUP_PERMISSIONS.AUDIT),
    role("ordinary", null, ["risk.read"]),
  ];
  const events: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
  const repo = {
    getById: async (t: string, id: string) => (t === T ? roles.find((r) => r.id === id) ?? null : null),
    getByName: async () => null,
    list: async (t: string) => (t === T ? roles : []),
    listForUser: async (_t: string, u: string) => roles.filter((r) => (memberOf[u] ?? []).includes(r.id)),
    listAssignments: async () => [],
    create: async (input: { name: string; permissions: Permission[] }) => role(input.name, null, input.permissions),
    update: async (_t: string, id: string, input: { permissions?: Permission[] }) => {
      const r = roles.find((x) => x.id === id)!;
      if (input.permissions) r.permissions = input.permissions;
      return r;
    },
  };
  const changes: Array<{ id: string; roleId: string; status: string }> = pendingAuditChange ? [{ id: "pc0", roleId: "aud", status: "PENDING" }] : [];
  const permissionChanges = {
    create: async (i: { roleId: string; permissions: Permission[] }) => { const c = { id: `pc${changes.length + 1}`, roleId: i.roleId, status: "PENDING", ...i }; changes.push(c); return c; },
    list: async (_t: string, f: { status?: string; roleId?: string }) => changes.filter((c) => (!f.status || c.status === f.status) && (!f.roleId || c.roleId === f.roleId)),
    getById: async () => null, decide: async () => false,
  };
  const service = new RoleService(repo as never, { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never, undefined, undefined, permissionChanges as never);
  const holders = (p: Permission) => roles.filter((r) => r.permissions.includes(p)).map((r) => r.systemGroup);
  return { service, roles, events, holders, changes, snapshot: () => JSON.stringify(roles.map((r) => [r.id, r.permissions])) };
}
const roleAdmin = user("adm", ["role.read", "role.create", "role.update", "rolegroup.audit.update"]);
const [CONFIRM, APPROVE_SV, REVIEW, ORG] = ["governanceprinciple.acceptance.confirm", "config.selfvalidation.approve", "governanceexception.review", "orgprofile.approve"] as const;

describe("QA-suites2 q179 governance decision rights", () => {
  it("the four rights are exactly the expected ones and each is held by a fixed group at the start", () => {
    expect([...GOVERNANCE_DECISION_RIGHTS].sort()).toEqual([CONFIRM, APPROVE_SV, REVIEW, ORG].sort());
    const w = roleWorld();
    for (const p of GOVERNANCE_DECISION_RIGHTS) expect(w.holders(p).length, p).toBeGreaterThan(0);
  });

  it("a right moved onto the Audit is refused for confirm / approve rights (alone or with others), nothing moves; the review is accepted", async () => {
    for (const p of [CONFIRM, APPROVE_SV, ORG] as const) {
      for (const groups of [["AUDIT"], ["RISK_MANAGER", "AUDIT"], ["RISK_COMMITTEE", "AUDIT", "RISK_MANAGER"]] as SystemGroup[][]) {
        const w = roleWorld();
        const before = w.snapshot();
        await expect(w.service.setGovernanceRightGroups(roleAdmin, p, groups, "Motif", "q"), `${p} ${groups}`).rejects.toThrow(/q157/);
        expect(w.snapshot()).toBe(before);
        expect(w.events).toHaveLength(0);
      }
    }
    const w = roleWorld();
    await expect(w.service.setGovernanceRightGroups(roleAdmin, REVIEW, ["AUDIT"], "Revue à l'Audit seul", "q")).resolves.toMatchObject({ groups: ["AUDIT"] });
    expect(w.holders(REVIEW)).toEqual(["AUDIT"]);
    // and back: the Audit keeps the review while the others also carry it
    await w.service.setGovernanceRightGroups(roleAdmin, REVIEW, ["AUDIT", "RISK_MANAGER"], "Retour", "q");
    expect(w.holders(REVIEW).sort()).toEqual(["AUDIT", "RISK_MANAGER"]);
  });

  it("removing the last group of a right is refused (service and HTTP 400) and the right stays where it was", async () => {
    const w = roleWorld();
    await w.service.setGovernanceRightGroups(roleAdmin, ORG, ["RISK_COMMITTEE"], "Comité seul", "q");
    expect(w.holders(ORG)).toEqual(["RISK_COMMITTEE"]);
    const before = w.snapshot();
    const events = w.events.length;
    await expect(w.service.setGovernanceRightGroups(roleAdmin, ORG, [], "Plus personne", "q")).rejects.toThrow(/At least one/);
    for (const groups of [[], undefined, null, "RISK_MANAGER", ["NOPE"], ["RISK_MANAGER", "RISK_MANAGER", "RISK_MANAGER", "AUDIT"]]) {
      const r = await http((a) => a.use("/roles", rolesRouter(w.service)), roleAdmin, "PUT", "/roles/governance-rights", { permission: ORG, groups, reason: "r" });
      expect(r.status, JSON.stringify(groups)).toBe(400);
    }
    expect(w.snapshot()).toBe(before);
    expect(w.events).toHaveLength(events);
    expect(w.holders(ORG)).toEqual(["RISK_COMMITTEE"]);
  });

  it("SEC-SA2-01 / QA-SUITES2-01: the generic role update can neither strip nor add a decision right, on any role", async () => {
    const w = roleWorld();
    await w.service.setGovernanceRightGroups(roleAdmin, ORG, ["RISK_COMMITTEE"], "Comité seul", "q");
    const com = w.roles.find((r) => r.id === "com")!;
    const rm = w.roles.find((r) => r.id === "rm")!;
    const events = w.events.length;
    await expect(w.service.update(roleAdmin, "com", { permissions: com.permissions.filter((p) => p !== ORG) }, "q", "retrait")).rejects.toThrow(/governance-rights/);
    await expect(w.service.update(roleAdmin, "rm", { permissions: [...rm.permissions, ORG] }, "q", "ajout")).rejects.toThrow(/governance-rights/);
    await expect(w.service.update(roleAdmin, "rm", { permissions: rm.permissions.filter((p) => p !== APPROVE_SV) }, "q", "retrait")).rejects.toThrow(/governance-rights/);
    expect(w.holders(ORG)).toEqual(["RISK_COMMITTEE"]);
    expect(w.events).toHaveLength(events);
    // an unrelated change of the same group still goes through
    await expect(w.service.update(roleAdmin, "com", { permissions: com.permissions.filter((p) => p !== "kpi.read") }, "q")).resolves.toBeDefined();
  });

  it("same groups = no change, no audit row, no write; duplicates in the request are collapsed", async () => {
    const w = roleWorld();
    const before = w.snapshot();
    const r = await w.service.setGovernanceRightGroups(roleAdmin, ORG, ["RISK_MANAGER", "RISK_MANAGER", "RISK_COMMITTEE"], "Inchangé", "q");
    expect(r.groups.sort()).toEqual(["RISK_COMMITTEE", "RISK_MANAGER"]);
    expect(w.snapshot()).toBe(before);
    expect(w.events).toHaveLength(0);
  });

  it("a member of a group is refused only when that group would change (no-op passes); the check precedes every write", async () => {
    const w = roleWorld({ member: ["com"] });
    const member = user("member", roleAdmin.roles);
    await expect(w.service.setGovernanceRightGroups(member, ORG, ["RISK_COMMITTEE", "RISK_MANAGER"], "Inchangé", "q")).resolves.toBeDefined();
    // moving to the Risk Manager only changes the Committee (the member's group) -> refused, and RM got nothing either
    const before = w.snapshot();
    await expect(w.service.setGovernanceRightGroups(member, CONFIRM, ["RISK_MANAGER"], "Déplacer", "q")).rejects.toThrow(ForbiddenError);
    // adding to the Audit AND removing from the member's group: still refused before any write
    await expect(w.service.setGovernanceRightGroups(member, REVIEW, ["AUDIT", "RISK_MANAGER"], "Déplacer", "q")).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    expect(w.events).toHaveLength(0);
  });

  it("needs role.update (role.read is not enough); the Audit side needs rolegroup.audit.update on top", async () => {
    const w = roleWorld();
    await expect(w.service.setGovernanceRightGroups(user("x", ["role.read"]), ORG, ["RISK_COMMITTEE"], "r", "q")).rejects.toThrow(ForbiddenError);
    const noAudit = user("y", ["role.read", "role.update"]);
    const before = w.snapshot();
    await expect(w.service.setGovernanceRightGroups(noAudit, REVIEW, ["RISK_MANAGER", "RISK_COMMITTEE"], "Retirer à l'Audit", "q")).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    expect((await http((a) => a.use("/roles", rolesRouter(w.service)), user("x", ["role.read"]), "PUT", "/roles/governance-rights", { permission: ORG, groups: ["RISK_MANAGER"], reason: "r" })).status).toBe(403);
  });

  it("Codex PR #199: role.update without role.read moves the right AND gets its answer (no 403 after the write)", async () => {
    const w = roleWorld();
    await expect(w.service.setGovernanceRightGroups(user("w", ["role.update"]), ORG, ["RISK_COMMITTEE"], "Comité seul", "q"))
      .resolves.toMatchObject({ permission: ORG, groups: ["RISK_COMMITTEE"], auditChangePending: false });
    expect(w.holders(ORG)).toEqual(["RISK_COMMITTEE"]);
  });

  it("HTTP strictness: extra / attribution keys, non-right permission, blank / 501-char reason, GET shape and permission", async () => {
    const w = roleWorld();
    const put = (b: unknown, who = roleAdmin) => http((a) => a.use("/roles", rolesRouter(w.service)), who, "PUT", "/roles/governance-rights", b);
    const ok = { permission: ORG, groups: ["RISK_MANAGER"], reason: "r" };
    expect((await put({ ...ok, updatedBy: "x" })).status).toBe(400);
    expect((await put({ ...ok, tenantId: T2 })).status).toBe(400);
    expect((await put({ ...ok, permission: "risk.read" })).status).toBe(400);
    expect((await put({ ...ok, permission: "nope.nope" })).status).toBe(400);
    for (const reason of [undefined, "", "   ", "x".repeat(501), 5]) expect((await put({ ...ok, reason })).status, String(reason)).toBe(400);
    expect(w.events).toHaveLength(0);
    const good = await put({ ...ok, reason: "x".repeat(500) });
    expect(good.status).toBe(200);
    expect(good.json.data).toMatchObject({ permission: ORG, groups: ["RISK_MANAGER"], auditChangePending: false });
    const list = await http((a) => a.use("/roles", rolesRouter(w.service)), roleAdmin, "GET", "/roles/governance-rights");
    expect(list.status).toBe(200);
    expect(list.json.data.map((r: { permission: string }) => r.permission).sort()).toEqual([...GOVERNANCE_DECISION_RIGHTS].sort());
    expect((await http((a) => a.use("/roles", rolesRouter(w.service)), user("x", []), "GET", "/roles/governance-rights")).status).toBe(403);
  });

  // KNOWN GAP QA-SUITES2-02 (MAJOR): RoleService.setGovernanceRightGroups checks the held groups before the first write
  // (the comment says "a refusal never leaves the right half moved") but NOT the "Audit change already PENDING" refusal,
  // which only changeAuditGroupPermissions raises, AFTER the Risk Manager / Committee groups were already updated.
  // Remove `.fails` when the pending-change check is done up front.
  it("a refusal raised by the Audit circuit (a change already PENDING) leaves no half-moved right", async () => {
    const w = roleWorld({}, true);
    const before = w.snapshot();
    await expect(w.service.setGovernanceRightGroups(roleAdmin, REVIEW, ["RISK_MANAGER"], "Retirer", "q")).rejects.toThrow(/already pending/);
    expect(w.snapshot()).toBe(before);
    expect(w.events).toHaveLength(0);
  });

  it("a queued Audit change never leaves the right carried by nobody meanwhile (refused before any write)", async () => {
    const w = roleWorld({ rmadmin: ["rm"] });
    await w.service.setGovernanceRightGroups(roleAdmin, REVIEW, ["RISK_COMMITTEE"], "Comité seul", "q");
    const before = w.snapshot();
    const events = w.events.length;
    const who = user("rmadmin", roleAdmin.roles);
    await expect(w.service.setGovernanceRightGroups(who, REVIEW, ["AUDIT"], "Audit seul", "q")).rejects.toThrow(/awaits validation/);
    expect(w.snapshot()).toBe(before);
    expect(w.events).toHaveLength(events);
    expect(w.changes).toHaveLength(0);
  });

  it("an administrator who is also a Risk Manager: removing the review from the Audit is PENDING (202), the right stays on the Audit until a third person approves", async () => {
    const w = roleWorld({ rmadmin: ["rm"] });
    const who = user("rmadmin", roleAdmin.roles);
    const before = w.snapshot();
    const r = await w.service.setGovernanceRightGroups(who, REVIEW, ["RISK_MANAGER", "RISK_COMMITTEE"], "Retirer à l'Audit", "q");
    expect(r.auditChangePending).toBe(true);
    expect(w.roles.find((x) => x.id === "aud")!.permissions).toContain(REVIEW);
    expect(r.groups).toContain("AUDIT");
    // the Risk Manager group is the administrator's own: it never changed
    expect(JSON.stringify(w.roles.find((x) => x.id === "rm")!.permissions)).toBe(JSON.stringify(JSON.parse(before).find((x: [string, string[]]) => x[0] === "rm")[1]));
  });

  it("an ordinary role can take none of the four rights even right after they were moved (create and update)", async () => {
    const w = roleWorld();
    await w.service.setGovernanceRightGroups(roleAdmin, ORG, ["RISK_COMMITTEE"], "Comité seul", "q");
    await expect(w.service.update(roleAdmin, "ordinary", { permissions: ["risk.read", ORG] }, "q")).rejects.toThrow(/fixed groups only/);
    await expect(w.service.create(roleAdmin, { name: "n", permissions: [REVIEW] } as never, "q")).rejects.toThrow(/fixed groups only/);
    expect(w.holders(ORG)).toEqual(["RISK_COMMITTEE"]);
  });
});

// -- q178 ------------------------------------------------------------------------------------------------------------
describe("QA-suites2 q178 Risk Manager vacancy", () => {
  afterEach(() => vi.useRealTimers());
  const build = (since: Date | null, maxDays?: number | null) =>
    new GovernanceDesignationService(
      { list: async () => [] } as never, {} as never, {} as never, {} as never,
      { riskManagerVacancySince: async (t: string) => (t === T ? since : null) },
      maxDays === undefined ? undefined : { getByTenant: async () => ({ riskManagerVacancyMaxDays: maxDays }) as never },
    );
  const designator = user("adm", ["designation.manage"]);

  it("exactly 60 days = not overdue, +1 ms = overdue (default 60, no config row), -1 ms = not overdue", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-27T10:00:00.000Z");
    vi.setSystemTime(now);
    const at = (ms: number) => new Date(now.getTime() - ms);
    await expect(build(at(60 * DAY)).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: 60, overdue: false });
    await expect(build(at(60 * DAY + 1)).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: 60, overdue: true });
    await expect(build(at(60 * DAY - 1)).riskManagerVacancy(designator)).resolves.toMatchObject({ overdue: false });
    // with an explicit tenant value, the same boundary at the configured number
    await expect(build(at(30 * DAY), 30).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: 30, overdue: false });
    await expect(build(at(30 * DAY + 1), 30).riskManagerVacancy(designator)).resolves.toMatchObject({ maxDays: 30, overdue: true });
    // a vacancy that starts now is never overdue; a future date (clock skew) neither
    await expect(build(now).riskManagerVacancy(designator)).resolves.toMatchObject({ overdue: false });
    await expect(build(new Date(now.getTime() + DAY)).riskManagerVacancy(designator)).resolves.toMatchObject({ overdue: false });
  });

  it("no vacancy repository wired = null; other tenant = null; GET /governance-designations adds riskManagerVacancy beside data", async () => {
    await expect(new GovernanceDesignationService({ list: async () => [] } as never, {} as never, {} as never, {} as never).riskManagerVacancy(designator)).resolves.toBeNull();
    await expect(build(new Date(Date.now() - 70 * DAY)).riskManagerVacancy(user("a", ["designation.manage"], T2))).resolves.toBeNull();
    const m = (s: GovernanceDesignationService) => (a: express.Express) => a.use("/governance-designations", governanceDesignationsRouter(s));
    const none = await http(m(build(null)), designator, "GET", "/governance-designations");
    expect(none).toMatchObject({ status: 200, json: { data: [], riskManagerVacancy: null } });
    const over = await http(m(build(new Date(Date.now() - 70 * DAY))), designator, "GET", "/governance-designations");
    expect(over.json.riskManagerVacancy).toMatchObject({ maxDays: 60, overdue: true });
    expect((await http(m(build(null)), user("x", []), "GET", "/governance-designations")).status).toBe(403);
  });

  it("notification: Audit + Committee members told once each, never the actor, never the Risk Manager vacancy as an 'exception'", async () => {
    expect(NOTIFICATION_CATALOG.filter((e) => e.eventType === "RISK_MANAGER_VACANCY")).toEqual([expect.objectContaining({ resourceType: "MANAGEMENT", mandatory: true })]);
    const sent: string[] = [];
    let groupsAsked: string[] = [];
    const row: GovernanceAuditRow = { id: "v1", userId: "adm", entityType: "Role", entityId: "rm", action: "UPDATE", governanceException: "riskManager.vacancy", oldValue: null, newValue: null, systemGroup: "RISK_MANAGER" };
    await new GovernanceNotifier(
      { emit: async (i) => { sent.push(`${i.recipientUserId}:${i.eventType}`); return null; } },
      {
        rowsForRequest: async () => [row],
        holdersOf: async () => ["rev"],
        groupMembers: async (_t, g) => { groupsAsked = g; return ["aud", "com", "aud", "adm"]; },
        managerId: async () => "mgr",
        unreviewedExceptionCount: async () => 0,
      },
      () => undefined,
    ).processRequest(T, "adm", "r");
    expect(groupsAsked.sort()).toEqual(["AUDIT", "RISK_COMMITTEE"]);
    expect(sent.sort()).toEqual(["aud:RISK_MANAGER_VACANCY", "com:RISK_MANAGER_VACANCY"]);
  });
});

describe("QA-suites2 q178 privacy (PRIV-REV-SUITES2-001 §6)", () => {
  it("the vacancy notification carries neither the removed person's id nor name: resource = the audit row, opened on the roles view", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const row: GovernanceAuditRow = {
      id: "v1", userId: "adm", entityType: "Role", entityId: "rm", action: "UPDATE", governanceException: "riskManager.vacancy",
      oldValue: { roleId: "rm", userId: "gone-user", roleName: "Risk Manager", displayName: "Partie Personne" }, newValue: { riskManagerGroupEmpty: true }, systemGroup: "RISK_MANAGER",
    };
    await new GovernanceNotifier(
      { emit: async (i) => { sent.push(i as unknown as Record<string, unknown>); return null; } },
      { rowsForRequest: async () => [row], holdersOf: async () => [], groupMembers: async () => ["com"], managerId: async () => null, unreviewedExceptionCount: async () => 0 },
      () => undefined,
    ).processRequest(T, "adm", "r");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipientUserId: "com", resourceType: "MANAGEMENT", resourceId: "v1" });
    expect(JSON.stringify(sent[0])).not.toMatch(/gone-user|Partie Personne/);
  });
});

// -- q181 ------------------------------------------------------------------------------------------------------------
function acceptanceWorld(prev: { reviewed: boolean; open?: boolean } | null, reviewerExists: boolean) {
  const audits: Array<Record<string, unknown>> = [];
  const asked: string[] = [];
  const repo: GovernancePrincipleAcceptanceRepository = {
    list: async () => [],
    getById: async () => null,
    latestAloneReview: async (t, principle) => { asked.push(`${t}:${principle}`); return prev ? { acceptanceId: "prev", reviewed: prev.reviewed, open: prev.open ?? false } : null; },
    create: async (input, audit) => {
      const a = { ...input, id: "new", acceptedAt: new Date(), confirmedBy: null, confirmedAt: null, endedBy: null, endedAt: null, endReason: null } as GovernancePrincipleAcceptance;
      const out = { acceptance: a, expiredClosed: null };
      audits.push(...audit(out));
      return out;
    },
    confirm: async () => { throw new Error("unused"); },
    end: async () => { throw new Error("unused"); },
  };
  const eligible = { existsOther: async (_t: string, _a: string, p: string) => (p === "governanceexception.review" ? reviewerExists : false) };
  return { service: new GovernancePrincipleAcceptanceService(repo, { record: async () => undefined } as never, eligible), audits, asked };
}
const rm = user("rm", ["governanceprinciple.accept"]);
const accept = (w: ReturnType<typeof acceptanceWorld>, who = rm, principleId = "GOV-SOD-01") =>
  w.service.accept(who, { principleId, reason: "Renouvellement", expiresAt: new Date(Date.now() + DAY) }, "q");

describe("QA-suites2 q181 renewal", () => {
  it("previous alone-acceptance only CONTESTED (= not reviewed): refused while a reviewer exists, 'renewed without review' when none", async () => {
    // The repository contract: a CONTESTED review is an objection, so `reviewed` is false for it (PostgreSQL block below).
    const refused = acceptanceWorld({ reviewed: false }, true);
    await expect(accept(refused)).rejects.toThrow(/faites d'abord revoir/);
    expect(refused.audits).toHaveLength(0);
    const alone = acceptanceWorld({ reviewed: false }, false);
    await accept(alone);
    expect(alone.audits).toEqual([expect.objectContaining({ action: "CREATE", governanceException: "principle.acceptance.renewedWithoutReview" })]);
    expect(NOTIFICATION_CATALOG.some((e) => e.eventType === "GOVERNANCE_EXCEPTION_RECORDED")).toBe(true);
  });

  it("previous alone-acceptance REVIEWED (even if a reviewer still exists): the renewal passes with the ordinary alone marker", async () => {
    const w = acceptanceWorld({ reviewed: true }, true);
    await accept(w);
    expect(w.audits.at(-1)).toMatchObject({ governanceException: "principle.acceptance.alone" });
  });

  it("the check is tenant- and principle-scoped, and is skipped when the acceptance is confirmed by a third party (not alone)", async () => {
    const w = acceptanceWorld({ reviewed: false }, true);
    await expect(accept(w, user("rm", ["governanceprinciple.accept"], T2), "GOV-OTHER-02")).rejects.toThrow(ValidationError);
    expect(w.asked).toEqual([`${T2}:GOV-OTHER-02`]);
  });

  it("a still-open previous acceptance is not a renewal: no review demand, ordinary alone marker", async () => {
    const w = acceptanceWorld({ reviewed: false, open: true }, true);
    await accept(w);
    expect(w.audits.at(-1)).toMatchObject({ governanceException: "principle.acceptance.alone" });
  });

  it("PIN: the same account renewing: the refusal does not depend on WHO made the previous acceptance", async () => {
    // existsOther excludes the actor only; the repository answer carries no author. Observation, not a defect by itself.
    const w = acceptanceWorld({ reviewed: false }, true);
    await expect(accept(w, user("someone-else", ["governanceprinciple.accept"]))).rejects.toThrow(/faites d'abord revoir/);
  });
});

// -- q183 ------------------------------------------------------------------------------------------------------------
describe("QA-suites2 q183 account directory", () => {
  const users = [
    { id: "u2", displayName: "Zoé", email: "z@x.io", deletedAt: null },
    { id: "u1", displayName: "Aline", email: "a@x.io", deletedAt: null },
    { id: "u3", displayName: "Parti", email: "p@x.io", deletedAt: new Date() },
  ];
  const service = () => new UserService({ list: async (t: string) => (t === T ? users : []) } as never, { record: async () => undefined } as never);
  const dir = (who: AuthenticatedUser) => http((a) => a.use("/users", usersRouter(service())), who, "GET", "/users/directory");

  it("audit.mission.create alone opens the directory: active accounts, id + displayName only, sorted, tenant-scoped", async () => {
    const r = await dir(user("m", ["audit.mission.create"]));
    expect(r.status).toBe(200);
    expect(r.json.data).toEqual([{ id: "u1", displayName: "Aline" }, { id: "u2", displayName: "Zoé" }]);
    expect((await dir(user("m", ["audit.mission.create"], T2))).json.data).toEqual([]);
  });

  it("without audit.mission.create (and no other directory right) = 403; neighbouring audit / mission rights do not open it", async () => {
    for (const roles of [[], ["audit.read"], ["audit.mission.read"], ["audit.mission.update"], ["audit.mission.delete"], ["risk.read", "control.read"]]) {
      const r = await dir(user("m", roles as string[]));
      expect(r.status, JSON.stringify(roles)).toBe(403);
      expect(JSON.stringify(r.json)).not.toMatch(/Aline|Zoé|@x\.io/);
    }
  });

  it("the other three directory rights still open it; audit.mission.create does NOT give user.read (the full directory stays closed)", async () => {
    // q187 (DECISION-097): role.read opens it too (rights matrix, one account's rights).
    for (const p of ["user.read", "process.responsibility.assign", "designation.manage", "role.read"]) expect((await dir(user("m", [p]))).status, p).toBe(200);
    const full = await http((a) => a.use("/users", usersRouter(service())), user("m", ["audit.mission.create"]), "GET", "/users");
    expect(full.status).toBe(403);
    const one = await http((a) => a.use("/users", usersRouter(service())), user("m", ["audit.mission.create"]), "GET", "/users/u1");
    expect(one.status).toBe(403);
  });
});

// -- q181 on real PostgreSQL (CONTESTED is not a review) -------------------------------------------------------------
const HOST = process.env.QA_SWP_PGHOST ?? "";
describe.skipIf(!HOST.startsWith("/"))("QA-suites2 q181 real PostgreSQL", () => {
  let pool: Pool;
  afterEach(async () => { /* append-only tables: disposable database only */ });
  it("latestAloneReview: CONTESTED alone = not reviewed; REVIEWED by another = reviewed; ended = not open; another principle / tenant isolated", async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 3 });
    try {
      const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];
      const tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qs2-${Date.now()}`])).id as string;
      const other = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qs2b-${Date.now()}`])).id as string;
      const mk = async (tag: string) => (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, $2, '{}') RETURNING id`, [tenant, `${tag}-${Math.random()}@qs2`])).id as string;
      const [maker, aud1, aud2] = [await mk("maker"), await mk("aud1"), await mk("aud2")];
      const repo = new PostgresGovernancePrincipleAcceptanceRepository(pool);
      const principle = "GOV-QS2-01";
      const { acceptance } = await repo.create(
        { tenantId: tenant, principleId: principle, catalogVersion: "0.3", offendersSnapshot: [], reason: "seul", expiresAt: new Date(Date.now() + DAY), acceptedBy: maker, status: "ACTIVE", regime: "ALONE" },
        ({ acceptance: a }) => [{ tenantId: tenant, userId: maker, entityType: "GovernancePrincipleAcceptance", entityId: a.id, action: "CREATE", oldValue: null, newValue: a, reason: "seul", requestId: "qs2-a", governanceException: "principle.acceptance.alone" }],
      );
      await repo.end(tenant, acceptance.id, "REVOKED", maker, "Fin", ({ id }) => [{ tenantId: tenant, userId: maker, entityType: "GovernancePrincipleAcceptance", entityId: id, action: "CLOSE", oldValue: null, newValue: null, reason: "Fin", requestId: "qs2-b" }]);
      const auditId = (await one(`SELECT id FROM audit_log WHERE tenant_id = $1 AND entity_id = $2 AND governance_exception IS NOT NULL`, [tenant, acceptance.id])).id as string;
      expect(await repo.latestAloneReview(tenant, principle)).toEqual({ acceptanceId: acceptance.id, reviewed: false, open: false });
      await pool.query(`INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'CONTESTED', $3, 'objection')`, [tenant, auditId, aud1]);
      expect(await repo.latestAloneReview(tenant, principle)).toMatchObject({ reviewed: false });
      await pool.query(`INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'vu')`, [tenant, auditId, aud2]);
      expect(await repo.latestAloneReview(tenant, principle)).toMatchObject({ reviewed: true, open: false });
      expect(await repo.latestAloneReview(tenant, "GOV-QS2-02")).toBeNull();
      expect(await repo.latestAloneReview(other, principle)).toBeNull();
    } finally {
      await pool.end();
    }
  });
});

describe("Codex PR #199: every entity type the notifier reacts to is read by rowsForRequest", () => {
  it("GovernanceNotifier entity types are all in PostgresGovernanceQueries.rowsForRequest's list", () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    const notifier = src("../src/services/GovernanceNotifier.ts");
    const queries = src("../src/infrastructure/database/postgres/PostgresGovernanceQueries.ts");
    const types = [...new Set([...notifier.matchAll(/row\.entityType === "(\w+)"/g)].map((m) => m[1]))];
    expect(types).toContain("GovernanceDelayRequest");
    for (const t of types) expect(queries, t).toContain(`'${t}'`);
  });
});

describe.skipIf(!HOST.startsWith("/"))("QA-suites2 q179 real PostgreSQL (SEC-SA2-03)", () => {
  it("setGroupPermissions: several groups + audit rows in ONE transaction; a failure on the second group rolls the first back", async () => {
    const pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 3 });
    try {
      const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0];
      const tenant = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qs2r-${Date.now()}`])).id as string;
      const actor = (await one(`INSERT INTO users (tenant_id, email, display_name, roles) VALUES ($1, $2, 'adm', '{}') RETURNING id`, [tenant, `adm-${Math.random()}@qs2`])).id as string;
      const group = async (g: string) => (await one(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, $2, '{risk.read,${ORG}}', $2) RETURNING id`, [tenant, g])).id as string;
      const [rm, com] = [await group("RISK_MANAGER"), await group("RISK_COMMITTEE")];
      const repo = new PostgresRoleRepository(pool);
      const audit = (roles: Role[]) => roles.map((r) => ({ tenantId: tenant, userId: actor, entityType: "Role", entityId: r.id, action: "PERMISSION_CHANGE" as const, oldValue: null, newValue: r, reason: "r", requestId: "qs2-r" }));
      const perms = async (id: string) => (await one(`SELECT permissions FROM roles WHERE id = $1`, [id])).permissions as string[];
      const audits = async () => Number((await one(`SELECT count(*) AS n FROM audit_log WHERE tenant_id = $1`, [tenant])).n);
      await expect(repo.setGroupPermissions(tenant, [{ id: rm, permissions: ["risk.read"] }, { id: "00000000-0000-0000-0000-000000000000", permissions: [] }], audit)).rejects.toThrow();
      expect(await perms(rm)).toContain(ORG);
      expect(await audits()).toBe(0);
      const out = await repo.setGroupPermissions(tenant, [{ id: rm, permissions: ["risk.read"] }, { id: com, permissions: ["risk.read"] }], audit);
      expect(out.map((r) => r.id)).toEqual([rm, com]);
      expect(await perms(rm)).toEqual(["risk.read"]);
      expect(await perms(com)).toEqual(["risk.read"]);
      expect(await audits()).toBe(2);
      // Codex PR #199: membership rechecked under the user-then-role locks (actor assigned to a target group meanwhile).
      await pool.query(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $3)`, [tenant, com, actor]);
      await expect(repo.setGroupPermissions(tenant, [{ id: com, permissions: ["risk.read", ORG] }], audit, actor)).rejects.toThrow(ForbiddenError);
      expect(await perms(com)).toEqual(["risk.read"]);
      expect(await audits()).toBe(2);
      await expect(repo.setGroupPermissions(tenant, [{ id: rm, permissions: ["risk.read", ORG] }], audit, actor)).resolves.toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
