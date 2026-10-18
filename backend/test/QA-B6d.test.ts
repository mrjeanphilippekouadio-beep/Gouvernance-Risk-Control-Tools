import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
import { defaultCommitteeThreshold } from "../src/domain/scoring.js";
import { contractDefaultViolations } from "../src/domain/frameworkApproval.js";
import { DEFAULT_CONTRACT_PARAMS } from "../src/domain/entities/RiskFramework.js";
import type { BootstrapFacts, BootstrapJustification } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA level 2 for B-6d (commit 9f53463): q100 fallback, bootstrap q77/q81-q83/q98/q101-q103, I-D8, I-D9. Oracles: spec RM-V1-B6-Dispositif-spec.md sections 5.4.1, 5.6, 12.3, 15 and A13 review sections 6-7.
// First half = the QA-B6a fake repository (fallbackCause now persisted, the original fake dropped it).
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
      Object.assign(r, { status: d.outcome, decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: d.decisionRegime, deciderGroup: d.deciderGroup, ratificationStatus: d.ratificationStatus, fallbackCause: d.fallbackCause ?? null, decidedAt: new Date() });
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
  // (users.getById returns the canonical lower-case uuid, like PostgreSQL)
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
async function draft(w: W, params: { changeApprover?: string } = {}, by = u1) {
  // C-B6a-02: a non-RISK_MANAGER approver cannot be written through the service before B-12: seed it as stored data.
  const { changeApprover, ...allowed } = params;
  const { framework, version } = await w.service.create(by, { name: `D${++n}`, ratingScaleId: S1, params: { lowCriticalityThreshold: 5, ...allowed } }, R);
  if (changeApprover) w.versions.find((x) => x.id === version.id)!.changeApprover = changeApprover as never;
  return { fw: framework.id, v: version.id };
}
async function pend(w: W, params: { changeApprover?: string } = {}, by = u1) {
  const { fw, v } = await draft(w, params, by);
  const r = await w.service.requestActivation(by, fw, v, "motif", R);
  return { fw, v, r: r.id };
}
/** A Dispositif with an ACTIVE v1 (requested by u1, approved by u2). */
async function live(w: W, params: { changeApprover?: string } = {}) {
  const p = await pend(w, params);
  await w.service.approve(u2, p.r, undefined, R);
  return p;
}
const verOf = (w: W, id: string) => w.versions.find((v) => v.id === id)!;
const reqOf = (w: W, id: string) => w.requests.find((r) => r.id === id)!;
const evTypes = (w: W) => w.events.map((e) => `${e.entityType}:${e.action}`);

// ===================================================================================================
// Part 1: q100 (spec 5.4.1) through the service, with the fallback cause persisted by the fake repository.
// ===================================================================================================
describe("QA-B6d q100: legacy Committee/Audit approver folded into the Risk Manager fallback", () => {
  async function under(approver: "COMMITTEE" | "AUDIT" | "AUDIT_AND_COMMITTEE", o: Opts) {
    const w = world({ rm: ["u1", "u2", "u3"], ...o });
    const p = await live(w, { changeApprover: approver });
    const d = await w.service.createDraft(u1, p.fw, undefined, R);
    const r2 = await w.service.requestActivation(u1, p.fw, d.id, "v2", R);
    return { w, fw: p.fw, v1: p.v, v2: d.id, r2: r2.id };
  }

  it("approve: request stores FALLBACK + PENDING ratification + cause, the version audit names the cause and the bypassed group, comment is stored", async () => {
    const { w, r2, v2 } = await under("COMMITTEE", { committee: ["c1", "c2"] });
    w.events.length = 0;
    const out = await w.service.approve(u2, r2, "pas de vote avant B-12", R);
    expect(out.request).toMatchObject({ status: "APPROVED", decisionRegime: "FALLBACK", deciderGroup: "RISK_MANAGER", ratificationStatus: "PENDING", fallbackCause: "LEGACY_APPROVER_PRE_B12", decisionComment: "pas de vote avant B-12", decidedBy: "u2" });
    expect(verOf(w, v2).status).toBe("ACTIVE");
    const v = w.events.find((e) => e.entityType === "RiskFrameworkVersion" && e.action === "STATUS_CHANGE")!;
    expect(v.newValue).toMatchObject({ decisionRegime: "FALLBACK", fallbackCause: "LEGACY_APPROVER_PRE_B12", bypassedGroups: ["COMMITTEE"] });
    expect(v.reason).toBe("pas de vote avant B-12");
    expect(evTypes(w)).toContain("RiskFrameworkChangeRequest:APPROVE");
  });

  it("reject: the REJECT audit and the stored request carry the cause too; the version goes back to DRAFT", async () => {
    const { w, r2, v2 } = await under("AUDIT", { audit: ["a1", "a2"] });
    w.events.length = 0;
    const out = await w.service.reject(u2, r2, "non conforme", R);
    expect(out.request).toMatchObject({ status: "REJECTED", decisionRegime: "FALLBACK", ratificationStatus: "PENDING", fallbackCause: "LEGACY_APPROVER_PRE_B12" });
    expect(verOf(w, v2).status).toBe("DRAFT");
    expect(w.events.find((e) => e.action === "REJECT")!.newValue).toMatchObject({ fallbackCause: "LEGACY_APPROVER_PRE_B12" });
  });

  it("AUDIT_AND_COMMITTEE with both groups of 2: both are named as bypassed and each of Audit/Committee members gets ONE notice, no duplicate", async () => {
    const { w, r2 } = await under("AUDIT_AND_COMMITTEE", { audit: ["a1", "a2"], committee: ["c1", "c2"] });
    w.sent.length = 0;
    w.events.length = 0;
    await w.service.approve(u2, r2, "repli", R);
    const to = w.sent.filter((n) => n.eventType === "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE").map((n) => n.recipientUserId).sort();
    expect(to).toEqual(["a1", "a2", "c1", "c2"]);
    const v = w.events.find((e) => e.entityType === "RiskFrameworkVersion" && e.action === "STATUS_CHANGE")!;
    expect((v.newValue as { bypassedGroups: string[] }).bypassedGroups.sort()).toEqual(["AUDIT", "COMMITTEE"]);
  });

  it("no cause when nothing was folded: RISK_MANAGER approver (NORMAL) and a genuine empty-group fallback", async () => {
    const w = world({ rm: ["u1", "u2", "u3"] });
    const p = await pend(w);
    const normal = await w.service.approve(u2, p.r, undefined, R);
    expect(normal.request).toMatchObject({ decisionRegime: "NORMAL", ratificationStatus: null, fallbackCause: null });
    const { w: w2, r2 } = await under("COMMITTEE", { committee: ["c1"] }); // one member only: q72, no vote, plain fallback
    const out = await w2.service.approve(u2, r2, "repli", R);
    expect(out.request).toMatchObject({ decisionRegime: "FALLBACK", ratificationStatus: "PENDING", fallbackCause: null });
    const v = w2.events.filter((e) => e.entityType === "RiskFrameworkVersion" && e.action === "STATUS_CHANGE").at(-1)!;
    expect(v.newValue).not.toHaveProperty("fallbackCause");
  });

  it("the fold never turns a Committee/Audit member into a decider: only a third-party Risk Manager can decide, the sole RM requester cannot (NO_DECIDER)", async () => {
    const w = world({ rm: ["u1", "u2"], committee: ["c1", "c2"] });
    const p = await live(w, { changeApprover: "COMMITTEE" });
    w.groups[T1]!.RISK_MANAGER = ["u1"]; // u2 left
    const d = await w.service.createDraft(u1, p.fw, undefined, R);
    w.sent.length = 0;
    const r2 = await w.service.requestActivation(u1, p.fw, d.id, "v2", R);
    expect(w.sent.map((s) => s.eventType)).toContain("RISK_FRAMEWORK_NO_DECIDER");
    const before = w.snapshot();
    await expect(w.service.approve(u1, r2.id, "x", R)).rejects.toThrow(ForbiddenError); // requester
    await expect(w.service.approve(actor("c1"), r2.id, "x", R)).rejects.toThrow(ForbiddenError); // holds riskframework.activate but is not a Risk Manager
    await expect(w.service.reject(actor("c2"), r2.id, "x", R)).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    expect(reqOf(w, r2.id).status).toBe("PENDING");
  });

  it("a request created before the fix that switches self-proposal on: approve is refused (q65/q92), reject and withdraw stay possible", async () => {
    const mk = async () => {
      const { w, r2, v2 } = await under("COMMITTEE", { committee: ["c1", "c2"] });
      verOf(w, v2).selfProposalAllowed = true; // legacy row, impossible to create through the service now
      return { w, r2, v2 };
    };
    const a = await mk();
    const before = a.w.snapshot();
    await expect(a.w.service.approve(u2, a.r2, "x", R)).rejects.toThrow(/auto-proposition/);
    expect(a.w.snapshot()).toBe(before);
    await expect(a.w.service.reject(u2, a.r2, "non", R)).resolves.toMatchObject({ request: { status: "REJECTED", fallbackCause: "LEGACY_APPROVER_PRE_B12" } });
    const b = await mk();
    await expect(b.w.service.withdraw(u1, b.r2, "retrait", R)).resolves.toBeDefined();
  });

  it("every rule of the ordinary activation still applies to the folded decision (comment mandatory, nothing written without it; requester refused)", async () => {
    const { w, r2 } = await under("COMMITTEE", { committee: ["c1", "c2"] });
    const before = w.snapshot();
    for (const c of [undefined, "", "   "]) await expect(w.service.approve(u2, r2, c, R)).rejects.toThrow(ValidationError);
    await expect(w.service.approve(u1, r2, "x", R)).rejects.toThrow(ForbiddenError);
    expect(w.snapshot()).toBe(before);
    await w.service.approve(u2, r2, "ok", R);
    await expect(w.service.approve(u3, r2, "again", R)).rejects.toThrow(ConflictError); // double approval
  });
});

// ===================================================================================================
// Part 2: bootstrap (spec 5.6) at service level, I-D8, I-D9.
// ===================================================================================================
// PostgreSQL compares uuids case-insensitively: listForUser below lower-cases like it.
const brole = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role => ({
  id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});
const blevel = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const bscale = (): RatingScale => ({
  id: "s1", tenantId: "t1", name: "s1", version: "1", status: "DRAFT",
  probabilityLevels: 5, probabilityLabels: blevel(5), impactLevels: 5, impactLabels: blevel(5),
  criticalityThresholds: [{ label: "Faible", min: 1, max: 4 }, { label: "Élevé", min: 5, max: 25 }] as never,
  impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: blevel(5) }], retainedImpactRule: "MAX" },
  velocityLevels: null, persistenceLevels: null, masteryScale: null, activatedAt: null, archivedAt: null,
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
});
const bactor = (userId: string): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: ["riskframework.activate", "riskframework.read"] }) as AuthenticatedUser;
const BU1 = bactor("u1");
const BISO = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const BGOOD = (over: Record<string, unknown> = {}) => ({
  comment: "Aucun second membre disponible",
  justification: { askedUserId: "adm", askedOn: BISO(-1), outcome: "L'administrateur n'a pas pu désigner de second membre.", ...over },
});

function bworld(o: { facts?: Partial<BootstrapFacts>; audit?: string[]; committee?: string[]; versionOver?: Partial<RiskFrameworkVersion> } = {}, Svc: typeof RiskFrameworkService = RiskFrameworkService) {
  const facts: BootstrapFacts = {
    endedAt: null, activeMembers: { RISK_MANAGER: 1, COMMITTEE: o.committee?.length ?? 0, AUDIT: o.audit?.length ?? 0 },
    requesterIsActiveRiskManager: true, firstActivationOfTenant: true, ...o.facts,
  };
  const version = {
    id: "v1", tenantId: "t1", frameworkId: "fw1", versionNumber: 1, status: "PENDING_APPROVAL", ratingScaleId: "s1",
    defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, committeeTreatmentMinScore: 20,
    appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 8, description: null }],
    changeApprover: "RISK_MANAGER", selfProposalAllowed: false, lowCriticalityThreshold: 6, riskOwnerExecutorCumulAllowed: true,
    delegateExecutorCumulAllowed: true, delegationMaxDays: 30, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
    committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u1", lastEditedBy: "u1", createdAt: new Date(), updatedAt: new Date(),
    activatedAt: null, activationRequestId: null, archivedAt: null, archivedBy: null, archiveReason: null, ...o.versionOver,
  } as RiskFrameworkVersion;
  const request = {
    id: "r1", tenantId: "t1", kind: "ACTIVATE_VERSION", frameworkId: "fw1", versionId: "v1", processId: null, previousValue: null, reason: "go",
    status: "PENDING", requestedBy: "u1", createdAt: new Date(), decidedBy: null, decidedAt: null, decisionComment: null, decisionRegime: null,
    deciderGroup: null, ratificationStatus: null, fallbackCause: null, bootstrapJustification: null,
  } as RiskFrameworkChangeRequest;
  const written: Array<{ entityType: string; action: string; newValue: unknown }> = [];
  const stored = { calls: 0, listFilter: undefined as unknown };
  const repo = {
    auditsInTransaction: true,
    async getRequest() { return request; },
    async getVersion() { return version; },
    async listRequests(_t: string, filter?: unknown) { stored.listFilter = filter; return [request]; },
    async recordBootstrapDecision(_t: string, _id: string, d: { decidedBy: string; comment: string; justification: unknown }, validate: (f: BootstrapFacts) => Promise<void>, audit: (r: DecisionResult) => never[]) {
      await validate(facts);
      stored.calls++;
      Object.assign(request, { status: "APPROVED", decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: "BOOTSTRAP", deciderGroup: "RISK_MANAGER",
        ratificationStatus: null, fallbackCause: null, bootstrapJustification: d.justification });
      version.status = "ACTIVE";
      const result = { request, version, previousActive: null };
      written.push(...(audit(result) as never[]));
      return result;
    },
  };
  const held: Record<string, Role[]> = {
    u1: [brole("rm", "RISK_MANAGER", ["riskframework.activate"])],
    adm: [brole("adm", null, ["role.assign"])],
    plain: [brole("plain", null, ["risk.read"])],
  };
  const groups: Record<string, string[]> = { AUDIT: o.audit ?? [], RISK_COMMITTEE: o.committee ?? [], RISK_MANAGER: ["u1"] };
  const roles = (["RISK_MANAGER", "AUDIT", "RISK_COMMITTEE"] as const).map((g) => brole(g, g, []));
  const roleRepo = {
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return held[u.toLowerCase()] ?? []; },
    async listActiveGrants(_t: string, u: string) { return (held[u.toLowerCase()] ?? []).map((r) => ({ role: r, grantedBy: "other", grantedAt: new Date("2020-01-01T00:00:00Z") })); },
    async listAssignments(_t: string, id: string) { return (groups[id] ?? []).map((userId) => ({ userId, roleId: id, revokedAt: null })); },
  };
  // (users.getById returns the canonical lower-case uuid, like PostgreSQL)
  const users = {
    async getById(_t: string, id: string) { return id === "ghost" || id === "gone" ? (id === "gone" ? { id, deletedAt: new Date() } : null) : { id: id.toLowerCase(), deletedAt: null }; },
    async listWithPermission() { return []; },
  };
  const sent: Array<{ recipientUserId: string; eventType: string; message: string }> = [];
  const notifications = { async record(i: { recipientUserId: string; eventType: string; message: string }) { sent.push(i); } };
  const audit = { async record() {}, async listForEntity() { return []; } };
  const scales = { async getById() { return bscale(); } };
  const service = new Svc(repo as never, scales as never, roleRepo as never, users as never, audit as never, undefined, notifications as never);
  return { service, request, version, written, sent, stored, held };
}

describe("QA-B6d bootstrap: scope, replay, atomic refusal", () => {
  it("a second bootstrap-approve on the same request is a 409 and writes / notifies nothing more", async () => {
    const w = bworld({ audit: ["a1"] });
    await w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req");
    const audits = w.written.length;
    const notices = w.sent.length;
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(ConflictError);
    expect([w.written.length, w.sent.length, w.stored.calls]).toEqual([audits, notices, 1]);
  });

  it.each(["SET_DEFAULT", "ASSIGN_PROCESS"] as const)("q81: a %s request is out of scope, refused, nothing written", async (kind) => {
    const w = bworld({ audit: ["a1"] });
    (w.request as { kind: string }).kind = kind;
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(ValidationError);
    expect([w.stored.calls, w.written.length, w.sent.length]).toEqual([0, 0, 0]);
  });

  it("every refusal leaves no audit line and no notice (Audit/Committee are told only of decisions that exist)", async () => {
    for (const w of [
      bworld({ audit: ["a1"], facts: { endedAt: new Date() } }),
      bworld({ audit: ["a1", "a2"] }),
      bworld({ audit: ["a1"], facts: { firstActivationOfTenant: false } }),
      bworld({ audit: ["a1"], versionOver: { hybridPolicyEnabled: true } }),
    ]) {
      await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(ValidationError);
      expect([w.stored.calls, w.written.length, w.sent.length]).toEqual([0, 0, 0]);
    }
  });

  it("the requester stopped being the active Risk Manager when the lock was taken: 403, nothing written", async () => {
    const w = bworld({ audit: ["a1"], facts: { requesterIsActiveRiskManager: false, activeMembers: { RISK_MANAGER: 0, COMMITTEE: 0, AUDIT: 1 } } });
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(ForbiddenError);
    expect(w.written).toEqual([]);
  });

  it("q65: switching self-proposal on is refused with the Committee-vote message, before the contract-defaults message", async () => {
    const w = bworld({ versionOver: { selfProposalAllowed: true } });
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(/vote du Comité/);
  });

  it("the ordinary approve never takes the bootstrap path even when the bootstrap would be allowed (sole RM, own request)", async () => {
    const w = bworld({ audit: ["a1"] });
    await expect(w.service.approve(BU1, "r1", "x", "req")).rejects.toThrow(ForbiddenError);
    expect(w.stored.calls).toBe(0);
  });

  it("I-D8: the frozen values come from the version, not from the body (a body carrying freeParameters is refused by zod; the service ignores extras)", async () => {
    const w = bworld({ versionOver: { lowCriticalityThreshold: 7, delegationMaxDays: 12 } });
    const body = BGOOD() as { comment: string; justification: Record<string, unknown> };
    body.justification["freeParameters"] = { scaleSize: 99, lowCriticalityThreshold: 1 };
    const out = await w.service.bootstrapApprove(BU1, "r1", body as never, "req");
    expect(out.request.bootstrapJustification!.freeParameters).toMatchObject({ scaleSize: 5, lowCriticalityThreshold: 7, delegationMaxDays: 12 });
    expect(Object.keys(out.request.bootstrapJustification!).sort()).toEqual(["askedOn", "askedUserId", "deciderAlsoAdministrator", "freeParameters", "outcome"]);
  });
});

describe("QA-B6d contract defaults (q98) stay coherent with the scale defaults of the rest of the code", () => {
  it.each([3, 4, 5, 6])("committeeEvaluationMinScore default for an n = %i square scale equals defaultCommitteeThreshold(n*n)", (n) => {
    expect(Math.floor((n * n * 15) / 25)).toBe(defaultCommitteeThreshold(n * n));
    const v = { ...DEFAULT_CONTRACT_PARAMS, defaultEvaluationMode: "CLASSIQUE", committeeEvaluationEnforced: true, changeApprover: "RISK_MANAGER", selfProposalAllowed: false, committeeEvaluationMinScore: defaultCommitteeThreshold(n * n) } as never;
    expect(contractDefaultViolations(v, n)).toEqual([]);
  });
});

describe("QA-B6d I-D9: the self-designated asked administrator", () => {
  const adminRole = () => brole("rm-admin", null, ["role.assign"]);

  it("default (constant false): the requester is refused even when they hold an administrator permission", async () => {
    const w = bworld();
    w.held["u1"]!.push(adminRole());
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "u1" }), "req")).rejects.toThrow(/vous désigner vous-même/);
    expect(w.stored.calls).toBe(0);
  });

  it("flipping BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF to true is enough: a cumulating requester may name themselves, the other checks stay", async () => {
    vi.resetModules();
    vi.doMock("../src/domain/frameworkApproval.js", async (orig) => ({ ...(await orig<typeof import("../src/domain/frameworkApproval.js")>()), BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF: true }));
    try {
      const { RiskFrameworkService: Flipped } = await import("../src/services/RiskFrameworkService.js");
      expect(Flipped).not.toBe(RiskFrameworkService);
      const w = bworld({}, Flipped);
      w.held["u1"]!.push(adminRole());
      const out = await w.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "u1" }), "req");
      expect(out.request.bootstrapJustification).toMatchObject({ askedUserId: "u1" });
      // still refused for a requester who is NOT an administrator, for a future date, and for a blank outcome
      const w2 = bworld({}, Flipped);
      await expect(w2.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "u1" }), "req")).rejects.toThrow(/pas administrateur/);
      await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "u1", askedOn: BISO(3) }), "req")).rejects.toThrow();
    } finally {
      vi.doUnmock("../src/domain/frameworkApproval.js");
      vi.resetModules();
    }
  });

  it("the constant is read in exactly one place of the service (nothing else keys off I-D9)", () => {
    const src = readFileSync("src/services/RiskFrameworkService.ts", "utf8");
    expect(src.match(/BOOTSTRAP_ASKED_ADMIN_MAY_BE_SELF/g)).toHaveLength(2); // import + the single test in checkDeclaration
  });

  // QA-B6d-01. Id = z.guid() accepts UPPER-CASE hex, PostgreSQL resolves it to the same user and roles, and the
  // service compares `askedUserId === actor.userId` as text. The rule can be sidestepped by upper-casing the id.
  it("QA-B6d-01: the requester naming themselves with the UPPER-CASE form of their own id is refused like the lower-case form", async () => {
    const w = bworld();
    w.held["u1"]!.push(adminRole());
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "U1" }), "req")).rejects.toThrow(/vous désigner vous-même/);
  });

  // Retest B-6d (F-B6d-01): fail-closed when the repository cannot say who granted the administrator right.
  it("F-B6d-01 retest: without listActiveGrants the declaration is refused (fail-closed), nothing written", async () => {
    const w = bworld({ audit: ["a1"] });
    (w.service as unknown as { roles: Record<string, unknown> }).roles["listActiveGrants"] = undefined;
    await expect(w.service.bootstrapApprove(BU1, "r1", BGOOD(), "req")).rejects.toThrow(/not available/);
    expect([w.stored.calls, w.written.length, w.sent.length]).toEqual([0, 0, 0]);
  });

  it("QA-B6d-01 retest: an upper-case id of ANOTHER admin is accepted and stored in canonical lower-case form", async () => {
    const w = bworld({ audit: ["a1"] });
    const out = await w.service.bootstrapApprove(BU1, "r1", BGOOD({ askedUserId: "ADM" }), "req");
    expect(out.request.bootstrapJustification!.askedUserId).toBe("adm");
  });

  it("QA-B6d-01 reachability: the HTTP route lets an UPPER-CASE askedUserId through to the service unchanged", async () => {
    let seen: unknown = null;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = BU1; (req as never as { requestId: string }).requestId = "r"; next(); });
    app.use("/rf", riskFrameworksRouter({ bootstrapApprove: async (_a: unknown, _id: string, body: unknown) => { seen = body; return {}; } } as never));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const id = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
      const res = await fetch(`http://127.0.0.1:${port}/rf/change-requests/${id}/bootstrap-approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ comment: "c", justification: { askedUserId: id, askedOn: "2026-10-01", outcome: "x" } }),
      });
      expect(res.status).toBe(200);
      expect((seen as { justification: { askedUserId: string } }).justification.askedUserId).toBe(id);
    } finally { server.close(); }
  });
});

describe("QA-B6d HTTP access control of the bootstrap routes", () => {
  async function http(w: ReturnType<typeof bworld>, as: AuthenticatedUser, method: string, path: string, body?: unknown) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: unknown }).user = as; (req as never as { requestId: string }).requestId = "r"; next(); });
    app.use("/rf", riskFrameworksRouter(w.service));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/rf${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: await res.json().catch(() => null) as any };
    } finally { server.close(); }
  }
  const RID = "11111111-1111-4111-8111-111111111111";
  const body = { comment: "c", justification: { askedUserId: "99999999-9999-4999-8999-999999999999", askedOn: "2026-10-01", outcome: "x" } };

  it("without riskframework.activate: 403 and no write; the same user may still read the regime list only with riskframework.read", async () => {
    const w = bworld({ audit: ["a1"] });
    const readOnly = { ...BU1, roles: ["riskframework.read"] } as AuthenticatedUser;
    expect((await http(w, readOnly, "POST", `/change-requests/${RID}/bootstrap-approve`, body)).status).toBe(403);
    expect(w.stored.calls).toBe(0);
    expect((await http(w, readOnly, "GET", "/change-requests?regime=BOOTSTRAP")).status).toBe(200);
    const none = { ...BU1, roles: [] } as unknown as AuthenticatedUser;
    expect((await http(w, none, "GET", "/change-requests?regime=BOOTSTRAP")).status).toBe(403);
    expect((await http(w, none, "POST", `/change-requests/${RID}/bootstrap-approve`, body)).status).toBe(403);
  });

  it("a malformed request id is a 400, regime outside the enum is a 400 (never reaches the repository)", async () => {
    const w = bworld({ audit: ["a1"] });
    expect((await http(w, BU1, "POST", "/change-requests/not-an-id/bootstrap-approve", body)).status).toBe(400);
    expect((await http(w, BU1, "GET", "/change-requests?regime=DROP")).status).toBe(400);
    expect(w.stored.listFilter).toBeUndefined();
  });
});
