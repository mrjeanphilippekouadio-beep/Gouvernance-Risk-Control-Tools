import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { GovernanceExceptionService } from "../src/services/GovernanceExceptionService.js";
import { GovernancePrincipleAcceptanceService } from "../src/services/GovernancePrincipleAcceptanceService.js";
import { GovernanceNotifier } from "../src/services/GovernanceNotifier.js";
import { governanceNotificationsMiddleware } from "../src/api/middleware/governanceNotifications.js";
import { FIXED_GROUP_PERMISSIONS, isAuditGroupPermission } from "../src/domain/fixedGroupPermissions.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { GovernanceAuditRow, GovernanceEventSource } from "../src/domain/governance/governanceEvents.js";
import type { GovernancePrincipleAcceptance } from "../src/domain/entities/GovernanceReviews.js";
import type { AcceptanceCreated, GovernancePrincipleAcceptanceRepository } from "../src/domain/repositories/GovernanceReviewRepositories.js";

/** Lot D5: reviews, principle acceptances, mandatory governance notifications (level 1). */
const T = "t1";
const user = (userId: string, roles: string[]): AuthenticatedUser => ({ userId, tenantId: T, email: `${userId}@x`, displayName: userId, roles } as unknown as AuthenticatedUser);
const rm = user("rm", ["governanceexception.review", "governanceprinciple.accept", "governanceprinciple.acceptance.confirm", "governanceprinciple.acceptance.revoke", "governancehealth.read"]);
const rm2 = user("rm2", ["governanceprinciple.acceptance.confirm", "governancehealth.read", "audit.read"]);
const nobody = user("nobody", []);

function reviewService(entry: { userId: string; reviewable: boolean } | null) {
  const inserted: unknown[] = [];
  const audits: unknown[] = [];
  const service = new GovernanceExceptionService(
    {
      getAuditEntry: async () => (entry ? { id: "a1", entityType: "Finding", entityId: "f1", action: "CLOSE", governanceException: "x", ...entry } : null),
      insert: async (input, audit) => {
        const created = { id: "r1", tenantId: input.tenantId, auditLogId: input.auditLogId, outcome: input.outcome, reviewedBy: input.reviewedBy, reviewedAt: new Date(), comment: input.comment };
        inserted.push(input);
        audits.push(...audit(created));
        return created;
      },
    },
    { record: async () => undefined } as never,
  );
  return { service, inserted, audits };
}

describe("GovernanceExceptionService", () => {
  it("records a review with the actor as reviewer, and its audit event", async () => {
    const { service, inserted, audits } = reviewService({ userId: "author", reviewable: true });
    const r = await service.review(rm, "a1", { outcome: "REVIEWED", comment: "ok" }, "req");
    expect(r.reviewedBy).toBe("rm");
    expect(inserted).toHaveLength(1);
    expect(audits).toMatchObject([{ entityType: "GovernanceExceptionReview", action: "CREATE", newValue: { outcome: "REVIEWED" } }]);
  });
  it("refuses without the permission, the author, an unknown/non-reviewable entry, a bad comment", async () => {
    await expect(reviewService({ userId: "a", reviewable: true }).service.review(nobody, "a1", { outcome: "REVIEWED", comment: "ok" }, "r")).rejects.toThrow(ForbiddenError);
    await expect(reviewService({ userId: "rm", reviewable: true }).service.review(rm, "a1", { outcome: "REVIEWED", comment: "ok" }, "r")).rejects.toThrow(ForbiddenError);
    await expect(reviewService(null).service.review(rm, "a1", { outcome: "REVIEWED", comment: "ok" }, "r")).rejects.toThrow(NotFoundError);
    await expect(reviewService({ userId: "a", reviewable: false }).service.review(rm, "a1", { outcome: "REVIEWED", comment: "ok" }, "r")).rejects.toThrow(NotFoundError);
    await expect(reviewService({ userId: "a", reviewable: true }).service.review(rm, "a1", { outcome: "REVIEWED", comment: "  " }, "r")).rejects.toThrow(ValidationError);
  });
});

function acceptanceService(thirdParty: boolean, maxDays: number | null = null) {
  const rows = new Map<string, GovernancePrincipleAcceptance>();
  const audits: Array<Record<string, unknown>> = [];
  let n = 0;
  const repo: GovernancePrincipleAcceptanceRepository = {
    list: async () => [...rows.values()],
    getById: async (_t, id) => rows.get(id) ?? null,
    create: async (input, audit) => {
      const a: GovernancePrincipleAcceptance = {
        id: `ac${++n}`, tenantId: input.tenantId, principleId: input.principleId, catalogVersion: input.catalogVersion, offendersSnapshot: input.offendersSnapshot,
        reason: input.reason, expiresAt: input.expiresAt, status: input.status, regime: input.regime, acceptedBy: input.acceptedBy, acceptedAt: new Date(),
        confirmedBy: null, confirmedAt: null, endedBy: null, endedAt: null, endReason: null,
      };
      rows.set(a.id, a);
      const out: AcceptanceCreated = { acceptance: a, expiredClosed: null };
      audits.push(...audit(out));
      return out;
    },
    confirm: async (_t, id, by, audit) => {
      const a = { ...rows.get(id)!, status: "ACTIVE" as const, regime: "CONFIRMED" as const, confirmedBy: by };
      rows.set(id, a);
      audits.push(...audit(a));
      return a;
    },
    end: async (_t, id, to, by, reason, audit) => {
      const a = { ...rows.get(id)!, status: to, endedBy: by, endReason: reason };
      rows.set(id, a);
      audits.push(...audit(a));
      return a;
    },
  };
  const service = new GovernancePrincipleAcceptanceService(repo, { record: async () => undefined } as never, { existsOther: async () => thirdParty }, undefined, {
    getByTenant: async () => ({ acceptanceMaxDays: maxDays }) as never,
  });
  return { service, rows, audits };
}
const future = () => new Date(Date.now() + 86_400_000);

describe("GovernancePrincipleAcceptanceService", () => {
  it("q169: the tenant's maximum duration applies to an acceptance made alone, when configured, and only then", async () => {
    const accepter = user("rm", ["governanceprinciple.accept"]);
    const in40 = new Date(Date.now() + 40 * 86_400_000);
    await expect(acceptanceService(false, 30).service.accept(accepter, { principleId: "PG-SEP-01", reason: "r", expiresAt: in40 }, "q")).rejects.toThrow(/at most 30 days/);
    await expect(acceptanceService(false, 60).service.accept(accepter, { principleId: "PG-SEP-01", reason: "r", expiresAt: in40 }, "q")).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(acceptanceService(false).service.accept(accepter, { principleId: "PG-SEP-01", reason: "r", expiresAt: in40 }, "q")).resolves.toMatchObject({ status: "ACTIVE" });
    // Only an acceptance made alone is capped: one awaiting a third party's confirmation is not.
    await expect(acceptanceService(true, 30).service.accept(accepter, { principleId: "PG-SEP-01", reason: "r", expiresAt: in40 }, "q")).resolves.toMatchObject({ status: "PENDING" });
  });

  it("applies at once with the 'alone' marker when no one else can confirm", async () => {
    const { service, audits } = acceptanceService(false);
    const a = await service.accept(rm, { principleId: "GOV-SOD-01", reason: "temporaire", expiresAt: future() }, "r");
    expect(a).toMatchObject({ status: "ACTIVE", regime: "ALONE", acceptedBy: null, mine: true }); // I05: identities masked without audit.read
    expect(audits.at(-1)).toMatchObject({ action: "CREATE", governanceException: "principle.acceptance.alone" });
  });
  it("waits for a second confirmation when a third party exists; the acceptor cannot confirm", async () => {
    const { service, audits } = acceptanceService(true);
    const a = await service.accept(rm, { principleId: "GOV-SOD-01", reason: "temporaire", expiresAt: future() }, "r");
    expect(a.status).toBe("PENDING");
    expect(audits.at(-1)).toMatchObject({ governanceException: null });
    await expect(service.confirm(rm, a.id, "r")).rejects.toThrow(ForbiddenError);
    expect(await service.confirm(rm2, a.id, "r")).toMatchObject({ status: "ACTIVE", regime: "CONFIRMED", confirmedBy: "rm2" }); // rm2 holds audit.read: names shown
    await expect(service.confirm(rm2, a.id, "r")).rejects.toThrow(ConflictError);
  });
  it("validates input and permissions; an expired pending acceptance cannot be confirmed", async () => {
    const { service, rows } = acceptanceService(true);
    await expect(service.accept(nobody, { principleId: "GOV-SOD-01", reason: "x", expiresAt: future() }, "r")).rejects.toThrow(ForbiddenError);
    await expect(service.accept(rm, { principleId: "bad id", reason: "x", expiresAt: future() }, "r")).rejects.toThrow(ValidationError);
    await expect(service.accept(rm, { principleId: "GOV-SOD-01", reason: "x", expiresAt: new Date(Date.now() - 1000) }, "r")).rejects.toThrow(ValidationError);
    const a = await service.accept(rm, { principleId: "GOV-SOD-01", reason: "x", expiresAt: future() }, "r");
    rows.set(a.id, { ...a, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.confirm(rm2, a.id, "r")).rejects.toThrow(ValidationError);
  });
  it("rejects (third party) and revokes (own permission, reason required)", async () => {
    const { service } = acceptanceService(true);
    const a = await service.accept(rm, { principleId: "GOV-SOD-02", reason: "x", expiresAt: future() }, "r");
    await expect(service.reject(rm, a.id, "non", "r")).rejects.toThrow(ForbiddenError);
    expect((await service.reject(rm2, a.id, "non", "r")).status).toBe("REJECTED");
    const b = await service.accept(rm, { principleId: "GOV-SOD-03", reason: "x", expiresAt: future() }, "r");
    await expect(service.revoke(rm2, b.id, "fin", "r")).rejects.toThrow(ForbiddenError); // rm2 has no revoke permission
    await expect(service.revoke(rm, b.id, "", "r")).rejects.toThrow(ValidationError);
    expect((await service.revoke(rm, b.id, "fin", "r")).status).toBe("REVOKED");
    await expect(service.revoke(rm, b.id, "fin", "r")).rejects.toThrow(ConflictError);
  });
  it("hides who accepted unless the reader has audit.read", async () => {
    const { service } = acceptanceService(false);
    await service.accept(rm, { principleId: "GOV-SOD-01", reason: "x", expiresAt: future() }, "r");
    expect((await service.list(rm))[0]).toMatchObject({ acceptedBy: null, mine: true });
    expect((await service.list(rm2))[0]).toMatchObject({ acceptedBy: "rm", mine: false });
  });
  it("I05: accept / confirm / reject / revoke answer with the same masking as the list (no identity without audit.read)", async () => {
    const { service } = acceptanceService(true);
    const rm3 = user("rm3", ["governanceprinciple.acceptance.confirm", "governancehealth.read"]); // no audit.read
    const a = await service.accept(rm, { principleId: "GOV-SOD-01", reason: "x", expiresAt: future() }, "r");
    expect(a).toMatchObject({ acceptedBy: null, mine: true });
    expect(await service.confirm(rm3, a.id, "r")).toMatchObject({ status: "ACTIVE", acceptedBy: null, confirmedBy: null, mine: false });
    const b = await service.accept(rm, { principleId: "GOV-SOD-02", reason: "x", expiresAt: future() }, "r");
    expect(await service.reject(rm3, b.id, "non", "r")).toMatchObject({ status: "REJECTED", acceptedBy: null, endedBy: null });
    const c = await service.accept(rm, { principleId: "GOV-SOD-03", reason: "x", expiresAt: future() }, "r");
    expect(await service.revoke(rm, c.id, "fin", "r")).toMatchObject({ status: "REVOKED", endedBy: null });
  });
});

describe("fixed group rights (D5)", () => {
  it("Audit reviews and may end an acceptance, but never confirms (q157)", () => {
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).toContain("governanceexception.review");
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).not.toContain("governanceprinciple.acceptance.confirm");
    expect(FIXED_GROUP_PERMISSIONS.AUDIT.every(isAuditGroupPermission)).toBe(true);
    expect(isAuditGroupPermission("governanceprinciple.acceptance.confirm")).toBe(false);
    expect(isAuditGroupPermission("governanceprinciple.accept")).toBe(false);
  });
});

// -- notifications -----------------------------------------------------------------------------------------------
const row = (over: Partial<GovernanceAuditRow>): GovernanceAuditRow => ({
  id: "row1", userId: "actor", entityType: "Finding", entityId: "e1", action: "CLOSE", governanceException: null, oldValue: null, newValue: null, systemGroup: null, ...over,
});
function notifier(rows: GovernanceAuditRow[], opts: { manager?: string | null; unreviewed?: number } = {}) {
  const sent: Array<{ to: string; type: string; resourceId: string | null | undefined; message: string }> = [];
  const holders: Record<string, string[]> = {
    "audit.read": ["aud", "actor"], "orgprofile.approve": ["rmx", "actor"], "governanceexception.review": ["rmx", "aud", "com"],
    "config.selfvalidation.approve": ["rmx"], "governanceprinciple.acceptance.confirm": ["rmx", "com"],
  };
  const source: GovernanceEventSource = {
    rowsForRequest: async () => rows,
    holdersOf: async (_t, p) => holders[p] ?? [],
    groupMembers: async (_t, g) => (g.length === 3 ? ["rmx", "com", "aud", "removed"] : ["rmx", "com"]),
    managerId: async () => opts.manager ?? null,
    unreviewedExceptionCount: async () => opts.unreviewed ?? 0,
  };
  const n = new GovernanceNotifier(
    { emit: async (i) => { sent.push({ to: i.recipientUserId, type: i.eventType, resourceId: i.resourceId, message: i.message }); return null; } },
    source,
    () => undefined,
  );
  return { run: () => n.processRequest(T, "actor", "req"), sent };
}

describe("GovernanceNotifier (emitted after commit, from the audit rows of the request)", () => {
  it("q170: an early end by someone else tells the acceptor; the expiry close of a new acceptance does not", async () => {
    const revoked = notifier([row({ entityType: "GovernancePrincipleAcceptance", action: "CLOSE", oldValue: { status: "ACTIVE", acceptedBy: "rmx" }, newValue: { status: "REVOKED", acceptedBy: "rmx" } })]);
    await revoked.run();
    expect(revoked.sent).toMatchObject([{ to: "rmx", type: "PRINCIPLE_ACCEPTANCE_REVOKED" }]);
    const own = notifier([row({ entityType: "GovernancePrincipleAcceptance", action: "CLOSE", oldValue: { status: "ACTIVE", acceptedBy: "actor" }, newValue: { status: "REVOKED", acceptedBy: "actor" } })]);
    await own.run();
    expect(own.sent).toEqual([]);
    const expiry = notifier([row({ entityType: "GovernancePrincipleAcceptance", action: "CLOSE", oldValue: { previousStatus: "ACTIVE" }, newValue: { status: "REVOKED", acceptedBy: "rmx" } })]);
    await expiry.run();
    expect(expiry.sent).toEqual([]);
  });

  it("marked exception -> reviewers and manager, never the author; no name in the message", async () => {
    const { run, sent } = notifier([row({ governanceException: "noSelfValidation" })], { manager: "mgr" });
    await run();
    expect(sent.map((s) => s.to).sort()).toEqual(["aud", "com", "mgr", "rmx"]);
    expect(new Set(sent.map((s) => s.type))).toEqual(new Set(["GOVERNANCE_EXCEPTION_RECORDED"]));
    expect(sent.every((s) => !s.message.includes("actor"))).toBe(true);
  });
  it("Risk Manager vacancy: nothing (q160)", async () => {
    const { run, sent } = notifier([row({ entityType: "Role", action: "ROLE_CHANGE", governanceException: "riskManager.vacancy", oldValue: { userId: "u" }, newValue: { riskManagerGroupEmpty: true }, systemGroup: "RISK_MANAGER" })]);
    await run();
    expect(sent).toEqual([]);
  });
  it("size drop: Audit told (and may contest); pending also warns the approvers; not twice for the same person", async () => {
    const { run, sent } = notifier([row({ entityType: "OrganizationProfile", action: "SUBMIT", newValue: { lowersSize: true, status: "PENDING", id: "p1" } })]);
    await run();
    expect(sent.filter((s) => s.type === "ORGPROFILE_SIZE_LOWERED").map((s) => s.to)).toEqual(["aud"]);
    expect(sent.filter((s) => s.type === "ORGPROFILE_APPROVAL_PENDING")).toMatchObject([{ to: "rmx", resourceId: "p1" }]);
    const alone = notifier([row({ entityType: "OrganizationProfile", action: "SUBMIT", governanceException: "orgprofile.adminAlone", newValue: { lowersSize: true, status: "ACTIVE" } })]);
    await alone.run();
    expect(alone.sent.filter((s) => s.to === "aud")).toHaveLength(1);
  });
  it("policy request pending (q158), acceptance pending, contestation", async () => {
    const a = notifier([row({ entityType: "SelfValidationPolicyRequest", action: "SUBMIT", entityId: "req1" })]);
    await a.run();
    expect(a.sent).toMatchObject([{ to: "rmx", type: "SELF_VALIDATION_POLICY_REQUEST_PENDING", resourceId: "req1" }]);
    const b = notifier([row({ entityType: "GovernancePrincipleAcceptance", action: "CREATE", newValue: { status: "PENDING" } })]);
    await b.run();
    expect(b.sent.map((s) => s.type)).toEqual(["PRINCIPLE_ACCEPTANCE_PENDING", "PRINCIPLE_ACCEPTANCE_PENDING"]);
    const c = notifier([row({ entityType: "GovernanceExceptionReview", action: "CREATE", newValue: { outcome: "CONTESTED", auditLogId: "al1" } })]);
    await c.run();
    expect(c.sent.map((s) => s.to).sort()).toEqual(["com", "rmx"]);
    const d = notifier([row({ entityType: "GovernanceExceptionReview", action: "CREATE", newValue: { outcome: "REVIEWED", auditLogId: "al1" } })]);
    await d.run();
    expect(d.sent).toEqual([]);
  });
  it("new Audit/Committee member learns of unreviewed exceptions only when there are some (R-6.3)", async () => {
    const assign = row({ entityType: "Role", action: "ROLE_CHANGE", systemGroup: "AUDIT", newValue: { userId: "newbie" } });
    const none = notifier([assign]);
    await none.run();
    expect(none.sent).toEqual([]);
    const some = notifier([assign], { unreviewed: 3 });
    await some.run();
    expect(some.sent).toMatchObject([{ to: "newbie", type: "GOVERNANCE_EXCEPTIONS_TO_REVIEW" }]);
    expect(some.sent[0]!.message).toContain("3");
  });
  it("member removal is told to the remaining members (SEC-PNL-04), not for a hand-over to an interim", async () => {
    const removal = row({ id: "rm1", entityType: "Role", action: "ROLE_CHANGE", entityId: "role1", systemGroup: "AUDIT", oldValue: { userId: "removed" } });
    const a = notifier([removal]);
    await a.run();
    expect(a.sent.map((s) => s.to).sort()).toEqual(["aud", "com", "rmx"]);
    expect(a.sent.every((s) => s.type === "GOVERNANCE_MEMBER_REMOVED")).toBe(true);
    const handOver = notifier([
      { ...removal, systemGroup: "RISK_MANAGER" },
      row({ id: "rm2", entityType: "Role", action: "ROLE_CHANGE", entityId: "role1", systemGroup: "RISK_MANAGER", newValue: { userId: "interim" } }),
    ]);
    await handOver.run();
    expect(handOver.sent).toEqual([]);
  });
  it("a failure never throws, and the same audit row is handled once", async () => {
    const failing = new GovernanceNotifier({ emit: async () => { throw new Error("boom"); } }, { ...notifier([]) as never, rowsForRequest: async () => [row({ governanceException: "x" })], holdersOf: async () => ["u"], managerId: async () => null } as never, () => undefined);
    await expect(failing.processRequest(T, "actor", "req")).resolves.toBeUndefined();
    const once = notifier([row({ governanceException: "x" })]);
    await once.run();
    const first = once.sent.length;
    expect(first).toBeGreaterThan(0);
    await once.run(); // same request id replayed: same audit row, not notified again
    expect(once.sent).toHaveLength(first);
  });
});

describe("governanceNotificationsMiddleware", () => {
  function run(method: string, status: number, withUser = true) {
    const calls: unknown[][] = [];
    const mw = governanceNotificationsMiddleware({ processRequest: async (...a: unknown[]) => { calls.push(a); } } as never);
    const res = Object.assign(new EventEmitter(), { statusCode: status, end: () => res });
    const req = { method, requestId: "rid", user: withUser ? { tenantId: T, userId: "u" } : undefined };
    mw(req as never, res as never, () => undefined);
    res.end(); // SEC-PNL2-01: the trigger is res.end, not the "finish" event
    return calls;
  }
  it("notifies after a successful mutation only", () => {
    expect(run("POST", 201)).toEqual([[T, "u", "rid"]]);
    expect(run("POST", 403)).toEqual([]);
    expect(run("GET", 200)).toEqual([]);
    expect(run("POST", 200, false)).toEqual([]);
  });
});
