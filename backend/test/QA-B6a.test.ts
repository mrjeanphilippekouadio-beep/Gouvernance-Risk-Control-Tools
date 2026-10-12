import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { FIXED_GROUP_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type {
  DecisionResult,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
} from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for B-6a (commit 0a465fa). Oracles come from docs/architecture/RM-V1-B6-Dispositif-spec.md.
// The repository fake below is tenant-aware and mimics the PostgreSQL guards the service relies on
// (FOR UPDATE + PENDING check, open-version unique index, DRAFT-only updates). PostgreSQL itself is NOT exercised.
// A QA PASS here is not a Security, Privacy or Compliance verdict.

const T1 = "t1";
const T2 = "t2";
const S1 = "00000000-0000-4000-8000-0000000000a1";
const S2 = "00000000-0000-4000-8000-0000000000b1";
const FW: Permission[] = [
  "riskframework.read", "riskframework.create", "riskframework.update",
  "riskframework.activate", "riskframework.archive", "riskframework.process.assign",
];
const actor = (userId: string, tenantId = T1, perms: Permission[] = FW): AuthenticatedUser =>
  ({ userId, tenantId, email: `${userId}@x`, displayName: userId, roles: perms }) as AuthenticatedUser;
const u1 = actor("u1");
const u2 = actor("u2");
const u3 = actor("u3");
const R = "req-1";

const level = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
function scale(id: string, tenantId: string, n = 5, over: Partial<RatingScale> = {}): RatingScale {
  return {
    id, tenantId, name: id, version: "1", status: "ACTIVE",
    probabilityLevels: n, probabilityLabels: level(n), impactLevels: n, impactLabels: level(n),
    criticalityThresholds: null,
    impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: level(n) }], retainedImpactRule: "MAX" },
    velocityLevels: null, persistenceLevels: null, masteryScale: null,
    activatedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    deletedAt: null, deletedBy: null, deletionReason: null, ...over,
  };
}
const role = (tenantId: string, systemGroup: SystemGroup): Role => ({
  id: `${tenantId}-${systemGroup}`, tenantId, name: systemGroup, description: null, permissions: [], dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});

interface Opts { rm?: string[]; audit?: string[]; committee?: string[]; suspended?: string[]; categories?: string[] }
type Ev = { tenantId: string; userId: string; entityType: string; entityId: string; action: string; oldValue: unknown; newValue: unknown; reason: string | null; requestId: string };

function world(o: Opts = {}) {
  const groups: Record<string, Record<SystemGroup, string[]>> = {
    [T1]: { RISK_MANAGER: o.rm ?? ["u1", "u2"], AUDIT: o.audit ?? [], RISK_COMMITTEE: o.committee ?? [] },
    [T2]: { RISK_MANAGER: ["v1", "v2"], AUDIT: [], RISK_COMMITTEE: [] },
  };
  const roles = [T1, T2].flatMap((t) => (["RISK_MANAGER", "AUDIT", "RISK_COMMITTEE"] as const).map((g) => role(t, g)));
  const scales = [scale(S1, T1), scale(S2, T2)];
  const frameworks: RiskFramework[] = [];
  const versions: RiskFrameworkVersion[] = [];
  const requests: RiskFrameworkChangeRequest[] = [];
  const calls = { decisions: 0, draftFields: [] as string[][] };
  const tick = () => Promise.resolve();

  const repo = {
    async listFrameworks(t: string) { return frameworks.filter((f) => f.tenantId === t); },
    async getFramework(t: string, id: string) { return frameworks.find((f) => f.tenantId === t && f.id === id) ?? null; },
    async listVersions(t: string, fw: string) { return versions.filter((v) => v.tenantId === t && v.frameworkId === fw); },
    async getVersion(t: string, fw: string, id: string) { return versions.find((v) => v.tenantId === t && v.frameworkId === fw && v.id === id) ?? null; },
    async getActiveVersion(t: string, fw: string) { return versions.find((v) => v.tenantId === t && v.frameworkId === fw && v.status === "ACTIVE") ?? null; },
    async createWithDraft(i: { tenantId: string; name: string; description: string | null; createdBy: string; params: object }) {
      await tick();
      if (frameworks.some((f) => f.tenantId === i.tenantId && !f.archivedAt && f.name.toLowerCase() === i.name.toLowerCase())) {
        throw new ConflictError("Un Dispositif porte déjà ce nom");
      }
      const framework = { id: randomUUID(), tenantId: i.tenantId, name: i.name, description: i.description, isDefault: false, createdBy: i.createdBy,
        createdAt: new Date(), updatedAt: new Date(), archivedAt: null, archivedBy: null, archiveReason: null } as RiskFramework;
      frameworks.push(framework);
      const version = { id: randomUUID(), tenantId: i.tenantId, frameworkId: framework.id, versionNumber: 1, status: "DRAFT", ...i.params,
        createdBy: i.createdBy, lastEditedBy: i.createdBy, createdAt: new Date(), updatedAt: new Date(), activatedAt: null,
        activationRequestId: null, archivedAt: null, archivedBy: null, archiveReason: null } as RiskFrameworkVersion;
      versions.push(version);
      return { framework, version };
    },
    async updateIdentity(t: string, id: string, f: object) {
      const fw = frameworks.find((x) => x.tenantId === t && x.id === id);
      if (!fw) throw new NotFoundError("RiskFramework", id);
      const next = { ...fw, ...f };
      frameworks[frameworks.indexOf(fw)] = next;
      return next;
    },
    async createDraftFrom(t: string, fw: string, src: string, by: string) {
      await tick();
      if (versions.some((v) => v.tenantId === t && v.frameworkId === fw && (v.status === "DRAFT" || v.status === "PENDING_APPROVAL"))) {
        throw new ConflictError("Ce Dispositif a déjà une version en brouillon ou en attente d'approbation");
      }
      const s = versions.find((v) => v.tenantId === t && v.id === src)!;
      const v = { ...s, id: randomUUID(), versionNumber: Math.max(...versions.filter((x) => x.frameworkId === fw).map((x) => x.versionNumber)) + 1,
        status: "DRAFT", createdBy: by, lastEditedBy: by, activatedAt: null, activationRequestId: null } as RiskFrameworkVersion;
      versions.push(v);
      return v;
    },
    async updateDraft(t: string, fw: string, id: string, fields: object, by: string) {
      calls.draftFields.push(Object.keys(fields));
      const v = versions.find((x) => x.tenantId === t && x.frameworkId === fw && x.id === id);
      if (!v || v.status !== "DRAFT") throw new ValidationError("Only a draft version can be modified");
      Object.assign(v, Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)), { lastEditedBy: by });
      return v;
    },
    async discardDraft(t: string, fw: string, id: string, by: string, reason: string) {
      const v = versions.find((x) => x.tenantId === t && x.frameworkId === fw && x.id === id);
      if (!v || v.status !== "DRAFT") throw new ValidationError("Only a draft version can be discarded");
      Object.assign(v, { status: "ARCHIVED", archivedBy: by, archiveReason: reason, archivedAt: new Date() });
      return v;
    },
    async createActivationRequest(i: { tenantId: string; frameworkId: string; versionId: string; reason: string; requestedBy: string; previousValue: unknown }) {
      await tick();
      const v = versions.find((x) => x.tenantId === i.tenantId && x.frameworkId === i.frameworkId && x.id === i.versionId);
      if (!v || v.status !== "DRAFT") throw new ValidationError("Only a draft version can be submitted for activation");
      v.status = "PENDING_APPROVAL";
      const r = { id: randomUUID(), tenantId: i.tenantId, kind: "ACTIVATE_VERSION", frameworkId: i.frameworkId, versionId: i.versionId, processId: null,
        previousValue: i.previousValue, reason: i.reason, status: "PENDING", requestedBy: i.requestedBy, createdAt: new Date(),
        decidedBy: null, decidedAt: null, decisionComment: null, decisionRegime: null, deciderGroup: null, ratificationStatus: null } as RiskFrameworkChangeRequest;
      requests.push(r);
      return r;
    },
    async getRequest(t: string, id: string) { return requests.find((r) => r.tenantId === t && r.id === id) ?? null; },
    async listRequests(t: string, f?: { status?: string }) { return requests.filter((r) => r.tenantId === t && (!f?.status || r.status === f.status)); },
    // check-and-set without an await in between = the row lock of the real repository
    async recordDecision(t: string, id: string, d: RecordDecisionInput): Promise<DecisionResult> {
      await tick();
      const r = requests.find((x) => x.tenantId === t && x.id === id);
      if (!r) throw new NotFoundError("RiskFrameworkChangeRequest", id);
      if (r.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${r.status})`);
      const v = versions.find((x) => x.id === r.versionId)!;
      if (v.status !== "PENDING_APPROVAL") throw new ConflictError("La version n'est plus en attente d'approbation");
      calls.decisions++;
      Object.assign(r, { status: d.outcome, decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: d.decisionRegime, deciderGroup: d.deciderGroup, ratificationStatus: d.ratificationStatus, decidedAt: new Date() });
      let previousActive: RiskFrameworkVersion | null = null;
      if (d.outcome === "APPROVED") {
        const prev = versions.find((x) => x.frameworkId === v.frameworkId && x.status === "ACTIVE");
        if (prev) { previousActive = { ...prev }; prev.status = "ARCHIVED"; }
        v.status = "ACTIVE";
        v.activatedAt = new Date();
        const fw = frameworks.find((f) => f.id === v.frameworkId)!;
        if (!frameworks.some((f) => f.tenantId === t && f.isDefault)) fw.isDefault = true;
      } else {
        v.status = "DRAFT";
      }
      return { request: r, version: v, previousActive };
    },
    async withdraw(t: string, id: string, comment: string | null): Promise<DecisionResult> {
      await tick();
      const r = requests.find((x) => x.tenantId === t && x.id === id);
      if (!r) throw new NotFoundError("RiskFrameworkChangeRequest", id);
      if (r.status !== "PENDING") throw new ConflictError(`Cette demande est déjà traitée (${r.status})`);
      Object.assign(r, { status: "WITHDRAWN", decisionComment: comment, decidedAt: new Date() });
      const v = versions.find((x) => x.id === r.versionId)!;
      v.status = "DRAFT";
      return { request: r, version: v, previousActive: null };
    },
  };

  const roleRepo = {
    async list(t: string) { return roles.filter((r) => r.tenantId === t); },
    async listForUser(t: string, u: string) { return roles.filter((r) => r.tenantId === t && groups[t]![r.systemGroup!].includes(u)); },
    async listAssignments(t: string, roleId: string) {
      const r = roles.find((x) => x.id === roleId && x.tenantId === t)!;
      return groups[t]![r.systemGroup!].map((userId) => ({ userId, roleId, revokedAt: null }));
    },
  };
  const users = {
    async getById(_t: string, id: string) { return { id, deletedAt: o.suspended?.includes(id) ? new Date() : null }; },
    async listWithPermission(t: string, permission: string, exclude: string) {
      const ids = permission === "audit.read" ? groups[t]!.AUDIT : permission === "riskframework.activate" ? groups[t]!.RISK_MANAGER : [];
      return ids.filter((i) => i !== exclude).map((id) => ({ id, displayName: id }));
    },
  };
  const events: Ev[] = [];
  const hooks = { auditFails: (_e: Ev) => false, notifyDown: false };
  const audit = {
    async record(e: Ev) { if (hooks.auditFails(e)) throw new Error("audit down"); events.push(e); },
    async listForEntity(t: string, type: string, id: string) { return events.filter((e) => e.tenantId === t && e.entityType === type && e.entityId === id); },
  };
  const sent: Array<{ tenantId: string; recipientUserId: string; eventType: string }> = [];
  const notifications = { async record(i: { tenantId: string; recipientUserId: string; eventType: string }) { if (hooks.notifyDown) throw new Error("notif down"); sent.push(i); } };
  const ratingScales = { async getById(t: string, id: string) { return scales.find((s) => s.tenantId === t && s.id === id) ?? null; } };
  const cats = new Set(o.categories ?? []);
  const categories = { async getById(t: string, id: string) { return cats.has(`${t}:${id}`) ? { id } : null; } };
  const service = new RiskFrameworkService(repo as never, ratingScales as never, roleRepo as never, users as never, audit as never, categories as never, notifications as never);
  const snapshot = (t = T1) => JSON.stringify([frameworks.filter((f) => f.tenantId === t), versions.filter((v) => v.tenantId === t), requests.filter((r) => r.tenantId === t), events.filter((e) => e.tenantId === t).length, sent.length]);
  return { service, frameworks, versions, requests, events, sent, calls, groups, scales, hooks, snapshot };
}
type W = ReturnType<typeof world>;

let n = 0;
async function draft(w: W, params: object = {}, by = u1) {
  const { framework, version } = await w.service.create(by, { name: `D${++n}`, ratingScaleId: S1, params }, R);
  return { fw: framework.id, v: version.id };
}
async function pend(w: W, params: object = {}, by = u1) {
  const { fw, v } = await draft(w, params, by);
  const r = await w.service.requestActivation(by, fw, v, "motif", R);
  return { fw, v, r: r.id };
}
/** A Dispositif with an ACTIVE v1 (requested by u1, approved by u2). */
async function live(w: W, params: object = {}) {
  const p = await pend(w, params);
  await w.service.approve(u2, p.r, undefined, R);
  return p;
}
const verOf = (w: W, id: string) => w.versions.find((v) => v.id === id)!;
const reqOf = (w: W, id: string) => w.requests.find((r) => r.id === id)!;
const evTypes = (w: W) => w.events.map((e) => `${e.entityType}:${e.action}`);

// ---------------------------------------------------------------------------------------------------
describe("QA-B6a maker-checker: who can never decide", () => {
  // requester, createdBy, lastEditedBy and the audit trail are each isolated: the other three are cleared.
  const cases: Array<[string, (w: W, fw: string, v: string) => Promise<void>, string]> = [
    ["the requester", async (w, _fw, v) => { Object.assign(verOf(w, v), { createdBy: null, lastEditedBy: null }); w.events.length = 0; }, "u1"],
    ["the creator (created_by only)", async (w, _fw, v) => { Object.assign(verOf(w, v), { createdBy: "u3", lastEditedBy: null }); w.events.length = 0; }, "u3"],
    ["the last editor (last_edited_by only)", async (w, _fw, v) => { Object.assign(verOf(w, v), { createdBy: null, lastEditedBy: "u3" }); w.events.length = 0; }, "u3"],
    ["an audited editor (UPDATE entry only)", async (w, _fw, v) => { Object.assign(verOf(w, v), { createdBy: null, lastEditedBy: null }); w.events.length = 0; w.events.push({ tenantId: T1, userId: "u3", entityType: "RiskFrameworkVersion", entityId: v, action: "UPDATE", oldValue: null, newValue: null, reason: null, requestId: R }); }, "u3"],
    ["an audited creator (CREATE entry only)", async (w, _fw, v) => { Object.assign(verOf(w, v), { createdBy: null, lastEditedBy: null }); w.events.length = 0; w.events.push({ tenantId: T1, userId: "u3", entityType: "RiskFrameworkVersion", entityId: v, action: "CREATE", oldValue: null, newValue: null, reason: null, requestId: R }); }, "u3"],
  ];
  for (const outcome of ["approve", "reject"] as const) {
    it.each(cases)(`${outcome}: %s is refused, nothing is written`, async (_label, prepare, deciderId) => {
      const w = world({ rm: ["u1", "u2", "u3"] });
      const { fw, v, r } = await pend(w);
      await prepare(w, fw, v);
      const before = w.snapshot();
      const decider = actor(deciderId);
      const call = () => (outcome === "approve" ? w.service.approve(decider, r, "c", R) : w.service.reject(decider, r, "c", R));
      await expect(call()).rejects.toThrow(ForbiddenError);
      expect(w.calls.decisions).toBe(0);
      expect(w.snapshot()).toBe(before);
      // control: a clean third party decides
      await expect(outcome === "approve" ? w.service.approve(u2, r, "c", R) : w.service.reject(u2, r, "c", R)).resolves.toBeDefined();
    });
  }

  it("an editor of the next iteration cannot decide it, even after having rejected the previous one", async () => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { fw, v, r } = await pend(w);
    await w.service.reject(u2, r, "pas prêt", R);
    expect(verOf(w, v).status).toBe("DRAFT");
    await w.service.updateDraft(u2, fw, v, { committeeEvaluationEnforced: false }, R);
    const r2 = await w.service.requestActivation(u1, fw, v, "bis", R);
    await expect(w.service.approve(u2, r2.id, undefined, R)).rejects.toThrow(/contribué/);
    await expect(w.service.approve(u3, r2.id, undefined, R)).resolves.toBeDefined();
  });

  it("administrator holding every right, a Risk Manager without riskframework.activate, and a Risk Manager revoked after the request are refused", async () => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { r } = await pend(w);
    await expect(w.service.approve(actor("admin"), r, undefined, R)).rejects.toThrow(/Risk Manager/);
    await expect(w.service.approve(actor("u2", T1, FW.filter((p) => p !== "riskframework.activate")), r, undefined, R)).rejects.toThrow(ForbiddenError);
    w.groups[T1]!.RISK_MANAGER = w.groups[T1]!.RISK_MANAGER.filter((x) => x !== "u3");
    await expect(w.service.approve(u3, r, undefined, R)).rejects.toThrow(/Risk Manager/);
    expect(w.calls.decisions).toBe(0);
  });

  const gated: Array<[string, (w: W, ids: { fw: string; v: string; r: string }, a: AuthenticatedUser) => Promise<unknown>, Permission]> = [
    ["create", (w, _i, a) => w.service.create(a, { name: "X", ratingScaleId: S1 }, R), "riskframework.create"],
    ["updateIdentity", (w, i, a) => w.service.updateIdentity(a, i.fw, { name: "Y", reason: "r" }, R), "riskframework.update"],
    ["createDraft", (w, i, a) => w.service.createDraft(a, i.fw, i.v, R), "riskframework.update"],
    ["updateDraft", (w, i, a) => w.service.updateDraft(a, i.fw, i.v, { changeApprover: "AUDIT" }, R), "riskframework.update"],
    ["requestActivation", (w, i, a) => w.service.requestActivation(a, i.fw, i.v, "r", R), "riskframework.update"],
    ["withdraw", (w, i, a) => w.service.withdraw(a, i.r, undefined, R), "riskframework.update"],
    ["approve", (w, i, a) => w.service.approve(a, i.r, undefined, R), "riskframework.activate"],
    ["reject", (w, i, a) => w.service.reject(a, i.r, "no", R), "riskframework.activate"],
  ];
  it.each(gated)("%s: refused for a non-Risk-Manager holding every right, and for a Risk Manager lacking the permission (q51)", async (_name, call, perm) => {
    const w = world({ rm: ["u1", "u2"] });
    const ids = await pend(w);
    const before = w.snapshot();
    await expect(call(w, ids, actor("admin"))).rejects.toThrow(ForbiddenError);
    await expect(call(w, ids, actor("u2", T1, FW.filter((p) => p !== perm)))).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
  });

  it("the decision records the actor, never a value taken from elsewhere: decidedBy = actor, deciderGroup = RISK_MANAGER", async () => {
    const w = world();
    const { r } = await pend(w);
    const out = await w.service.approve(u2, r, "ok", R);
    expect(out.request).toMatchObject({ decidedBy: "u2", requestedBy: "u1", deciderGroup: "RISK_MANAGER" });
  });
});

describe("QA-B6a decisions: wrong state, double decision, concurrency", () => {
  const first = {
    approve: (w: W, r: string) => w.service.approve(u2, r, "ok", R),
    reject: (w: W, r: string) => w.service.reject(u2, r, "no", R),
    withdraw: (w: W, r: string) => w.service.withdraw(u1, r, "oups", R),
  };
  for (const a of Object.keys(first) as Array<keyof typeof first>) {
    for (const b of Object.keys(first) as Array<keyof typeof first>) {
      it(`${b} after ${a} answers 409 and changes nothing`, async () => {
        const w = world({ rm: ["u1", "u2", "u3"] });
        const { r } = await pend(w);
        await first[a](w, r);
        const before = w.snapshot();
        const decisions = w.calls.decisions;
        await expect(first[b](w, r)).rejects.toThrow(ConflictError);
        expect(w.snapshot()).toBe(before);
        expect(w.calls.decisions).toBe(decisions);
      });
    }
  }

  it("two simultaneous approvals by two eligible Risk Managers: exactly one applies, one audit APPROVE, one DECIDED notification", async () => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { v, r } = await pend(w);
    w.sent.length = 0;
    const res = await Promise.allSettled([w.service.approve(u2, r, "a", R), w.service.approve(u3, r, "b", R)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(w.calls.decisions).toBe(1);
    expect(verOf(w, v).status).toBe("ACTIVE");
    expect(w.events.filter((e) => e.action === "APPROVE")).toHaveLength(1);
    expect(w.sent.filter((s) => s.eventType === "RISK_FRAMEWORK_CHANGE_DECIDED")).toHaveLength(1);
  });

  it.each([["approve vs reject"], ["approve vs withdraw"], ["reject vs withdraw"]])("%s in parallel: one outcome, request and version consistent", async (label) => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { v, r } = await pend(w);
    const calls = {
      "approve vs reject": () => [w.service.approve(u2, r, "a", R), w.service.reject(u3, r, "no", R)],
      "approve vs withdraw": () => [w.service.approve(u2, r, "a", R), w.service.withdraw(u1, r, undefined, R)],
      "reject vs withdraw": () => [w.service.reject(u2, r, "no", R), w.service.withdraw(u1, r, undefined, R)],
    }[label]!;
    const res = await Promise.allSettled(calls());
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const status = reqOf(w, r).status;
    expect(verOf(w, v).status).toBe(status === "APPROVED" ? "ACTIVE" : "DRAFT");
    expect(w.events.filter((e) => ["APPROVE", "REJECT"].includes(e.action) || (e.action === "STATUS_CHANGE" && e.entityType === "RiskFrameworkChangeRequest"))).toHaveLength(1);
  });

  it("two simultaneous activation requests on one draft: one request only; two simultaneous createDraft: one 409", async () => {
    const w = world();
    const { fw, v } = await draft(w);
    const res = await Promise.allSettled([w.service.requestActivation(u1, fw, v, "a", R), w.service.requestActivation(u2, fw, v, "b", R)]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(w.requests).toHaveLength(1);

    const w2 = world();
    const live2 = await live(w2);
    const d = await Promise.allSettled([w2.service.createDraft(u1, live2.fw, undefined, R), w2.service.createDraft(u2, live2.fw, undefined, R)]);
    expect(d.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((d.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(w2.versions.filter((x) => x.status === "DRAFT")).toHaveLength(1);
  });

  it("states: nothing but a DRAFT can be requested, discarded or edited; ACTIVE never goes back to DRAFT; createDraft leaves the ACTIVE alone", async () => {
    const w = world();
    const { fw, v } = await live(w);
    const bad = async (fn: () => Promise<unknown>) => { const b = w.snapshot(); await expect(fn()).rejects.toThrow(ValidationError); expect(w.snapshot()).toBe(b); };
    await bad(() => w.service.requestActivation(u1, fw, v, "again", R));
    await bad(() => w.service.discardDraft(u1, fw, v, "x", R));
    await bad(() => w.service.updateDraft(u1, fw, v, { selfProposalAllowed: false }, R));
    const d = await w.service.createDraft(u1, fw, undefined, R);
    expect(verOf(w, v).status).toBe("ACTIVE");
    const r2 = await w.service.requestActivation(u1, fw, d.id, "v2", R);
    await bad(() => w.service.discardDraft(u1, fw, d.id, "x", R)); // PENDING_APPROVAL
    await w.service.approve(u2, r2.id, undefined, R);
    expect(verOf(w, v).status).toBe("ARCHIVED");
    await bad(() => w.service.discardDraft(u1, fw, v, "x", R)); // ARCHIVED
    await bad(() => w.service.requestActivation(u1, fw, v, "x", R));
    await bad(() => w.service.updateDraft(u1, fw, v, { changeApprover: "AUDIT" }, R));
  });

  it("ARCHIVED is not reachable through an edit: status and archive fields are dropped before the repository", async () => {
    const w = world();
    const { fw, v } = await draft(w);
    const evil = { status: "ARCHIVED", archivedAt: new Date(), archivedBy: "u1", archiveReason: "x", createdBy: "evil", lastEditedBy: "evil", isDefault: true, id: "x", tenantId: T2 };
    await expect(w.service.updateDraft(u1, fw, v, evil as never, R)).rejects.toThrow(/Nothing to update/);
    await w.service.updateDraft(u2, fw, v, { ...evil, changeApprover: "AUDIT" } as never, R);
    expect(w.calls.draftFields.at(-1)).toEqual(["changeApprover"]);
    expect(verOf(w, v)).toMatchObject({ status: "DRAFT", lastEditedBy: "u2", createdBy: "u1", tenantId: T1, archivedAt: null });
  });

  it("create ignores attribution passed in the input (createdBy forced to the actor)", async () => {
    const w = world();
    const out = await w.service.create(u1, { name: "A", ratingScaleId: S1, createdBy: "evil", status: "ACTIVE", lastEditedBy: "evil" } as never, R);
    expect(out.framework.createdBy).toBe("u1");
    expect(out.version).toMatchObject({ createdBy: "u1", lastEditedBy: "u1", status: "DRAFT" });
  });

  it("withdraw: only the requester, a withdrawn request keeps decidedBy null (declared deviation) and the audit names the requester", async () => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { r } = await pend(w);
    await expect(w.service.withdraw(u2, r, undefined, R)).rejects.toThrow(ForbiddenError);
    const out = await w.service.withdraw(u1, r, "x", R);
    expect(out.request).toMatchObject({ status: "WITHDRAWN", decidedBy: null, requestedBy: "u1" });
    expect(w.events.at(-1)).toMatchObject({ userId: "u1", action: "STATUS_CHANGE", entityType: "RiskFrameworkChangeRequest" });
  });
});

describe("QA-B6a circuit (q34/q72/q76/q87) and self-proposal (q92)", () => {
  /** v1 ACTIVE with change_approver `approver`, then a second draft requested by u1. */
  async function under(approver: "COMMITTEE" | "AUDIT" | "AUDIT_AND_COMMITTEE", o: Opts) {
    const w = world({ rm: ["u1", "u2", "u3"], ...o });
    const p = await live(w, { changeApprover: approver });
    const d = await w.service.createDraft(u1, p.fw, undefined, R);
    const r2 = await w.service.requestActivation(u1, p.fw, d.id, "v2", R);
    return { w, fw: p.fw, v1: p.v, v2: d.id, r2: r2.id };
  }

  it.each([
    ["COMMITTEE", { committee: ["c1", "c2"] }, /Comité/],
    ["AUDIT", { audit: ["a1", "a2"] }, /Audit/],
    ["AUDIT_AND_COMMITTEE", { audit: ["a1", "a2"], committee: ["c1", "c2"] }, /Comité et Audit/],
  ] as const)("q87: %s with 2 eligible members: approve AND reject answer 409, request stays PENDING, nothing written, withdraw still works", async (approver, o, msg) => {
    const { w, v2, r2 } = await under(approver, o);
    const before = w.snapshot();
    await expect(w.service.approve(u2, r2, "x", R)).rejects.toThrow(ConflictError);
    await expect(w.service.approve(u2, r2, "x", R)).rejects.toThrow(msg);
    await expect(w.service.reject(u2, r2, "x", R)).rejects.toThrow(ConflictError);
    expect(w.snapshot()).toBe(before);
    expect(reqOf(w, r2).status).toBe("PENDING");
    await w.service.withdraw(u1, r2, undefined, R);
    expect(verOf(w, v2).status).toBe("DRAFT");
  });

  it("q87 over HTTP: approve and reject answer 409 with a message naming the group", async () => {
    const { w, r2 } = await under("COMMITTEE", { committee: ["c1", "c2"] });
    await withHttp(w, async (call) => {
      const a = await call("POST", `/change-requests/${r2}/approve`, {}, u2);
      const b = await call("POST", `/change-requests/${r2}/reject`, { comment: "no" }, u2);
      expect([a.status, b.status]).toEqual([409, 409]);
      expect(a.json.error).toMatch(/Comité/);
    });
  });

  it("members excluded as requester or author do not count towards the 2 eligible (declared choice): requester in the Committee leaves 1 -> fallback", async () => {
    const { w, r2 } = await under("COMMITTEE", { committee: ["u1", "c2"] });
    const out = await w.service.approve(u2, r2, "repli", R);
    expect(out.request).toMatchObject({ decisionRegime: "FALLBACK", ratificationStatus: "PENDING" });
  });

  it("3 members of which the requester: 2 remain eligible -> a vote; a suspended member does not count", async () => {
    const a = await under("COMMITTEE", { committee: ["u1", "c2", "c3"] });
    await expect(a.w.service.approve(u2, a.r2, "x", R)).rejects.toThrow(ConflictError);
    const b = await under("COMMITTEE", { committee: ["c1", "c2"], suspended: ["c2"] });
    await expect(b.w.service.approve(u2, b.r2, "repli", R)).resolves.toBeDefined();
  });

  it("AUDIT_AND_COMMITTEE with a single eligible group (declared deviation): a vote of that one group only", async () => {
    const { w, r2 } = await under("AUDIT_AND_COMMITTEE", { committee: ["c1", "c2"], audit: ["a1"] });
    await expect(w.service.approve(u2, r2, "x", R)).rejects.toThrow(/groupe Comité \(/);
  });

  it("the first activation follows the Risk Manager rule even if the draft names the Committee; the rule then comes from the ACTIVE version, not from the next draft", async () => {
    const w = world({ rm: ["u1", "u2", "u3"], committee: ["c1", "c2"] });
    const p = await pend(w, { changeApprover: "COMMITTEE" });
    const out = await w.service.approve(u2, p.r, undefined, R);
    expect(out.request.decisionRegime).toBe("NORMAL");
    // active = COMMITTEE; the next draft switches back to RISK_MANAGER but is still governed by COMMITTEE
    const d = await w.service.createDraft(u1, p.fw, undefined, R);
    await w.service.updateDraft(u1, p.fw, d.id, { changeApprover: "RISK_MANAGER" }, R);
    const r2 = await w.service.requestActivation(u1, p.fw, d.id, "v2", R);
    await expect(w.service.approve(u2, r2.id, undefined, R)).rejects.toThrow(ConflictError);
  });

  it("fallback: a blank comment is refused, rejection also needs one, Audit is notified only when it has members, ratification PENDING on both outcomes (observation)", async () => {
    const { w, r2 } = await under("COMMITTEE", { audit: ["a1"] });
    w.sent.length = 0;
    await expect(w.service.approve(u2, r2, "   ", R)).rejects.toThrow(ValidationError);
    await expect(w.service.reject(u2, r2, "  ", R)).rejects.toThrow(ValidationError);
    const out = await w.service.reject(u2, r2, "non", R);
    expect(out.request).toMatchObject({ status: "REJECTED", decisionRegime: "FALLBACK", ratificationStatus: "PENDING" });
    expect(w.sent.filter((s) => s.eventType === "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE").map((s) => s.recipientUserId)).toEqual(["a1"]);
    const e = await under("COMMITTEE", {});
    e.w.sent.length = 0;
    await e.w.service.approve(u2, e.r2, "repli", R);
    expect(e.w.sent.some((s) => s.eventType === "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE")).toBe(false);
  });

  it("nobody can decide: the only other Risk Manager is an author -> PENDING, NO_DECIDER to every Risk Manager, no PENDING notification, no tacit decision", async () => {
    const w = world({ rm: ["u1", "u2"] });
    const { fw, v } = await draft(w);
    await w.service.updateDraft(u2, fw, v, { committeeEvaluationEnforced: false }, R); // u2 becomes an author
    w.sent.length = 0;
    const r = await w.service.requestActivation(u1, fw, v, "go", R);
    expect(r.status).toBe("PENDING");
    expect(w.sent.map((s) => `${s.eventType}:${s.recipientUserId}`).sort()).toEqual(["RISK_FRAMEWORK_NO_DECIDER:u1", "RISK_FRAMEWORK_NO_DECIDER:u2"]);
    await expect(w.service.approve(u2, r.id, undefined, R)).rejects.toThrow(ForbiddenError);
    await expect(w.service.approve(actor("admin"), r.id, undefined, R)).rejects.toThrow(ForbiddenError);
    expect(reqOf(w, r.id).status).toBe("PENDING");
  });

  describe("q92 self-proposal false -> true", () => {
    it.each([
      ["RISK_MANAGER rule on the first activation", async () => { const w = world(); const d = await draft(w, { selfProposalAllowed: true }); return { w, ...d }; }],
      ["Risk Manager rule on an ACTIVE version", async () => { const w = world({ rm: ["u1", "u2", "u3"] }); const p = await live(w); const d = await w.service.createDraft(u1, p.fw, undefined, R); await w.service.updateDraft(u1, p.fw, d.id, { selfProposalAllowed: true }, R); return { w, fw: p.fw, v: d.id }; }],
      ["Audit vote", async () => { const w = world({ rm: ["u1", "u2", "u3"], audit: ["a1", "a2"] }); const p = await live(w, { changeApprover: "AUDIT" }); const d = await w.service.createDraft(u1, p.fw, undefined, R); await w.service.updateDraft(u1, p.fw, d.id, { selfProposalAllowed: true }, R); return { w, fw: p.fw, v: d.id }; }],
      ["Committee fallback (Committee too small)", async () => { const w = world({ rm: ["u1", "u2", "u3"], committee: ["c1"] }); const p = await live(w, { changeApprover: "COMMITTEE" }); const d = await w.service.createDraft(u1, p.fw, undefined, R); await w.service.updateDraft(u1, p.fw, d.id, { selfProposalAllowed: true }, R); return { w, fw: p.fw, v: d.id }; }],
      ["draft switching the approver and the flag together (rule of the ACTIVE version applies)", async () => { const w = world({ rm: ["u1", "u2", "u3"], committee: ["c1", "c2"] }); const p = await live(w); const d = await w.service.createDraft(u1, p.fw, undefined, R); await w.service.updateDraft(u1, p.fw, d.id, { selfProposalAllowed: true, changeApprover: "COMMITTEE" }, R); return { w, fw: p.fw, v: d.id }; }],
    ])("refused at request creation: %s; the draft stays DRAFT and no request, audit or notification is created", async (_l, build) => {
      const { w, fw, v } = await build();
      const before = w.snapshot();
      await expect(w.service.requestActivation(u1, fw, v, "go", R)).rejects.toThrow(/auto-proposition/);
      expect(w.snapshot()).toBe(before);
      expect(verOf(w, v).status).toBe("DRAFT");
    });

    it("receivable under a Committee vote (approve is then 409 until B-12); true -> true is not a switch", async () => {
      const w = world({ rm: ["u1", "u2", "u3"], committee: ["c1", "c2"] });
      const p = await live(w, { changeApprover: "COMMITTEE" });
      const d = await w.service.createDraft(u1, p.fw, undefined, R);
      await w.service.updateDraft(u1, p.fw, d.id, { selfProposalAllowed: true }, R);
      const r = await w.service.requestActivation(u1, p.fw, d.id, "go", R);
      expect(r.status).toBe("PENDING");
      await expect(w.service.approve(u2, r.id, "x", R)).rejects.toThrow(ConflictError);
      await w.service.withdraw(u1, r.id, undefined, R);
      // active already true (state only reachable after B-12): the next draft inherits true and is not refused
      const w2 = world({ rm: ["u1", "u2", "u3"], committee: ["c1", "c2"] });
      const p2 = await live(w2, { changeApprover: "COMMITTEE" });
      verOf(w2, p2.v).selfProposalAllowed = true;
      const d2 = await w2.service.createDraft(u1, p2.fw, undefined, R);
      expect(d2.selfProposalAllowed).toBe(true);
      await expect(w2.service.requestActivation(u1, p2.fw, d2.id, "go", R)).resolves.toMatchObject({ status: "PENDING" });
    });
  });
});

describe("QA-B6a activation request validation (spec §2.3)", () => {
  const ask = async (w: W, fw: string, v: string) => w.service.requestActivation(u1, fw, v, "motif", R);
  const e = (subCategory: string, threshold: number, entity: string | null = null) => ({ subCategory, subCategoryId: null, entity, threshold, description: null });

  it("boundary n^2 accepted, n^2+1 refused (appetite, Committee thresholds), on a 5x5 and a 3x3", async () => {
    const w = world();
    const ok = await draft(w, { committeeEvaluationMinScore: 25, committeeTreatmentMinScore: 25, appetiteThresholds: [e("A", 25)] });
    await expect(ask(w, ok.fw, ok.v)).resolves.toMatchObject({ status: "PENDING" });
    for (const params of [{ committeeEvaluationMinScore: 26 }, { committeeTreatmentMinScore: 26 }, { appetiteThresholds: [e("A", 26)] }]) {
      const d = await draft(w, params);
      await expect(ask(w, d.fw, d.v)).rejects.toThrow(/exceed/);
      expect(verOf(w, d.v).status).toBe("DRAFT");
    }
    w.scales[0] = scale(S1, T1, 3);
    const t = await draft(w, { committeeEvaluationMinScore: 9, appetiteThresholds: [e("A", 9)] });
    await expect(ask(w, t.fw, t.v)).resolves.toBeDefined();
    const t2 = await draft(w, { committeeEvaluationMinScore: 10 });
    await expect(ask(w, t2.fw, t2.v)).rejects.toThrow(/exceed/);
  });

  it("a criticality band above the ceiling refuses the request; a scale deleted, made non-square or without axis after the draft is refused", async () => {
    const w = world();
    w.scales[0] = scale(S1, T1, 3, { criticalityThresholds: [{ label: "Haut", max: 12 }] as never });
    const a = await draft(w, { committeeEvaluationMinScore: 5 });
    await expect(ask(w, a.fw, a.v)).rejects.toThrow(/bande/);
    const w2 = world();
    const d2 = await draft(w2);
    w2.scales.length = 0;
    await expect(ask(w2, d2.fw, d2.v)).rejects.toThrow(/no longer exists/);
    const w3 = world();
    const d3 = await draft(w3);
    w3.scales[0] = scale(S1, T1, 5, { impactLevels: 4, impactLabels: level(4) });
    await expect(ask(w3, d3.fw, d3.v)).rejects.toThrow(/square/);
    const w4 = world();
    const d4 = await draft(w4);
    w4.scales[0] = scale(S1, T1, 5, { impactAxes: { axes: [], retainedImpactRule: "MAX" } });
    await expect(ask(w4, d4.fw, d4.v)).rejects.toThrow(/axis/);
  });

  it("a scale of another tenant is refused on create and on edit; a category of another tenant is refused (fail-closed when not owned)", async () => {
    const w = world({ categories: [`${T2}:c-t2`, `${T1}:c-t1`] });
    await expect(w.service.create(u1, { name: "X", ratingScaleId: S2 }, R)).rejects.toThrow(/does not exist/);
    const { fw, v } = await draft(w);
    await expect(w.service.updateDraft(u1, fw, v, { ratingScaleId: S2 }, R)).rejects.toThrow(/does not exist/);
    const cat = (id: string) => ({ subCategory: "F", subCategoryId: id, entity: null, threshold: 5, description: null });
    await expect(w.service.updateDraft(u1, fw, v, { appetiteThresholds: [cat("c-t2")] }, R)).rejects.toThrow(/does not exist in this tenant/);
    await expect(w.service.updateDraft(u1, fw, v, { appetiteThresholds: [cat("c-t1")] }, R)).resolves.toBeDefined();
  });

  it("appetite uniqueness: trimmed and null/empty entity collide; letter case does not (declared, same as the existing appetite repository)", async () => {
    const w = world();
    const { fw, v } = await draft(w);
    await expect(w.service.updateDraft(u1, fw, v, { appetiteThresholds: [e("Fraude", 5), e("  Fraude ", 6)] }, R)).rejects.toThrow(/Duplicate/);
    await expect(w.service.updateDraft(u1, fw, v, { appetiteThresholds: [e("Fraude", 5, null), e("Fraude", 6, "")] }, R)).rejects.toThrow(/Duplicate/);
    await expect(w.service.updateDraft(u1, fw, v, { appetiteThresholds: [e("Fraude", 5), e("fraude", 6)] }, R)).resolves.toBeDefined();
  });

  it("framework name: unique per tenant ignoring case, allowed in another tenant", async () => {
    const w = world();
    await w.service.create(u1, { name: "Alpha", ratingScaleId: S1 }, R);
    await expect(w.service.create(u1, { name: " ALPHA ", ratingScaleId: S1 }, R)).rejects.toThrow(ConflictError);
    await expect(w.service.create(actor("v1", T2), { name: "Alpha", ratingScaleId: S2 }, R)).resolves.toBeDefined();
  });
});

describe("QA-B6a audit (spec §13) and failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("every mutation writes the expected entity/action, userId = actor, tenant and requestId carried", async () => {
    const w = world();
    const { framework, version } = await w.service.create(u1, { name: "A", ratingScaleId: S1 }, "q1");
    await w.service.updateIdentity(u1, framework.id, { name: "B", reason: "renom" }, "q2");
    await w.service.updateDraft(u1, framework.id, version.id, { changeApprover: "AUDIT" }, "q3");
    const r = await w.service.requestActivation(u1, framework.id, version.id, "go", "q4");
    await w.service.approve(u2, r.id, "ok", "q5");
    const d = await w.service.createDraft(u2, framework.id, undefined, "q6");
    await w.service.discardDraft(u2, framework.id, d.id, "abandon", "q7");
    const d2 = await w.service.createDraft(u2, framework.id, undefined, "q8");
    const r2 = await w.service.requestActivation(u2, framework.id, d2.id, "bis", "q9");
    await w.service.withdraw(u2, r2.id, "x", "q10");
    expect(w.events.map((x) => `${x.entityType}:${x.action}:${x.userId}:${x.requestId}`)).toEqual([
      "RiskFramework:CREATE:u1:q1", "RiskFrameworkVersion:CREATE:u1:q1",
      "RiskFramework:UPDATE:u1:q2", "RiskFrameworkVersion:UPDATE:u1:q3",
      "RiskFrameworkChangeRequest:SUBMIT:u1:q4",
      "RiskFrameworkVersion:STATUS_CHANGE:u2:q5", "RiskFrameworkChangeRequest:APPROVE:u2:q5",
      "RiskFrameworkVersion:CREATE:u2:q6", "RiskFrameworkVersion:STATUS_CHANGE:u2:q7",
      "RiskFrameworkVersion:CREATE:u2:q8", "RiskFrameworkChangeRequest:SUBMIT:u2:q9", "RiskFrameworkChangeRequest:STATUS_CHANGE:u2:q10",
    ]);
    expect(w.events.every((x) => x.tenantId === T1)).toBe(true);
    expect(w.events.find((x) => x.action === "UPDATE" && x.entityType === "RiskFramework")).toMatchObject({ reason: "renom", oldValue: { name: "A" } });
  });

  it("refused calls leave no audit line and no notification", async () => {
    const w = world({ rm: ["u1", "u2"] });
    const { fw, v, r } = await pend(w);
    const n = w.events.length;
    const sent = w.sent.length;
    await expect(w.service.approve(u1, r, undefined, R)).rejects.toThrow();
    await expect(w.service.updateDraft(u1, fw, v, { changeApprover: "AUDIT" }, R)).rejects.toThrow();
    await expect(w.service.discardDraft(u1, fw, v, "x", R)).rejects.toThrow();
    expect([w.events.length, w.sent.length]).toEqual([n, sent]);
  });

  it("audit down on approve: the decision is applied and not replayable (409), the error is reported and logged with the requestId; the requester is NOT notified (observation)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    const { v, r } = await pend(w);
    w.sent.length = 0;
    w.hooks.auditFails = () => true;
    await expect(w.service.approve(u2, r, "ok", "rid-9")).rejects.toThrow(/audit down/);
    expect(reqOf(w, r).status).toBe("APPROVED");
    expect(verOf(w, v).status).toBe("ACTIVE");
    expect(spy.mock.calls.flat().join(" ")).toContain("rid-9");
    expect(w.sent).toHaveLength(0);
    w.hooks.auditFails = () => false;
    await expect(w.service.approve(u2, r, "ok", R)).rejects.toThrow(ConflictError);
    expect(w.events.filter((e) => e.action === "APPROVE")).toHaveLength(0); // the trail has a permanent hole (spec §13 known gap)
  });

  it("audit down on a request: the request exists and can still be decided (no orphan version), but nobody was notified and SUBMIT is missing (observation)", async () => {
    const w = world();
    const { fw, v } = await draft(w);
    w.hooks.auditFails = (e) => e.action === "SUBMIT";
    w.sent.length = 0;
    await expect(w.service.requestActivation(u1, fw, v, "go", R)).rejects.toThrow(/audit down/);
    expect(verOf(w, v).status).toBe("PENDING_APPROVAL");
    expect(w.sent).toHaveLength(0);
    w.hooks.auditFails = () => false;
    await expect(w.service.approve(u2, w.requests[0]!.id, undefined, R)).resolves.toBeDefined();
  });

  it("notification down never undoes a decision", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world();
    const { v, r } = await pend(w);
    w.hooks.notifyDown = true;
    await expect(w.service.approve(u2, r, "ok", R)).resolves.toBeDefined();
    expect(verOf(w, v).status).toBe("ACTIVE");
  });

  // KNOWN GAP (MINOR, QA severity): spec §5.3(4) excludes every author found in the audit trail, but an edit whose
  // audit write fails is stored (RiskFrameworkService.ts:261-262, no transaction) and, once another person edits
  // afterwards, last_edited_by no longer names the first editor either: nothing excludes them any more.
  it.fails("KNOWN GAP B6a-QA-01: an editor whose audit line failed can still approve after another edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const w = world({ rm: ["u1", "u2", "u3"] });
    const { fw, v } = await draft(w);
    w.hooks.auditFails = (e) => e.userId === "u3" && e.action === "UPDATE";
    await expect(w.service.updateDraft(u3, fw, v, { committeeEvaluationEnforced: false }, R)).rejects.toThrow(/audit down/);
    expect(verOf(w, v).committeeEvaluationEnforced).toBe(false); // the edit was stored
    w.hooks.auditFails = () => false;
    await w.service.updateDraft(u1, fw, v, { defaultEvaluationMode: "PARTICIPATIF" }, R);
    const r = await w.service.requestActivation(u1, fw, v, "go", R);
    await expect(w.service.approve(u3, r.id, undefined, R)).rejects.toThrow(ForbiddenError);
  });
});

describe("QA-B6a tenant isolation and HTTP surface", () => {
  const t2rm = actor("v1", T2);

  const idRoutes = (i: { fw: string; v: string; r: string }) => [
    ["GET", `/${i.fw}`, undefined, "riskframework.read"],
    ["PATCH", `/${i.fw}`, { name: "N", reason: "r" }, "riskframework.update"],
    ["GET", `/${i.fw}/versions/${i.v}`, undefined, "riskframework.read"],
    ["POST", `/${i.fw}/versions`, {}, "riskframework.update"],
    ["PATCH", `/${i.fw}/versions/${i.v}`, { changeApprover: "AUDIT" }, "riskframework.update"],
    ["POST", `/${i.fw}/versions/${i.v}/discard`, { reason: "x" }, "riskframework.archive"],
    ["POST", `/${i.fw}/versions/${i.v}/activation-requests`, { reason: "x" }, "riskframework.update"],
    ["POST", `/change-requests/${i.r}/approve`, {}, "riskframework.activate"],
    ["POST", `/change-requests/${i.r}/reject`, { comment: "no" }, "riskframework.activate"],
    ["POST", `/change-requests/${i.r}/withdraw`, {}, "riskframework.update"],
  ] as Array<[string, string, object | undefined, Permission]>;

  it("every id-addressed route answers 404 to another tenant's Risk Manager, and changes nothing in either tenant", async () => {
    const w = world();
    const ids = await pend(w);
    const before = [w.snapshot(T1), w.snapshot(T2)];
    await withHttp(w, async (call) => {
      for (const [m, p, b] of idRoutes(ids)) {
        const res = await call(m, p, b, t2rm);
        expect([m + " " + p, res.status]).toEqual([m + " " + p, 404]);
      }
      const list = await call("GET", "/", undefined, t2rm);
      const reqs = await call("GET", "/change-requests", undefined, t2rm);
      expect([list.json.data, reqs.json.data]).toEqual([[], []]);
      const create = await call("POST", "/", { name: "X", ratingScaleId: S1 }, t2rm);
      expect(create.status).toBe(400);
    });
    expect([w.snapshot(T1), w.snapshot(T2)]).toEqual(before);
  });

  it("every route answers 403 when exactly its permission is missing, without any effect", async () => {
    const w = world();
    const ids = await pend(w);
    const before = w.snapshot();
    const all: Array<[string, string, object | undefined, Permission]> = [
      ["GET", "/", undefined, "riskframework.read"],
      ["POST", "/", { name: "X", ratingScaleId: S1 }, "riskframework.create"],
      ["GET", "/change-requests", undefined, "riskframework.read"],
      ...idRoutes(ids),
    ];
    await withHttp(w, async (call) => {
      for (const [m, p, b, perm] of all) {
        const res = await call(m, p, b, actor("u2", T1, FW.filter((x) => x !== perm)));
        expect([m + " " + p, res.status]).toEqual([m + " " + p, 403]);
        // a neighbouring permission is not enough
        if (perm === "riskframework.activate" || perm === "riskframework.archive") {
          const other = await call(m, p, b, actor("u2", T1, ["riskframework.read", "riskframework.update", "riskframework.create"]));
          expect(other.status).toBe(403);
        }
      }
    });
    expect(w.snapshot()).toBe(before);
  });

  it("an attribution or status key in any body is a 400 and writes nothing", async () => {
    const w = world();
    const ids = await pend(w);
    const evil = { requestedBy: "x", decidedBy: "x", createdBy: "x", lastEditedBy: "x", status: "ACTIVE", archivedAt: "2020-01-01", isDefault: true };
    const before = w.snapshot();
    const bodyRoutes: Array<[string, string, object]> = [
      ["POST", "/", { name: "X", ratingScaleId: S1 }],
      ["PATCH", `/${ids.fw}`, { name: "N", reason: "r" }],
      ["POST", `/${ids.fw}/versions`, {}],
      ["PATCH", `/${ids.fw}/versions/${ids.v}`, { changeApprover: "AUDIT" }],
      ["POST", `/${ids.fw}/versions/${ids.v}/discard`, { reason: "x" }],
      ["POST", `/${ids.fw}/versions/${ids.v}/activation-requests`, { reason: "x" }],
      ["POST", `/change-requests/${ids.r}/approve`, {}],
      ["POST", `/change-requests/${ids.r}/reject`, { comment: "no" }],
      ["POST", `/change-requests/${ids.r}/withdraw`, {}],
    ];
    await withHttp(w, async (call) => {
      for (const [m, p, b] of bodyRoutes) {
        for (const key of Object.keys(evil)) {
          const res = await call(m, p, { ...b, [key]: (evil as Record<string, unknown>)[key] }, u2);
          expect([m + " " + p + " " + key, res.status]).toEqual([m + " " + p + " " + key, 400]);
        }
      }
      expect((await call("POST", "/", { name: "X", ratingScaleId: S1, params: { createdBy: "x" } }, u1)).status).toBe(400);
      expect((await call("POST", "/", { name: "X", ratingScaleId: S1, params: { appetiteThresholds: [{ subCategory: "A", threshold: 5, status: "x" }] } }, u1)).status).toBe(400);
    });
    expect(w.snapshot()).toBe(before);
  });

  it("PATCH can never archive: status/archive fields are 400 on a version and on the identity; discard is the only door and needs riskframework.archive", async () => {
    const w = world();
    const { fw, v } = await draft(w);
    await withHttp(w, async (call) => {
      for (const body of [{ status: "ARCHIVED" }, { archivedAt: "2020-01-01T00:00:00Z" }, { archiveReason: "x" }, { archivedBy: "u1" }]) {
        expect((await call("PATCH", `/${fw}/versions/${v}`, body, u1)).status).toBe(400);
        expect((await call("PATCH", `/${fw}`, { ...body, reason: "r" }, u1)).status).toBe(400);
      }
      expect(verOf(w, v).status).toBe("DRAFT");
      expect((await call("POST", `/${fw}/versions/${v}/discard`, { reason: "x" }, actor("u1", T1, ["riskframework.update", "riskframework.read"]))).status).toBe(403);
      expect((await call("POST", `/${fw}/versions/${v}/discard`, { reason: "x" }, u1)).status).toBe(200);
      expect(verOf(w, v).status).toBe("ARCHIVED");
    });
  });

  it("wrong ids are 400, unknown status filter 400, /change-requests is not read as an :id, filter works", async () => {
    const w = world();
    const ids = await pend(w);
    await withHttp(w, async (call) => {
      expect((await call("GET", "/not-a-guid", undefined, u1)).status).toBe(400);
      expect((await call("POST", "/change-requests/not-a-guid/approve", {}, u2)).status).toBe(400);
      expect((await call("GET", `/${ids.fw}/versions/zzz`, undefined, u1)).status).toBe(400);
      expect((await call("GET", "/change-requests?status=BOGUS", undefined, u1)).status).toBe(400);
      expect((await call("GET", "/change-requests?status=APPROVED", undefined, u1)).json.data).toEqual([]);
      expect((await call("GET", "/change-requests?status=PENDING", undefined, u1)).json.data).toHaveLength(1);
      expect((await call("GET", `/${randomUUID()}`, undefined, u1)).status).toBe(404);
    });
  });

  const long = (k: number) => "x".repeat(k);
  const entries = (k: number) => Array.from({ length: k }, (_, i) => ({ subCategory: `c${i}`, threshold: 5 }));
  it.each([
    ["name 120", { name: long(120), ratingScaleId: S1 }, 201], ["name 121", { name: long(121), ratingScaleId: S1 }, 400],
    ["name blank", { name: "   ", ratingScaleId: S1 }, 400], ["description 1000", { name: "a", description: long(1000), ratingScaleId: S1 }, 201],
    ["description 1001", { name: "a", description: long(1001), ratingScaleId: S1 }, 400], ["ratingScaleId not a guid", { name: "a", ratingScaleId: "s1" }, 400],
    ["score 36", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: 36 } }, 201],
    ["score 37", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: 37 } }, 400],
    ["score 0", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: 0 } }, 400],
    ["score 1.5", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: 1.5 } }, 400],
    ["score '5'", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: "5" } }, 400],
    ["score null", { name: "a", ratingScaleId: S1, params: { committeeEvaluationMinScore: null } }, 400],
    ["treatment null", { name: "a", ratingScaleId: S1, params: { committeeTreatmentMinScore: null } }, 201],
    ["mode bad", { name: "a", ratingScaleId: S1, params: { defaultEvaluationMode: "X" } }, 400],
    ["approver bad", { name: "a", ratingScaleId: S1, params: { changeApprover: "ADMIN" } }, 400],
    ["appetite 200", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: entries(200) } }, 201],
    ["appetite 201", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: entries(201) } }, 400],
    ["appetite 5000 empty objects", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: Array.from({ length: 5000 }, () => ({})) } }, 400],
    ["appetite not an array", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: {} } }, 400],
    ["appetite entry threshold 0", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: [{ subCategory: "A", threshold: 0 }] } }, 400],
    ["appetite entry subCategory blank", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: [{ subCategory: " ", threshold: 3 }] } }, 400],
    ["appetite entity 201", { name: "a", ratingScaleId: S1, params: { appetiteThresholds: [{ subCategory: "A", entity: long(201), threshold: 3 }] } }, 400],
  ] as Array<[string, object, number]>)("POST / %s -> %i", async (_l, body, status) => {
    const w = world();
    await withHttp(w, async (call) => expect((await call("POST", "/", body, u1)).status).toBe(status));
    expect(w.frameworks.length).toBe(status === 201 ? 1 : 0);
  });

  it.each([
    ["discard reason 500", "discard", { reason: long(500) }, 200], ["discard reason 501", "discard", { reason: long(501) }, 400], ["discard reason blank", "discard", { reason: " " }, 400],
    ["request reason 500", "activation-requests", { reason: long(500) }, 201], ["request reason 501", "activation-requests", { reason: long(501) }, 400], ["request reason missing", "activation-requests", {}, 400],
  ] as Array<[string, string, object, number]>)("%s -> %i", async (_l, route, body, status) => {
    const w = world();
    const { fw, v } = await draft(w);
    await withHttp(w, async (call) => expect((await call("POST", `/${fw}/versions/${v}/${route}`, body, u1)).status).toBe(status));
  });

  it.each([
    ["approve comment 1000", "approve", { comment: long(1000) }, 200], ["approve comment 1001", "approve", { comment: long(1001) }, 400],
    ["approve without body", "approve", undefined, 200], ["reject comment 1000", "reject", { comment: long(1000) }, 200],
    ["reject comment 1001", "reject", { comment: long(1001) }, 400], ["reject blank", "reject", { comment: "  " }, 400], ["reject missing", "reject", {}, 400],
  ] as Array<[string, string, object | undefined, number]>)("%s -> %i", async (_l, route, body, status) => {
    const w = world();
    const { r } = await pend(w);
    await withHttp(w, async (call) => expect((await call("POST", `/change-requests/${r}/${route}`, body, u2)).status).toBe(status));
  });

  it("end to end over HTTP: create -> request -> self-approve 403 -> approve by a third party 200 -> second approve 409 -> new draft", async () => {
    const w = world();
    await withHttp(w, async (call) => {
      const c = await call("POST", "/", { name: "Dispositif", ratingScaleId: S1 }, u1);
      expect(c.status).toBe(201);
      const { framework, version } = c.json.data;
      const rq = await call("POST", `/${framework.id}/versions/${version.id}/activation-requests`, { reason: "go" }, u1);
      expect(rq.status).toBe(201);
      const rid = rq.json.data.id;
      expect((await call("POST", `/change-requests/${rid}/approve`, {}, u1)).status).toBe(403);
      expect((await call("POST", `/change-requests/${rid}/approve`, {}, u2)).status).toBe(200);
      expect((await call("POST", `/change-requests/${rid}/approve`, {}, u2)).status).toBe(409);
      expect((await call("PATCH", `/${framework.id}/versions/${version.id}`, { changeApprover: "AUDIT" }, u1)).status).toBe(400);
      expect((await call("POST", `/${framework.id}/versions`, {}, u1)).status).toBe(201);
      expect((await call("POST", `/${framework.id}/versions`, {}, u1)).status).toBe(409);
      const got = await call("GET", `/${framework.id}`, undefined, u1);
      expect(got.json.data.versions.map((x: RiskFrameworkVersion) => x.status).sort()).toEqual(["ACTIVE", "DRAFT"]);
    });
  });
});

describe("QA-B6a static checks: repository SQL, migration 055, permissions (nothing is applied)", () => {
  const repoSrc = readFileSync("src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts", "utf8");
  const up = readFileSync("../database/postgresql/migrations/055_risk_frameworks.sql", "utf8");

  it("every SQL statement of the repository is tenant-scoped and none deletes", () => {
    const sqls = [...repoSrc.matchAll(/`((?:SELECT|UPDATE|INSERT)[^`]*)`/g)].map((m) => m[1]!);
    expect(sqls.length).toBeGreaterThanOrEqual(20);
    for (const s of sqls) expect(s, s).toMatch(/tenant_id/);
    expect(repoSrc).not.toMatch(/DELETE\s+FROM/i);
    // the lock that serialises concurrent decisions is on the request row, tenant-scoped, and re-checks the version status
    expect(repoSrc).toMatch(/risk_framework_change_requests WHERE tenant_id = \$1 AND id = \$2 FOR UPDATE/);
    expect(repoSrc.match(/AND status = 'PENDING_APPROVAL'/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("055: maker-checker CHECK, decision CHECK (WITHDRAWN has no decider: declared), activation_request_id without FK (declared), one PENDING request per target", () => {
    expect(up).toMatch(/decided_by IS NULL OR decided_by <> requested_by OR decision_regime = 'BOOTSTRAP'/);
    expect(up).toMatch(/status = 'WITHDRAWN' AND decided_by IS NULL/);
    expect(up).toMatch(/activation_request_id\s+uuid,/);
    expect(up).not.toMatch(/activation_request_id[^\n]*REFERENCES/);
    expect(up).toMatch(/risk_framework_change_requests_pending_idx[\s\S]*WHERE status = 'PENDING'/);
    expect(up).toMatch(/risk_framework_versions_open_idx[\s\S]*status IN \('DRAFT', 'PENDING_APPROVAL'\)/);
    expect(up).toMatch(/risk_framework_versions_active_idx[\s\S]*status = 'ACTIVE'/);
    expect(up).toMatch(/lower\(name\)\) WHERE archived_at IS NULL/);
  });

  it("055 guard: a version cannot skip PENDING (DRAFT cannot become ACTIVE), ARCHIVED is final, DELETE and TRUNCATE are refused, a request is frozen once decided", () => {
    expect(up).toMatch(/OLD\.status = 'DRAFT'[\s\S]*NEW\.status NOT IN \('DRAFT', 'PENDING_APPROVAL', 'ARCHIVED'\)/);
    expect(up).toMatch(/OLD\.status = 'ACTIVE' AND NEW\.status = 'ARCHIVED'/);
    expect(up).toMatch(/DELETE is not permitted/);
    expect(up.match(/BEFORE TRUNCATE/g)).toHaveLength(3);
    expect(up).toMatch(/OLD\.status <> 'PENDING' OR NEW\.status = 'PENDING'/);
    expect(up).toMatch(/REVOKE DELETE, TRUNCATE ON risk_frameworks, risk_framework_versions, risk_framework_change_requests/);
  });

  it("permissions: only the Risk Manager group gets create/update/activate/archive/assign; Committee and Audit get riskframework.read only; 055 adds exactly these", () => {
    const fw = (g: SystemGroup) => FIXED_GROUP_PERMISSIONS[g].filter((p) => p.startsWith("riskframework."));
    expect(fw("RISK_MANAGER").sort()).toEqual([...FW].sort());
    expect(fw("RISK_COMMITTEE")).toEqual(["riskframework.read"]);
    expect(fw("AUDIT")).toEqual(["riskframework.read"]);
    expect(FIXED_GROUP_PERMISSIONS.RISK_MANAGER).not.toContain("riskframework.activate.committee");
    const added = [...up.matchAll(/ARRAY\[([^\]]*)\]::text\[\]/g)].map((m) => [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]));
    expect(added[0]!.sort()).toEqual([...FW].sort());
    expect(added[1]).toEqual(["riskframework.read"]);
  });

  it("the legitimate adaptation of B8ter stays strict: constant == 051 list + 055 additions, in order, per group (the test would fail on any extra or missing right)", () => {
    const src = readFileSync("test/B8ter.test.ts", "utf8");
    expect(src).toMatch(/toEqual\(\[\.\.\.fromMigration\(g\), \.\.\.addedBy055\(g\)\]\)/);
    const q = readFileSync("test/QA-B8quater.test.ts", "utf8");
    expect(q).toMatch(/gap-free from 53/); // still no gap and no reuse from 53 on
  });
});

// ---------------------------------------------------------------------------------------------------
type Call = (method: string, path: string, body?: unknown, as?: AuthenticatedUser) => Promise<{ status: number; json: any }>;

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
      const res = await fetch(`http://127.0.0.1:${port}/risk-frameworks${path === "/" ? "" : path}`, {
        method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    });
  } finally {
    server.close();
  }
}
