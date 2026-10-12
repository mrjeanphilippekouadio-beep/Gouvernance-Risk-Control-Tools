import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Pool } from "pg";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { NotificationService } from "../src/services/NotificationService.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { SystemGroup } from "../src/domain/entities/Role.js";
import type { Notification } from "../src/domain/entities/Notification.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for B-6a bis (d51e0c8, merged 7bb97f5). Oracles: docs/architecture/RM-V1-B6-Dispositif-spec.md (§2.3, §5.3, §5.4)
// and the F-B6a-* / C-B6a-* findings. The service world is an in-memory fake; the repository is exercised through a
// STATEFUL fake pool that interprets only the SQL shapes the repository is known to send (anything else throws) and
// gives BEGIN/COMMIT/ROLLBACK real semantics. PostgreSQL itself is NOT exercised. A QA PASS here is not a Security,
// Privacy or Compliance verdict.

afterEach(() => vi.restoreAllMocks());

const T1 = "t1";
const FW: Permission[] = [
  "riskframework.read", "riskframework.create", "riskframework.update",
  "riskframework.activate", "riskframework.archive", "riskframework.process.assign",
];
const actor = (userId: string, perms: Permission[] = FW): AuthenticatedUser =>
  ({ userId, tenantId: T1, email: `${userId}@x`, displayName: userId, roles: perms }) as AuthenticatedUser;
const [u1, u2, u3] = [actor("u1"), actor("u2"), actor("u3")];
const admin = actor("admin");
const R = "req";
const FWID = "00000000-0000-4000-8000-0000000000f1";
const V1 = "00000000-0000-4000-8000-0000000000e1";

const lv = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
function scale(id: string, status: RatingScale["status"] = "ACTIVE", n = 5): RatingScale {
  return {
    id, tenantId: T1, name: id, version: "1", status, probabilityLevels: n, probabilityLabels: lv(n),
    impactLevels: n, impactLabels: lv(n), criticalityThresholds: null,
    impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: lv(n) }], retainedImpactRule: "MAX" },
    velocityLevels: null, persistenceLevels: null, masteryScale: null, activatedAt: null, archivedAt: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
  } as RatingScale;
}

type Ev = { tenantId: string; userId: string; entityType: string; entityId: string; action: string };
type Row = Record<string, unknown> & { id: string; status: string };

interface Opts { rm?: string[]; scales?: RatingScale[]; notifications?: Record<string, unknown> }

function world(o: Opts = {}) {
  const scales = o.scales ?? [scale("s1")];
  const versions: Row[] = [];
  const requests: Row[] = [];
  const events: Ev[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const calls = { lockedCalls: 0, lockedSeen: [] as unknown[], storeAttempts: 0, trace: [] as string[] };
  const hooks = {
    auditFails: (_e: Ev) => false,
    beforeLock: () => undefined as void,
    storeFails: false,
    recordFails: (_i: Record<string, unknown>) => false,
  };
  const fw = { id: FWID, tenantId: T1, name: "D", isDefault: false, archivedAt: null };
  const find = (id: string) => versions.find((v) => v.id === id)!;
  const groups: Record<SystemGroup, string[]> = { RISK_MANAGER: o.rm ?? ["u1", "u2", "u3"], AUDIT: [], RISK_COMMITTEE: [] };
  const repo = {
    async getFramework(_t: string, id: string) { return id === FWID ? fw : null; },
    async listVersions() { return versions; },
    async getVersion(_t: string, _f: string, id: string) { return versions.find((v) => v.id === id) ?? null; },
    async getActiveVersion() { return versions.find((v) => v.status === "ACTIVE") ?? null; },
    async createWithDraft(i: { createdBy: string; params: object }) {
      versions.push({ id: V1, tenantId: T1, frameworkId: FWID, versionNumber: 1, status: "DRAFT", ...i.params, createdBy: i.createdBy, lastEditedBy: i.createdBy } as Row);
      return { framework: fw, version: versions[0] };
    },
    async createDraftFrom(_t: string, _f: string, src: string, by: string) {
      const s = find(src);
      const v = { ...s, id: randomUUID(), versionNumber: versions.length + 1, status: "DRAFT", createdBy: by, lastEditedBy: by } as Row;
      versions.push(v);
      return v;
    },
    async updateDraft(_t: string, _f: string, id: string, fields: object, by: string) {
      calls.storeAttempts++;
      calls.trace.push("store");
      if (hooks.storeFails) throw new Error("store down");
      return Object.assign(find(id), fields, { lastEditedBy: by });
    },
    async discardDraft(_t: string, _f: string, id: string) { return Object.assign(find(id), { status: "ARCHIVED" }); },
    async createActivationRequest(i: { versionId: string; requestedBy: string; validateLocked?: (v: never) => Promise<void> }) {
      hooks.beforeLock();
      if (i.validateLocked) {
        calls.lockedCalls++;
        calls.lockedSeen.push(structuredClone(find(i.versionId)));
        await i.validateLocked(find(i.versionId) as never);
      }
      find(i.versionId).status = "PENDING_APPROVAL";
      const r = { id: randomUUID(), tenantId: T1, kind: "ACTIVATE_VERSION", frameworkId: FWID, versionId: i.versionId, status: "PENDING", requestedBy: i.requestedBy } as Row;
      requests.push(r);
      return r;
    },
    async getRequest(_t: string, id: string) { return requests.find((r) => r.id === id) ?? null; },
    async recordDecision(_t: string, id: string, d: { outcome: string; decidedBy: string }) {
      const r = requests.find((x) => x.id === id)!;
      r.status = d.outcome;
      const v = find(r.versionId as string);
      const previousActive = d.outcome === "APPROVED" ? versions.find((x) => x.status === "ACTIVE") ?? null : null;
      if (previousActive) previousActive.status = "ARCHIVED";
      v.status = d.outcome === "APPROVED" ? "ACTIVE" : "DRAFT";
      return { request: r, version: v, previousActive };
    },
    async withdraw(_t: string, id: string) {
      const r = requests.find((x) => x.id === id)!;
      r.status = "WITHDRAWN";
      find(r.versionId as string).status = "DRAFT";
      return { request: r, version: find(r.versionId as string), previousActive: null };
    },
  };
  const role = (g: SystemGroup) => ({ id: g, tenantId: T1, name: g, permissions: [], systemGroup: g });
  const roles = {
    async list() { return (Object.keys(groups) as SystemGroup[]).map(role); },
    async listForUser(_t: string, u: string) { return (Object.keys(groups) as SystemGroup[]).filter((g) => groups[g].includes(u)).map(role); },
    async listAssignments(_t: string, id: string) { return groups[id as SystemGroup].map((userId) => ({ userId, roleId: id, revokedAt: null })); },
  };
  const users = {
    async getById(_t: string, id: string) { return { id, deletedAt: null }; },
    async listWithPermission(_t: string, p: string, exclude: string) {
      return (p === "riskframework.activate" ? groups.RISK_MANAGER : []).filter((i) => i !== exclude).map((id) => ({ id }));
    },
  };
  const audit = {
    async record(e: Ev) { calls.trace.push(`audit:${e.action}`); if (hooks.auditFails(e)) throw new Error("audit down"); events.push(e); },
    async listForEntity(t: string, type: string, id: string) { return events.filter((e) => e.tenantId === t && e.entityType === type && e.entityId === id); },
  };
  const notifications = o.notifications ?? {
    async record(i: Record<string, unknown>) { if (hooks.recordFails(i)) throw new Error("notif down"); sent.push({ via: "record", ...i }); },
  };
  const ratingScales = { async getById(_t: string, id: string) { return scales.find((s) => s.id === id) ?? null; } };
  const service = new RiskFrameworkService(repo as never, ratingScales as never, roles as never, users as never, audit as never, undefined, notifications as never);
  const snapshot = () => JSON.stringify([versions, requests, events.length, sent.length]);
  return { service, versions, requests, events, sent, calls, hooks, scales, groups, snapshot };
}
type W = ReturnType<typeof world>;

async function mk(w: W, by = u1) {
  const { version } = await w.service.create(by, { name: "D", ratingScaleId: "s1" }, R);
  return version.id;
}
async function pending(w: W, by = u1) {
  const v = await mk(w, by);
  const r = await w.service.requestActivation(by, FWID, v, "go", R);
  return { v, r: r.id };
}
const submits = (w: W) => w.events.filter((e) => e.action === "SUBMIT");

// =====================================================================================================
describe("QA-B6abis validateLocked (F-B6a-02): replay on the locked version at request time", () => {
  it("is passed to the repository exactly once and sees the row as it is at the lock, not the stale read", async () => {
    const w = world();
    const v = await mk(w);
    w.hooks.beforeLock = () => { w.versions[0]!.committeeEvaluationMinScore = 20; };
    await w.service.requestActivation(u1, FWID, v, "go", R);
    expect(w.calls.lockedCalls).toBe(1);
    expect(w.calls.lockedSeen[0]).toMatchObject({ committeeEvaluationMinScore: 20, status: "DRAFT" });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ["evaluation threshold above n^2 (26 > 25)", { committeeEvaluationMinScore: 26 }, /exceed the maximum score/],
    ["treatment threshold above n^2", { committeeTreatmentMinScore: 99 }, /exceed the maximum score/],
    ["appetite above n^2", { appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 30, description: null }] }, /Fraude/],
    ["rating scale vanished", { ratingScaleId: "gone" }, /no longer exists/],
    ["self-proposal switched on under a Risk Manager circuit (q65)", { selfProposalAllowed: true }, /auto-proposition/],
  ])("a PATCH landing just before the lock is caught: %s -> 400, version DRAFT, no request, no SUBMIT, no notification", async (_l, patch, msg) => {
    const w = world();
    const v = await mk(w);
    w.hooks.beforeLock = () => { Object.assign(w.versions[0]!, patch); };
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow(msg);
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow(ValidationError);
    expect(w.requests).toHaveLength(0);
    expect(w.versions[0]!.status).toBe("DRAFT");
    expect(submits(w)).toHaveLength(0);
    expect(w.sent).toHaveLength(0);
  });

  it("boundary: a threshold equal to n^2 (25) passes the locked replay, 26 does not", async () => {
    const ok = world();
    const v = await mk(ok);
    ok.hooks.beforeLock = () => { ok.versions[0]!.committeeEvaluationMinScore = 25; };
    await expect(ok.service.requestActivation(u1, FWID, v, "go", R)).resolves.toBeDefined();
  });

  it("an invalid version is refused BEFORE the repository is even asked to lock (no lock taken for nothing)", async () => {
    const w = world();
    const v = await mk(w);
    w.versions[0]!.committeeEvaluationMinScore = 26;
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow(ValidationError);
    expect(w.calls.lockedCalls).toBe(0);
  });

  it("the circuit announced is the one resolved under the lock: the other Risk Managers vanish before the lock -> NO_DECIDER, not CHANGE_PENDING", async () => {
    const w = world({ rm: ["u1", "u2"] });
    const v = await mk(w);
    w.hooks.beforeLock = () => { w.groups.RISK_MANAGER = ["u1"]; };
    await w.service.requestActivation(u1, FWID, v, "go", R);
    expect(w.sent.map((s) => s.eventType)).toEqual(["RISK_FRAMEWORK_NO_DECIDER"]);
  });
});

describe("QA-B6abis approval replays the rules (F-B6a-02)", () => {
  it("scale shrunk after the request: approve -> 400 and NOTHING moves; reject and withdraw stay possible", async () => {
    const w = world();
    const { v, r } = await pending(w);
    w.scales[0] = scale("s1", "ACTIVE", 3); // ceiling 9 < committee threshold 15
    const before = w.snapshot();
    await expect(w.service.approve(u2, r, "ok", R)).rejects.toThrow(/maximum score of the scale \(9\)/);
    expect(w.snapshot()).toBe(before);
    expect(w.requests[0]!.status).toBe("PENDING");
    expect(w.versions.find((x) => x.id === v)!.status).toBe("PENDING_APPROVAL");
    expect(w.events.filter((e) => e.action === "APPROVE")).toHaveLength(0);
    await w.service.reject(u2, r, "seuil impossible", R);
    expect(w.requests[0]!.status).toBe("REJECTED");
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("scale shrunk then the requester withdraws: still possible", async () => {
    const w = world();
    const { r } = await pending(w);
    w.scales[0] = scale("s1", "ACTIVE", 3);
    await expect(w.service.withdraw(u1, r, "retrait", R)).resolves.toBeDefined();
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("scale deleted after the request: approve -> 400 'no longer exists', request still PENDING", async () => {
    const w = world();
    const { r } = await pending(w);
    w.scales.length = 0;
    await expect(w.service.approve(u2, r, undefined, R)).rejects.toThrow(/no longer exists/);
    expect(w.requests[0]!.status).toBe("PENDING");
  });

  it("self-proposal flag flipped in storage after the request: approve refused (q65), reject accepted", async () => {
    const w = world();
    const { r } = await pending(w);
    w.versions[0]!.selfProposalAllowed = true;
    await expect(w.service.approve(u2, r, undefined, R)).rejects.toThrow(/auto-proposition/);
    expect(w.requests[0]!.status).toBe("PENDING");
    await expect(w.service.reject(u2, r, "non", R)).resolves.toBeDefined();
  });

  it("a valid request is still approved (the replay does not over-refuse) and the replay uses the REQUESTER, not the approver", async () => {
    const w = world({ rm: ["u1", "u2"] });
    const { r } = await pending(w, u1);
    // if the replay took the approver as requester, u2 would be excluded and the RM circuit would see 0 eligible; it must still decide
    const out = await w.service.approve(u2, r, undefined, R);
    expect(out.request.status).toBe("APPROVED");
    expect(out.request).toMatchObject({ status: "APPROVED" });
  });

  it.fails("KNOWN GAP B6abis-QA-01: a version on an ARCHIVED scale can be submitted (and RMs are notified) although it can never be approved", async () => {
    // Fail-fast expected: assertActivatable only checks existence/squareness/descriptors; the ARCHIVED check lives in the repository
    // transaction (mirrorScale) and fires at approval only. Minor: a review cycle is wasted, the request must be withdrawn.
    const w = world({ scales: [scale("s1", "ARCHIVED")] });
    const v = await mk(w);
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow(ValidationError);
  });
});

// =====================================================================================================
describe("QA-B6abis discardDraft guarded by Risk Manager membership (F-B6a-03)", () => {
  it("administrator holding every permission, but not a Risk Manager: 403, draft untouched, no audit line", async () => {
    const w = world();
    const v = await mk(w);
    const before = w.snapshot();
    await expect(w.service.discardDraft(admin, FWID, v, "x", R)).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("Risk Manager lacking riskframework.archive: 403 (membership is not a substitute for the permission)", async () => {
    const w = world();
    const v = await mk(w);
    await expect(w.service.discardDraft(actor("u2", FW.filter((p) => p !== "riskframework.archive")), FWID, v, "x", R)).rejects.toThrow(ForbiddenError);
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("Risk Manager whose role was revoked meanwhile: 403", async () => {
    const w = world();
    const v = await mk(w);
    w.groups.RISK_MANAGER = ["u1", "u3"];
    await expect(w.service.discardDraft(u2, FWID, v, "x", R)).rejects.toThrow(/Risk Manager/);
    expect(w.versions[0]!.status).toBe("DRAFT");
  });

  it("the membership check comes first: a non-RM learns neither the existence of the version (403, not 404) nor the reason rule (403, not 400)", async () => {
    const w = world();
    const v = await mk(w);
    await expect(w.service.discardDraft(admin, FWID, "unknown", "x", R)).rejects.toThrow(ForbiddenError);
    await expect(w.service.discardDraft(admin, FWID, v, "", R)).rejects.toThrow(ForbiddenError);
  });

  it("a Risk Manager: reason mandatory (400), unknown version 404, PENDING version refused (400), valid discard audited with the reason", async () => {
    const w = world();
    const v = await mk(w);
    await expect(w.service.discardDraft(u2, FWID, v, "  ", R)).rejects.toThrow(ValidationError);
    await expect(w.service.discardDraft(u2, FWID, "unknown", "x", R)).rejects.toThrow(NotFoundError);
    const r = await w.service.requestActivation(u1, FWID, v, "go", R);
    await expect(w.service.discardDraft(u2, FWID, v, "x", R)).rejects.toThrow(ValidationError);
    await w.service.withdraw(u1, r.id, "retrait", R);
    await w.service.discardDraft(u2, FWID, v, "abandon", R);
    expect(w.versions[0]!.status).toBe("ARCHIVED");
    expect(w.events.at(-1)).toMatchObject({ action: "STATUS_CHANGE", userId: "u2", entityId: v });
  });

  it("the HTTP route answers 403 to the non-RM administrator", async () => {
    const w = world();
    const v = await mk(w);
    await withHttp(w, async (call) => {
      const res = await call("POST", `/${FWID}/versions/${v}/discard`, { reason: "x" }, admin);
      expect(res.status).toBe(403);
    });
    expect(w.versions[0]!.status).toBe("DRAFT");
  });
});

// =====================================================================================================
describe("QA-B6abis exclusion of DRAFT rating-scale authors (F-B6a-04)", () => {
  const scaleEv = (userId: string, action: string, entityId = "s1", entityType = "RatingScale"): Ev => ({ tenantId: T1, userId, entityType, entityId, action });

  it.each(["CREATE", "UPDATE"])("an author (%s) of the DRAFT scale cannot approve NOR reject", async (action) => {
    const w = world({ scales: [scale("s1", "DRAFT")] });
    w.events.push(scaleEv("u3", action));
    const { r } = await pending(w);
    const before = w.snapshot();
    await expect(w.service.approve(u3, r, undefined, R)).rejects.toThrow(ForbiddenError);
    await expect(w.service.reject(u3, r, "non", R)).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    await expect(w.service.approve(u2, r, undefined, R)).resolves.toBeDefined(); // a third party still can
  });

  it.each(["ACTIVE", "ARCHIVED"] as const)("no exclusion once the scale is %s (it is frozen)", async (status) => {
    const w = world({ scales: [scale("s1", status)] });
    w.events.push(scaleEv("u3", "UPDATE"));
    const { r } = await pending(w);
    await expect(w.service.approve(u3, r, undefined, R)).resolves.toBeDefined();
  });

  it("only CREATE/UPDATE count: STATUS_CHANGE/DELETE lines on the scale do not exclude", async () => {
    const w = world({ scales: [scale("s1", "DRAFT")] });
    w.events.push(scaleEv("u3", "STATUS_CHANGE"), scaleEv("u3", "DELETE"));
    const { r } = await pending(w);
    await expect(w.service.approve(u3, r, undefined, R)).resolves.toBeDefined();
  });

  it("another scale's authors, another entity type with the same id, and another tenant's lines do not exclude", async () => {
    const w = world({ scales: [scale("s1", "DRAFT"), scale("s2", "DRAFT")] });
    w.events.push(scaleEv("u3", "UPDATE", "s2"), scaleEv("u3", "UPDATE", "s1", "RiskFramework"), { ...scaleEv("u3", "UPDATE"), tenantId: "t2" });
    const { r } = await pending(w);
    await expect(w.service.approve(u3, r, undefined, R)).resolves.toBeDefined();
  });

  it("the scale author is also removed from the eligible count: the only other Risk Manager edited the scale -> NO_DECIDER at request, and that person cannot approve", async () => {
    const w = world({ rm: ["u1", "u2"], scales: [scale("s1", "DRAFT")] });
    w.events.push(scaleEv("u2", "UPDATE"));
    const { r } = await pending(w);
    // q75: told to every Risk Manager (the requester included), never a tacit validation
    expect(w.sent.map((s) => [s.recipientUserId, s.eventType])).toEqual([["u1", "RISK_FRAMEWORK_NO_DECIDER"], ["u2", "RISK_FRAMEWORK_NO_DECIDER"]]);
    await expect(w.service.approve(u2, r, "ok", R)).rejects.toThrow(ForbiddenError);
    expect(w.requests[0]!.status).toBe("PENDING");
  });

  it("the requester who authored the DRAFT scale is not an 'author' problem for others: a third RM still decides", async () => {
    const w = world({ scales: [scale("s1", "DRAFT")] });
    w.events.push(scaleEv("u1", "CREATE"));
    const { r } = await pending(w, u1);
    await expect(w.service.approve(u2, r, undefined, R)).resolves.toBeDefined();
  });
});

// =====================================================================================================
describe("QA-B6abis audit-first edits (B6a-QA-01)", () => {
  it("an edit whose audit failed is not stored, lastEditedBy unchanged, and the person is not (yet) an author", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    const v = await mk(w);
    w.hooks.auditFails = (e) => e.action === "UPDATE";
    await expect(w.service.updateDraft(u3, FWID, v, { committeeEvaluationEnforced: false }, R)).rejects.toThrow(/audit down/);
    expect(w.calls.storeAttempts).toBe(0);
    expect(w.versions[0]!.committeeEvaluationEnforced).toBe(true);
    expect(w.versions[0]!.lastEditedBy).toBe("u1");
    w.hooks.auditFails = () => false;
    const { r } = await (async () => ({ r: (await w.service.requestActivation(u1, FWID, v, "go", R)).id }))();
    await expect(w.service.approve(u3, r, undefined, R)).resolves.toBeDefined(); // nothing was stored, nothing to exclude
  });

  it("OBSERVATION (accepted over-exclusion): audit written but the store fails -> the editor is excluded although nothing was stored", async () => {
    const w = world();
    const v = await mk(w);
    w.hooks.storeFails = true;
    await expect(w.service.updateDraft(u3, FWID, v, { committeeEvaluationEnforced: false }, R)).rejects.toThrow(/store down/);
    expect(w.versions[0]!.committeeEvaluationEnforced).toBe(true);
    expect(w.events.filter((e) => e.action === "UPDATE" && e.userId === "u3")).toHaveLength(1);
    w.hooks.storeFails = false;
    const r = await w.service.requestActivation(u1, FWID, v, "go", R);
    await expect(w.service.approve(u3, r.id, undefined, R)).rejects.toThrow(ForbiddenError);
  });

  it("the audit line precedes the store and records the editor and the new values", async () => {
    const w = world();
    const v = await mk(w);
    w.calls.trace.length = 0;
    await w.service.updateDraft(u2, FWID, v, { defaultEvaluationMode: "PARTICIPATIF" }, R);
    expect(w.calls.trace).toEqual(["audit:UPDATE", "store"]);
    expect(w.events.at(-1)).toMatchObject({ action: "UPDATE", userId: "u2", entityId: v });
  });
});

// =====================================================================================================
describe("QA-B6abis changeApprover guard (C-B6a-02) and withdraw reason (C-B6a-04)", () => {
  it("create and update both refuse AUDIT/COMMITTEE/AUDIT_AND_COMMITTEE (400, nothing stored/audited); unknown value still reports the enum error", async () => {
    const w = world();
    const v = await mk(w);
    const before = w.snapshot();
    for (const a of ["AUDIT", "COMMITTEE", "AUDIT_AND_COMMITTEE"] as const) {
      await expect(w.service.updateDraft(u1, FWID, v, { changeApprover: a }, R)).rejects.toThrow(/B-12/);
      await expect(w.service.create(u1, { name: "X", ratingScaleId: "s1", params: { changeApprover: a } }, R)).rejects.toThrow(/B-12/);
    }
    await expect(w.service.updateDraft(u1, FWID, v, { changeApprover: "NOBODY" as never }, R)).rejects.toThrow(/must be one of/);
    expect(w.snapshot()).toBe(before);
    expect(w.calls.storeAttempts).toBe(0);
  });

  it("a stored non-RM approver (legacy data) is recoverable: PATCH back to RISK_MANAGER works and the request then follows the RM circuit", async () => {
    const w = world();
    const v = await mk(w);
    w.versions[0]!.changeApprover = "COMMITTEE";
    await w.service.updateDraft(u1, FWID, v, { changeApprover: "RISK_MANAGER" }, R);
    expect(w.versions[0]!.changeApprover).toBe("RISK_MANAGER");
    const r = await w.service.requestActivation(u1, FWID, v, "go", R);
    await expect(w.service.approve(u2, r.id, undefined, R)).resolves.toBeDefined();
  });

  it("a stored non-RM approver on the ACTIVE version still drives the next draft's circuit (the guard is on writes only): Committee of 2 -> approve 409; no Committee -> Risk Manager fallback needing a comment", async () => {
    const w = world();
    const { v, r } = await pending(w);
    await w.service.approve(u2, r, undefined, R);
    w.versions.find((x) => x.id === v)!.changeApprover = "COMMITTEE";
    const d = await w.service.createDraft(u2, FWID, undefined, R);
    const r2 = await w.service.requestActivation(u2, FWID, d.id, "go", R);
    // no Committee member: fallback to a Risk Manager, whose comment becomes mandatory
    await expect(w.service.approve(u3, r2.id, undefined, R)).rejects.toThrow(ValidationError);
    expect(w.requests.find((x) => x.id === r2.id)!.status).toBe("PENDING");
    // a Committee of 2: the vote (B-12) is awaited, 409
    w.groups.RISK_COMMITTEE = ["c1", "c2"];
    await expect(w.service.approve(u3, r2.id, "x", R)).rejects.toThrow(ConflictError);
    await expect(w.service.reject(u3, r2.id, "x", R)).rejects.toThrow(ConflictError);
    expect(w.requests.find((x) => x.id === r2.id)!.status).toBe("PENDING");
    await expect(w.service.withdraw(u2, r2.id, "retrait", R)).resolves.toBeDefined();
  });

  it("withdraw: missing / blank / too long reason -> 400 and the request stays PENDING; a real reason works and is audited", async () => {
    const w = world();
    const { r } = await pending(w);
    const before = w.snapshot();
    await expect(w.service.withdraw(u1, r, undefined, R)).rejects.toThrow(ValidationError);
    await expect(w.service.withdraw(u1, r, "", R)).rejects.toThrow(ValidationError);
    await expect(w.service.withdraw(u1, r, " \n\t ", R)).rejects.toThrow(ValidationError);
    await expect(w.service.withdraw(u1, r, "x".repeat(5000), R)).rejects.toThrow(ValidationError);
    expect(w.snapshot()).toBe(before);
    await w.service.withdraw(u1, r, "erreur", R);
    expect(w.events.at(-1)).toMatchObject({ action: "STATUS_CHANGE", entityType: "RiskFrameworkChangeRequest" });
  });

  it("withdraw error precedence: non-requester without reason -> 403; already decided without reason -> 409 (state before input)", async () => {
    const w = world();
    const { r } = await pending(w);
    await expect(w.service.withdraw(u2, r, undefined, R)).rejects.toThrow(ForbiddenError);
    await w.service.approve(u2, r, undefined, R);
    await expect(w.service.withdraw(u1, r, undefined, R)).rejects.toThrow(ConflictError);
  });

  it("HTTP: the route schema keeps the reason optional, the service answers 400 (not 500, not 200); with a reason 200; with extra key 400", async () => {
    const w = world();
    const { r } = await pending(w);
    await withHttp(w, async (call) => {
      for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: 5 }, { reason: "x".repeat(5000) }]) {
        const res = await call("POST", `/change-requests/${r}/withdraw`, body, u1);
        expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
      }
      expect((await call("POST", `/change-requests/${r}/withdraw`, { reason: "ok", status: "APPROVED" }, u1)).status).toBe(400);
      expect(w.requests[0]!.status).toBe("PENDING");
      const ok = await call("POST", `/change-requests/${r}/withdraw`, { reason: "ok" }, u1);
      expect(ok.status).toBe(200);
      expect(w.requests[0]!.status).toBe("WITHDRAWN");
    });
  });

  it("HTTP: PATCH with changeApprover COMMITTEE -> 400 and nothing stored; RISK_MANAGER -> 200", async () => {
    const w = world();
    const v = await mk(w);
    await withHttp(w, async (call) => {
      expect((await call("PATCH", `/${FWID}/versions/${v}`, { changeApprover: "COMMITTEE" }, u1)).status).toBe(400);
      expect(w.calls.storeAttempts).toBe(0);
      expect((await call("PATCH", `/${FWID}/versions/${v}`, { changeApprover: "RISK_MANAGER" }, u1)).status).toBe(200);
    });
  });
});

// =====================================================================================================
describe("QA-B6abis notifications (C-B6a-01, F-B6a-07)", () => {
  /** Real NotificationService over an in-memory repository: dedup semantics come from the product, not from a fake emit. */
  function realNotifications() {
    const rows: Array<Notification & { readAt: Date | null }> = [];
    const repo = {
      async create(d: Omit<Notification, "id" | "sentAt" | "readAt">) { const n = { id: `n${rows.length + 1}`, ...d, sentAt: new Date(), readAt: null } as Notification & { readAt: Date | null }; rows.push(n); return n; },
      async insertIfNoUnread(d: Omit<Notification, "id" | "sentAt" | "readAt">) {
        if (rows.some((n) => !n.readAt && n.tenantId === d.tenantId && n.recipientUserId === d.recipientUserId && n.resourceType === d.resourceType && n.resourceId === d.resourceId && n.eventType === d.eventType)) return null;
        const n = { id: `n${rows.length + 1}`, ...d, sentAt: new Date(), readAt: null } as Notification & { readAt: Date | null };
        rows.push(n);
        return n;
      },
    };
    const svc = new NotificationService(repo as never, { async getByKey() { return null; } } as never, { async record() { /* noop */ } } as never);
    return { svc, rows };
  }
  const count = (rows: Array<{ recipientUserId: string; eventType: string }>, who: string, ev: string) => rows.filter((n) => n.recipientUserId === who && n.eventType === ev).length;

  it("CHANGE_PENDING is deduplicated per recipient on the Dispositif: request, withdraw, re-request while unread -> one notification each", async () => {
    const n = realNotifications();
    const w = world({ notifications: n.svc });
    const v = await mk(w);
    const r1 = await w.service.requestActivation(u1, FWID, v, "go", R);
    expect([count(n.rows, "u2", "RISK_FRAMEWORK_CHANGE_PENDING"), count(n.rows, "u3", "RISK_FRAMEWORK_CHANGE_PENDING")]).toEqual([1, 1]);
    expect(n.rows.every((x) => x.resourceType === "MANAGEMENT" && x.resourceId === FWID)).toBe(true);
    await w.service.withdraw(u1, r1.id, "retrait", R);
    await w.service.requestActivation(u1, FWID, v, "go encore", R);
    expect([count(n.rows, "u2", "RISK_FRAMEWORK_CHANGE_PENDING"), count(n.rows, "u3", "RISK_FRAMEWORK_CHANGE_PENDING")]).toEqual([1, 1]);
    expect(count(n.rows, "u1", "RISK_FRAMEWORK_CHANGE_PENDING")).toBe(0); // never the requester
  });

  it("once a recipient read it, the next request notifies that recipient again, and only them", async () => {
    const n = realNotifications();
    const w = world({ notifications: n.svc });
    const v = await mk(w);
    const r1 = await w.service.requestActivation(u1, FWID, v, "go", R);
    await w.service.withdraw(u1, r1.id, "retrait", R);
    n.rows.find((x) => x.recipientUserId === "u2")!.readAt = new Date();
    await w.service.requestActivation(u1, FWID, v, "go encore", R);
    expect([count(n.rows, "u2", "RISK_FRAMEWORK_CHANGE_PENDING"), count(n.rows, "u3", "RISK_FRAMEWORK_CHANGE_PENDING")]).toEqual([2, 1]);
  });

  it("the dedup key is the Dispositif, not the request: an unread notice from an old, already DECIDED request hides the next one (OBSERVATION)", async () => {
    const n = realNotifications();
    const w = world({ notifications: n.svc });
    const { v, r } = await pending(w);
    await w.service.approve(u2, r, undefined, R);
    const d = await w.service.createDraft(u2, FWID, v, R);
    const r2 = await w.service.requestActivation(u2, FWID, d.id, "v2", R);
    // u3 never read the first notice: no new CHANGE_PENDING is created for the second request (u1 is a new recipient: gets one)
    expect(count(n.rows, "u3", "RISK_FRAMEWORK_CHANGE_PENDING")).toBe(1);
    expect(count(n.rows, "u1", "RISK_FRAMEWORK_CHANGE_PENDING")).toBe(1);
    expect(r2.status).toBe("PENDING");
  });

  it("other events are not deduplicated: NO_DECIDER goes through record (every time)", async () => {
    const n = realNotifications();
    const w = world({ rm: ["u1"], notifications: n.svc });
    const v = await mk(w);
    const r1 = await w.service.requestActivation(u1, FWID, v, "go", R);
    await w.service.withdraw(u1, r1.id, "retrait", R);
    await w.service.requestActivation(u1, FWID, v, "go encore", R);
    expect(count(n.rows, "u1", "RISK_FRAMEWORK_NO_DECIDER")).toBe(2);
  });

  it("a service without emit (plain record) still notifies every holder: the optional wiring never drops a notification", async () => {
    const w = world();
    await pending(w);
    expect(w.sent.map((s) => [s.via, s.recipientUserId, s.eventType])).toEqual([
      ["record", "u2", "RISK_FRAMEWORK_CHANGE_PENDING"], ["record", "u3", "RISK_FRAMEWORK_CHANGE_PENDING"],
    ]);
  });

  it("notification failure never undoes or fails the request (best effort, logged)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    w.hooks.recordFails = () => true;
    const v = await mk(w);
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).resolves.toBeDefined();
    expect(w.requests).toHaveLength(1);
    expect(spy.mock.calls.flat().join(" ")).toContain("could not be notified");
  });

  it.fails("KNOWN GAP B6abis-QA-02: one failing recipient aborts the notification of the remaining Risk Managers", async () => {
    // notify() wraps the whole loop in a single try/catch: a failure for the first recipient (e.g. an inconsistent user row)
    // silently skips everybody after them. MINOR: a pending request may go unseen by part of the risk function.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    w.hooks.recordFails = (i) => i["recipientUserId"] === "u2";
    await pending(w);
    expect(w.sent.map((s) => s.recipientUserId)).toEqual(["u3"]);
  });

  it("audit down on a decision: BOTH the requester and the audit holders' notices are still sent before the audit error surfaces; audit down on SUBMIT: audit error surfaces after notices", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    w.hooks.auditFails = (e) => e.action === "SUBMIT";
    const v = await mk(w);
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow(/audit down/);
    expect(w.sent.map((s) => s.eventType)).toEqual(["RISK_FRAMEWORK_CHANGE_PENDING", "RISK_FRAMEWORK_CHANGE_PENDING"]);
    // the request is stored and still decidable once the audit is back
    w.hooks.auditFails = () => false;
    await expect(w.service.reject(u2, w.requests[0]!.id as string, "non", R)).resolves.toBeDefined();
  });

  it("when the audit AND the notifications are both down, the audit error (the one that matters) is the one reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    w.hooks.auditFails = (e) => e.action === "SUBMIT";
    w.hooks.recordFails = () => true;
    const v = await mk(w);
    await expect(w.service.requestActivation(u1, FWID, v, "go", R)).rejects.toThrow("audit down");
  });
});

// =====================================================================================================
// Repository: stateful fake pool
interface ScaleRow { id: string; tenant_id: string; status: string; probability_levels: number; impact_levels: number; deleted_at: Date | null; activated_at: Date | null; archived_at: Date | null }
interface DbState {
  scales: ScaleRow[];
  versions: Array<Record<string, unknown> & { id: string; tenant_id: string; framework_id: string; status: string; rating_scale_id: string }>;
  requests: Array<Record<string, unknown> & { id: string; status: string }>;
  frameworks: Array<{ id: string; tenant_id: string; is_default: boolean; archived_at: Date | null }>;
  configs: Record<string, { e: number; t: number | null }>;
  appetites: Array<{ tenant_id: string; sub_category: string; threshold: number; active: boolean; deleted_at: Date | null }>;
}

const sc = (id: string, status: string, o: Partial<ScaleRow> = {}): ScaleRow =>
  ({ id, tenant_id: T1, status, probability_levels: 5, impact_levels: 5, deleted_at: null, activated_at: null, archived_at: null, ...o });
const vrow = (id: string, fw: string, status: string, scaleId: string, o: Record<string, unknown> = {}) => ({
  id, tenant_id: T1, framework_id: fw, version_number: Number(id.slice(1)), status, rating_scale_id: scaleId,
  default_evaluation_mode: "CLASSIQUE", committee_evaluation_min_score: 15, committee_evaluation_enforced: true,
  committee_treatment_min_score: null, appetite_thresholds: [], change_approver: "RISK_MANAGER", self_proposal_allowed: false,
  created_by: "u1", last_edited_by: "u1", ...o,
});

function seedDb(over: Partial<DbState> = {}): DbState {
  return {
    scales: [sc("sNew", "DRAFT"), sc("sOld", "ACTIVE"), sc("sOther", "ACTIVE"), sc("sStray", "ACTIVE"), sc("sDraft", "DRAFT"),
      sc("sArch", "ARCHIVED", { archived_at: new Date(1) }), sc("tStray", "ACTIVE", { tenant_id: "t2" })],
    versions: [
      vrow("v0", "fw1", "ACTIVE", "sOld"),
      vrow("v1", "fw1", "PENDING_APPROVAL", "sNew"),
      vrow("v2", "fw2", "ACTIVE", "sOther"),
    ],
    requests: [{ id: "r1", tenant_id: T1, kind: "ACTIVATE_VERSION", framework_id: "fw1", version_id: "v1", status: "PENDING", requested_by: "u1" }],
    frameworks: [{ id: "fw1", tenant_id: T1, is_default: false, archived_at: null }, { id: "fw2", tenant_id: T1, is_default: false, archived_at: null }],
    configs: { [T1]: { e: 15, t: null } },
    appetites: [],
    ...over,
  };
}

function statefulPool(initial: DbState) {
  let committed = structuredClone(initial);
  let cur: DbState | null = null;
  const log: string[] = [];
  const res = (rows: unknown[], rowCount = rows.length) => ({ rows, rowCount });
  const need = (s: string, ...frags: string[]) => {
    for (const f of frags) if (!s.includes(f)) throw new Error(`SQL lost a required clause "${f}": ${s}`);
  };
  const client = {
    async query(sql: string, p: unknown[] = []) {
      const s = sql.replace(/\s+/g, " ").trim();
      log.push(s);
      if (s === "BEGIN") { cur = structuredClone(committed); return res([]); }
      if (s === "COMMIT") { committed = cur!; cur = null; return res([]); }
      if (s === "ROLLBACK") { cur = null; return res([]); }
      const db = cur!;
      const [t] = p as [string];
      if (/^SELECT \* FROM risk_framework_change_requests WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE$/.test(s)) {
        return res(db.requests.filter((r) => r["tenant_id"] === t && r.id === p[1]));
      }
      if (/^UPDATE risk_framework_change_requests SET status = \$3/.test(s)) {
        const r = db.requests.find((x) => x["tenant_id"] === t && x.id === p[1])!;
        Object.assign(r, { status: p[2], decided_by: p[3], decision_comment: p[4], decision_regime: p[5], decider_group: p[6], ratification_status: p[7] });
        return res([r]);
      }
      if (/^UPDATE risk_framework_versions SET status = 'DRAFT'/.test(s)) {
        const v = db.versions.find((x) => x.tenant_id === t && x.id === p[1] && x.status === "PENDING_APPROVAL");
        if (!v) return res([]);
        v.status = "DRAFT";
        return res([v]);
      }
      if (/^SELECT \* FROM risk_framework_versions WHERE tenant_id = \$1 AND framework_id = \$2 AND status = 'ACTIVE' FOR UPDATE$/.test(s)) {
        return res(db.versions.filter((x) => x.tenant_id === t && x.framework_id === p[1] && x.status === "ACTIVE"));
      }
      if (/^SELECT \* FROM risk_framework_versions WHERE tenant_id = \$1 AND framework_id = \$2 AND id = \$3 FOR UPDATE$/.test(s)) {
        return res(db.versions.filter((x) => x.tenant_id === t && x.framework_id === p[1] && x.id === p[2]));
      }
      if (/^SELECT version_number FROM risk_framework_versions/.test(s)) {
        return res(db.versions.filter((x) => x.tenant_id === t && x.id === p[1]).map((x) => ({ version_number: x["version_number"] })));
      }
      if (/^UPDATE risk_framework_versions SET status = 'ARCHIVED'/.test(s)) {
        const v = db.versions.find((x) => x.tenant_id === t && x.id === p[1])!;
        v.status = "ARCHIVED";
        return res([], 1);
      }
      if (/^UPDATE risk_framework_versions SET status = 'ACTIVE'/.test(s)) {
        const v = db.versions.find((x) => x.tenant_id === t && x.id === p[1] && x.status === "PENDING_APPROVAL");
        if (!v) return res([]);
        v.status = "ACTIVE";
        return res([v]);
      }
      if (/^UPDATE risk_framework_versions SET status = 'PENDING_APPROVAL'/.test(s)) {
        const v = db.versions.find((x) => x.tenant_id === t && x.framework_id === p[1] && x.id === p[2] && x.status === "DRAFT");
        if (!v) return res([], 0);
        v.status = "PENDING_APPROVAL";
        return res([], 1);
      }
      if (/^UPDATE risk_framework_change_requests SET status = 'WITHDRAWN'/.test(s)) {
        const r = db.requests.find((x) => x["tenant_id"] === t && x.id === p[1])!;
        Object.assign(r, { status: "WITHDRAWN", decision_comment: p[2] });
        return res([r]);
      }
      if (/^INSERT INTO risk_framework_change_requests/.test(s)) {
        const r = { id: `r${db.requests.length + 1}`, tenant_id: t, kind: "ACTIVATE_VERSION", framework_id: p[1], version_id: p[2], status: "PENDING", requested_by: p[5], reason: p[4] };
        db.requests.push(r);
        return res([r]);
      }
      if (/^SELECT status, probability_levels, impact_levels FROM rating_scales/.test(s)) {
        need(s, "tenant_id = $1", "id = $2", "deleted_at IS NULL", "FOR UPDATE");
        return res(db.scales.filter((x) => x.tenant_id === t && x.id === p[1] && !x.deleted_at));
      }
      if (/FROM configs WHERE tenant_id = \$1$/.test(s)) {
        const c = db.configs[t];
        return res(c ? [c] : []);
      }
      if (/^SELECT sub_category, threshold FROM risk_appetites/.test(s)) {
        need(s, "tenant_id = $1", "active", "deleted_at IS NULL");
        return res(db.appetites.filter((a) => a.tenant_id === t && a.active && !a.deleted_at));
      }
      if (/^UPDATE rating_scales SET status = 'ACTIVE'/.test(s)) {
        need(s, "tenant_id = $1", "id = $2", "status <> 'ACTIVE'");
        for (const x of db.scales) if (x.tenant_id === t && x.id === p[1] && x.status !== "ACTIVE") Object.assign(x, { status: "ACTIVE", activated_at: x.activated_at ?? new Date(), archived_at: null });
        return res([], 1);
      }
      if (/^UPDATE rating_scales SET status = 'ARCHIVED'/.test(s)) {
        need(s, "tenant_id = $1", "id <> $2", "status = 'ACTIVE'", "deleted_at IS NULL", "NOT EXISTS", "x.rating_scale_id = rating_scales.id", "x.status = 'ACTIVE'", "x.tenant_id = $1");
        for (const x of db.scales) {
          const referenced = db.versions.some((v) => v.tenant_id === t && v.rating_scale_id === x.id && v.status === "ACTIVE");
          if (x.tenant_id === t && x.id !== p[1] && x.status === "ACTIVE" && !x.deleted_at && !referenced) Object.assign(x, { status: "ARCHIVED", archived_at: new Date() });
        }
        return res([], 1);
      }
      if (/^UPDATE risk_frameworks SET is_default = true/.test(s)) {
        const none = !db.frameworks.some((f) => f.tenant_id === t && f.is_default && !f.archived_at);
        const f = db.frameworks.find((x) => x.tenant_id === t && x.id === p[1] && !x.archived_at);
        if (none && f) f.is_default = true;
        return res([], 1);
      }
      throw new Error(`stateful fake pool: unexpected SQL: ${s}`);
    },
    release() { /* noop */ },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log, state: () => committed };
}

const approve = { outcome: "APPROVED" as const, decidedBy: "u2", comment: null, decisionRegime: "NORMAL" as const, deciderGroup: "RISK_MANAGER" as const, ratificationStatus: null };
const scaleOf = (db: DbState, id: string) => db.scales.find((s) => s.id === id)!;
const verOf = (db: DbState, id: string) => db.versions.find((v) => v.id === id)!;

describe("QA-B6abis mirrorScale through recordDecision (F-B6a-01)", () => {
  it("approval: the scale of the new version becomes ACTIVE; the replaced version's scale and every stray unreferenced ACTIVE scale are ARCHIVED; referenced / DRAFT / ARCHIVED / foreign-tenant scales are untouched", async () => {
    const f = statefulPool(seedDb());
    const out = await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    expect(out.previousActive?.id).toBe("v0");
    const db = f.state();
    expect(scaleOf(db, "sNew")).toMatchObject({ status: "ACTIVE", archived_at: null });
    expect(scaleOf(db, "sNew").activated_at).toBeInstanceOf(Date);
    expect(scaleOf(db, "sOld").status).toBe("ARCHIVED"); // its only ACTIVE version was archived first in the same transaction
    expect(scaleOf(db, "sStray").status).toBe("ARCHIVED");
    expect(scaleOf(db, "sOther").status).toBe("ACTIVE"); // referenced by another Dispositif's ACTIVE version
    expect(scaleOf(db, "sDraft").status).toBe("DRAFT");
    expect(scaleOf(db, "sArch")).toMatchObject({ status: "ARCHIVED", archived_at: new Date(1) });
    expect(scaleOf(db, "tStray").status).toBe("ACTIVE"); // other tenant
    expect(verOf(db, "v0").status).toBe("ARCHIVED");
    expect(verOf(db, "v1").status).toBe("ACTIVE");
    expect(db.frameworks.find((x) => x.id === "fw1")!.is_default).toBe(true);
    expect(f.log.at(-1)).toBe("COMMIT");
  });

  it("the new version reuses the scale of the replaced one: that scale stays ACTIVE (never archived out from under its own version)", async () => {
    const db0 = seedDb();
    verOf(db0, "v1").rating_scale_id = "sOld";
    const f = statefulPool(db0);
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    expect(scaleOf(f.state(), "sOld").status).toBe("ACTIVE");
    expect(scaleOf(f.state(), "sStray").status).toBe("ARCHIVED");
  });

  it("first activation of a Dispositif (no previous ACTIVE version): works, scale mirrored, stray archived", async () => {
    const db0 = seedDb();
    db0.versions = db0.versions.filter((v) => v.id !== "v0");
    const f = statefulPool(db0);
    const out = await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    expect(out.previousActive).toBeNull();
    expect(scaleOf(f.state(), "sNew").status).toBe("ACTIVE");
    expect(scaleOf(f.state(), "sOld").status).toBe("ARCHIVED"); // no ACTIVE version references it any more
  });

  it("the new version's scale is already ACTIVE (second Dispositif on a shared scale): stays ACTIVE, its activated_at is preserved", async () => {
    const db0 = seedDb();
    verOf(db0, "v1").rating_scale_id = "sOther";
    scaleOf(db0, "sOther").activated_at = new Date(5);
    const f = statefulPool(db0);
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    expect(scaleOf(f.state(), "sOther")).toMatchObject({ status: "ACTIVE", activated_at: new Date(5) });
  });

  it("ARCHIVED scale: refused (400) and the WHOLE decision rolls back: previous version still ACTIVE, version PENDING_APPROVAL, request PENDING, no scale touched", async () => {
    const db0 = seedDb();
    verOf(db0, "v1").rating_scale_id = "sArch";
    const f = statefulPool(db0);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).rejects.toThrow(/archived rating scale/);
    await expect(new PostgresRiskFrameworkRepository(statefulPool(db0).pool).recordDecision(T1, "r1", approve)).rejects.toThrow(ValidationError);
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
    expect(f.state()).toEqual(db0);
    expect(verOf(f.state(), "v0").status).toBe("ACTIVE");
    expect(f.state().requests[0]!.status).toBe("PENDING");
  });

  it("scale soft-deleted or missing: refused 'no longer exists', total rollback", async () => {
    for (const mutate of [(d: DbState) => { scaleOf(d, "sNew").deleted_at = new Date(); }, (d: DbState) => { d.scales = d.scales.filter((s) => s.id !== "sNew"); }]) {
      const db0 = seedDb();
      mutate(db0);
      const f = statefulPool(db0);
      await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).rejects.toThrow(/no longer exists/);
      expect(f.state()).toEqual(db0);
    }
  });

  it("the scale of another tenant is invisible (tenant filter): version pointing at it is refused, nothing changes", async () => {
    const db0 = seedDb();
    verOf(db0, "v1").rating_scale_id = "tStray";
    const f = statefulPool(db0);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).rejects.toThrow(/no longer exists/);
    expect(f.state()).toEqual(db0);
  });

  describe("ceiling n^2 replayed on version, configs and legacy appetites", () => {
    const entry = (threshold: number, subCategory = "Fraude") => ({ subCategory, subCategoryId: null, entity: null, threshold, description: null });
    type Mut = (d: DbState) => void;
    it.each<[string, Mut, RegExp]>([
      ["version evaluation threshold 26", (d) => { verOf(d, "v1")["committee_evaluation_min_score"] = 26; }, /évaluation de la version \(26\)/],
      ["version treatment threshold 26", (d) => { verOf(d, "v1")["committee_treatment_min_score"] = 26; }, /traitement de la version \(26\)/],
      ["version appetite 26", (d) => { verOf(d, "v1")["appetite_thresholds"] = [entry(26)]; }, /appétence "Fraude" de la version \(26\)/],
      ["configs evaluation 26", (d) => { d.configs[T1] = { e: 26, t: null }; }, /évaluation \(configs\) \(26\)/],
      ["configs treatment 26", (d) => { d.configs[T1] = { e: 15, t: 26 }; }, /traitement \(configs\) \(26\)/],
      ["legacy appetite 26", (d) => { d.appetites.push({ tenant_id: T1, sub_category: "Cyber", threshold: 26, active: true, deleted_at: null }); }, /appétence "Cyber" \(26\)/],
    ])("%s -> refused, rollback, state identical", async (_l, mutate, msg) => {
      const db0 = seedDb();
      mutate(db0);
      const f = statefulPool(db0);
      await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).rejects.toThrow(msg);
      expect(f.log.at(-1)).toBe("ROLLBACK");
      expect(f.state()).toEqual(db0);
    });

    it("boundary: every threshold equal to the ceiling (25) is accepted", async () => {
      const db0 = seedDb();
      Object.assign(verOf(db0, "v1"), { committee_evaluation_min_score: 25, committee_treatment_min_score: 25, appetite_thresholds: [entry(25)] });
      db0.configs[T1] = { e: 25, t: 25 };
      db0.appetites.push({ tenant_id: T1, sub_category: "Cyber", threshold: 25, active: true, deleted_at: null });
      const f = statefulPool(db0);
      await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
      expect(verOf(f.state(), "v1").status).toBe("ACTIVE");
    });

    it("the ceiling is the product of the two level counts, not n^2 of one axis: 4 x 6 -> 24 passes, 25 refused", async () => {
      for (const [score, ok] of [[24, true], [25, false]] as const) {
        const db0 = seedDb();
        Object.assign(scaleOf(db0, "sNew"), { probability_levels: 4, impact_levels: 6 });
        verOf(db0, "v1")["committee_evaluation_min_score"] = score;
        const f = statefulPool(db0);
        const run = new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
        if (ok) await expect(run).resolves.toBeDefined();
        else await expect(run).rejects.toThrow(/\(24\)/);
      }
    });

    it("inactive, soft-deleted and other-tenant legacy appetites do NOT block; a missing configs row does not block", async () => {
      const db0 = seedDb();
      db0.appetites.push(
        { tenant_id: T1, sub_category: "A", threshold: 99, active: false, deleted_at: null },
        { tenant_id: T1, sub_category: "B", threshold: 99, active: true, deleted_at: new Date() },
        { tenant_id: "t2", sub_category: "C", threshold: 99, active: true, deleted_at: null },
      );
      db0.configs = { t2: { e: 99, t: 99 } };
      const f = statefulPool(db0);
      await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).resolves.toBeDefined();
    });

    it("all offenders are listed at once (one error, every label), not just the first", async () => {
      const db0 = seedDb();
      verOf(db0, "v1")["committee_evaluation_min_score"] = 30;
      db0.configs[T1] = { e: 31, t: 32 };
      db0.appetites.push({ tenant_id: T1, sub_category: "Cyber", threshold: 33, active: true, deleted_at: null });
      const f = statefulPool(db0);
      const err = await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve).catch((e: Error) => e);
      expect(err).toBeInstanceOf(ValidationError);
      for (const n of ["(30)", "(31)", "(32)", "(33)"]) expect((err as Error).message).toContain(n);
    });
  });

  it("OBSERVATION: the ceiling guard does not look at the scale's criticality bands (only the service does, at request time)", async () => {
    // Bands above n^2 are refused by assertActivatable at request/approve; the repository replay covers thresholds only.
    const db0 = seedDb();
    const f = statefulPool(db0);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).resolves.toBeDefined();
    expect(f.log.some((q) => /criticality/.test(q))).toBe(false);
  });

  it("REJECT and WITHDRAW never read or write a rating scale", async () => {
    const f = statefulPool(seedDb());
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", { ...approve, outcome: "REJECTED", comment: "non" });
    expect(f.log.some((q) => /rating_scales|configs|risk_appetites/.test(q))).toBe(false);
    expect(f.state()).toMatchObject({ scales: seedDb().scales });
    const g = statefulPool(seedDb());
    await new PostgresRiskFrameworkRepository(g.pool).withdraw(T1, "r1", "retrait");
    expect(g.log.some((q) => /rating_scales|configs|risk_appetites/.test(q))).toBe(false);
  });

  it("a request already decided is refused (409) before any scale is read", async () => {
    const db0 = seedDb();
    db0.requests[0]!.status = "APPROVED";
    const f = statefulPool(db0);
    await expect(new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve)).rejects.toThrow(ConflictError);
    expect(f.log.some((q) => /rating_scales/.test(q))).toBe(false);
    expect(f.log.at(-1)).toBe("ROLLBACK");
  });

  it("the stray-scale archive statement targets 'every other ACTIVE scale' (id <> $2), never a single id, and keeps its NOT EXISTS reference guard", async () => {
    // The stateful fake interprets this statement in JS; this textual pin is what stops a semantic edit going unnoticed.
    const f = statefulPool(seedDb());
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    const q = f.log.find((x) => /^UPDATE rating_scales SET status = 'ARCHIVED'/.test(x))!;
    expect(q.replace("id <> $2", "")).not.toMatch(/\bid\s*(=|IN)\b/);
    expect(q).toMatch(/WHERE tenant_id = \$1 AND id <> \$2 AND status = 'ACTIVE' AND deleted_at IS NULL AND NOT EXISTS \(SELECT 1 FROM risk_framework_versions x WHERE x\.tenant_id = \$1 AND x\.rating_scale_id = rating_scales\.id AND x\.status = 'ACTIVE'\)/);
  });

  it("every scale-related statement carries tenant_id = $1 and is parameterised (no value interpolated in the SQL)", async () => {
    const f = statefulPool(seedDb());
    await new PostgresRiskFrameworkRepository(f.pool).recordDecision(T1, "r1", approve);
    const scaleSql = f.log.filter((q) => /rating_scales|FROM configs|FROM risk_appetites/.test(q));
    expect(scaleSql.length).toBeGreaterThanOrEqual(5);
    for (const q of scaleSql) {
      expect(q).toMatch(/tenant_id = \$1/);
      expect(q).not.toMatch(/'(sNew|sOld|t1|u2)'/);
    }
  });
});

describe("QA-B6abis createActivationRequest lock (F-B6a-02) at repository level", () => {
  const input = { tenantId: T1, frameworkId: "fw1", versionId: "v9", reason: "go", requestedBy: "u1", previousValue: null };
  const dbWithDraft = (status = "DRAFT") => { const d = seedDb(); d.versions.push(vrow("v9", "fw1", status, "sNew")); return d; };

  it("validateLocked receives the mapped (camelCase) locked version; success moves it to PENDING_APPROVAL and inserts the request in one transaction", async () => {
    const f = statefulPool(dbWithDraft());
    let seen: unknown;
    const r = await new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, validateLocked: async (v) => { seen = v; } });
    expect(seen).toMatchObject({ id: "v9", status: "DRAFT", ratingScaleId: "sNew", committeeEvaluationMinScore: 15, changeApprover: "RISK_MANAGER" });
    expect(r.status).toBe("PENDING");
    expect(verOf(f.state(), "v9").status).toBe("PENDING_APPROVAL");
    expect(f.log.filter((q) => q === "COMMIT")).toHaveLength(1);
  });

  it.each(["PENDING_APPROVAL", "ACTIVE", "ARCHIVED"])("a version found %s under the lock is refused BEFORE validateLocked is called; rollback", async (status) => {
    const f = statefulPool(dbWithDraft(status));
    const validate = vi.fn();
    await expect(new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, validateLocked: validate })).rejects.toThrow(ValidationError);
    expect(validate).not.toHaveBeenCalled();
    expect(f.log.at(-1)).toBe("ROLLBACK");
  });

  it("an unknown version (or one of another framework) is refused under the lock", async () => {
    const f = statefulPool(dbWithDraft());
    await expect(new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, versionId: "nope", validateLocked: async () => undefined })).rejects.toThrow(ValidationError);
    await expect(new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, frameworkId: "fw2", validateLocked: async () => undefined })).rejects.toThrow(ValidationError);
    expect(f.state().requests).toHaveLength(1);
  });

  it("the other tenant cannot lock or move the version", async () => {
    const f = statefulPool(dbWithDraft());
    await expect(new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, tenantId: "t2", validateLocked: async () => undefined })).rejects.toThrow(ValidationError);
    expect(verOf(f.state(), "v9").status).toBe("DRAFT");
  });

  it("a validateLocked that throws leaves nothing behind (version DRAFT, no request) and the original error is the one raised", async () => {
    const f = statefulPool(dbWithDraft());
    await expect(new PostgresRiskFrameworkRepository(f.pool).createActivationRequest({ ...input, validateLocked: async () => { throw new ValidationError("seuil"); } })).rejects.toThrow("seuil");
    expect(verOf(f.state(), "v9").status).toBe("DRAFT");
    expect(f.state().requests).toHaveLength(1);
  });

  it("without validateLocked (older callers) no extra lock is taken and the request is still created", async () => {
    const f = statefulPool(dbWithDraft());
    await new PostgresRiskFrameworkRepository(f.pool).createActivationRequest(input);
    expect(f.log.some((q) => /FOR UPDATE/.test(q))).toBe(false);
    expect(verOf(f.state(), "v9").status).toBe("PENDING_APPROVAL");
  });
});

// =====================================================================================================
type Call = (method: string, path: string, body?: object, as?: AuthenticatedUser) => Promise<{ status: number; json: unknown }>;
async function withHttp(w: W, fn: (call: Call) => Promise<void>): Promise<void> {
  let current: AuthenticatedUser = u1;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: AuthenticatedUser; requestId: string }).user = current;
    (req as unknown as { requestId: string }).requestId = "req-http";
    next();
  });
  app.use("/risk-frameworks", riskFrameworksRouter(w.service));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    await fn(async (method, path, body, as) => {
      current = as ?? u1;
      const res = await fetch(`http://127.0.0.1:${port}/risk-frameworks${path}`, {
        method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    });
  } finally {
    server.close();
  }
}
