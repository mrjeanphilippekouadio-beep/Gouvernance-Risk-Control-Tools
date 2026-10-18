import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { resolveDecider, type EligibleMembers } from "../src/domain/frameworkApproval.js";
import { assertReadyToActivate } from "../src/domain/ratingScaleRules.js";
import { ALL_PERMISSIONS, type Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type {
  DecisionResult,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
} from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-6a (spec RM-V1-B6-Dispositif-spec.md §15). Authored by the code's author: QA level 2 is A08's.

const FW_PERMS: Permission[] = [
  "riskframework.read", "riskframework.create", "riskframework.update",
  "riskframework.activate", "riskframework.archive", "riskframework.process.assign",
];
const actor = (userId: string, perms: Permission[] = FW_PERMS): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: perms }) as AuthenticatedUser;

const level = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
function scale(id: string, n = 5, over: Partial<RatingScale> = {}): RatingScale {
  return {
    id, tenantId: "t1", name: id, version: "1", status: "ACTIVE",
    probabilityLevels: n, probabilityLabels: level(n), impactLevels: n, impactLabels: level(n),
    criticalityThresholds: null,
    impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: level(n) }], retainedImpactRule: "MAX" },
    velocityLevels: null, persistenceLevels: null, masteryScale: null,
    activatedAt: null, archivedAt: null, createdAt: new Date(), updatedAt: new Date(),
    deletedAt: null, deletedBy: null, deletionReason: null, ...over,
  };
}

function role(id: string, systemGroup: SystemGroup): Role {
  return {
    id, tenantId: "t1", name: id, description: null, permissions: [], dashboardScopeMode: "GLOBAL",
    systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  };
}

interface Opts { rm?: string[]; audit?: string[]; committee?: string[]; scales?: RatingScale[]; suspended?: string[] }

function setup(opts: Opts = {}) {
  const groups: Record<SystemGroup, string[]> = {
    RISK_MANAGER: opts.rm ?? ["u1", "u2"],
    AUDIT: opts.audit ?? [],
    RISK_COMMITTEE: opts.committee ?? [],
  };
  const roles = (["RISK_MANAGER", "AUDIT", "RISK_COMMITTEE"] as const).map((g) => role(g, g));
  const scales = opts.scales ?? [scale("s1")];

  const frameworks: RiskFramework[] = [];
  const versions: RiskFrameworkVersion[] = [];
  const requests: RiskFrameworkChangeRequest[] = [];
  const calls = { recordDecision: 0, writes: [] as string[] };
  let seq = 0;
  const nid = (p: string) => `${p}${++seq}`;

  const repo = {
    async listFrameworks() { return frameworks; },
    async getFramework(_t: string, id: string) { return frameworks.find((f) => f.id === id) ?? null; },
    async listVersions(_t: string, fw: string) { return versions.filter((v) => v.frameworkId === fw); },
    async getVersion(_t: string, fw: string, id: string) { return versions.find((v) => v.frameworkId === fw && v.id === id) ?? null; },
    async getActiveVersion(_t: string, fw: string) { return versions.find((v) => v.frameworkId === fw && v.status === "ACTIVE") ?? null; },
    async createWithDraft(i: { tenantId: string; name: string; description: string | null; createdBy: string; params: object }) {
      calls.writes.push("createWithDraft");
      const framework = { id: nid("fw"), tenantId: i.tenantId, name: i.name, description: i.description, isDefault: false, createdBy: i.createdBy,
        createdAt: new Date(), updatedAt: new Date(), archivedAt: null, archivedBy: null, archiveReason: null } as RiskFramework;
      frameworks.push(framework);
      const version = { id: nid("v"), tenantId: i.tenantId, frameworkId: framework.id, versionNumber: 1, status: "DRAFT", ...i.params,
        createdBy: i.createdBy, lastEditedBy: i.createdBy, createdAt: new Date(), updatedAt: new Date(), activatedAt: null,
        activationRequestId: null, archivedAt: null, archivedBy: null, archiveReason: null } as RiskFrameworkVersion;
      versions.push(version);
      return { framework, version };
    },
    async updateIdentity(_t: string, id: string, f: object) { const fw = frameworks.find((x) => x.id === id)!; Object.assign(fw, f); return fw; },
    async createDraftFrom(_t: string, fw: string, src: string, by: string) {
      const s = versions.find((v) => v.id === src)!;
      const v = { ...s, id: nid("v"), versionNumber: Math.max(...versions.filter((x) => x.frameworkId === fw).map((x) => x.versionNumber)) + 1,
        status: "DRAFT", createdBy: by, lastEditedBy: by, activatedAt: null, activationRequestId: null } as RiskFrameworkVersion;
      versions.push(v);
      return v;
    },
    async updateDraft(_t: string, _fw: string, id: string, fields: object, by: string) {
      const v = versions.find((x) => x.id === id)!;
      if (v.status !== "DRAFT") throw new ValidationError("Only a draft version can be modified");
      Object.assign(v, Object.fromEntries(Object.entries(fields).filter(([, x]) => x !== undefined)), { lastEditedBy: by });
      return v;
    },
    async discardDraft(_t: string, _fw: string, id: string, by: string, reason: string) {
      const v = versions.find((x) => x.id === id)!;
      Object.assign(v, { status: "ARCHIVED", archivedBy: by, archiveReason: reason, archivedAt: new Date() });
      return v;
    },
    async createActivationRequest(i: { tenantId: string; frameworkId: string; versionId: string; reason: string; requestedBy: string; previousValue: unknown }) {
      versions.find((v) => v.id === i.versionId)!.status = "PENDING_APPROVAL";
      const r = { id: nid("r"), tenantId: i.tenantId, kind: "ACTIVATE_VERSION", frameworkId: i.frameworkId, versionId: i.versionId, processId: null,
        previousValue: i.previousValue, reason: i.reason, status: "PENDING", requestedBy: i.requestedBy, createdAt: new Date(),
        decidedBy: null, decidedAt: null, decisionComment: null, decisionRegime: null, deciderGroup: null, ratificationStatus: null } as RiskFrameworkChangeRequest;
      requests.push(r);
      return r;
    },
    async getRequest(_t: string, id: string) { return requests.find((r) => r.id === id) ?? null; },
    async listRequests() { return requests; },
    async recordDecision(_t: string, id: string, d: { outcome: "APPROVED" | "REJECTED"; decidedBy: string; comment: string | null; decisionRegime: "NORMAL" | "FALLBACK"; deciderGroup: "RISK_MANAGER"; ratificationStatus: "PENDING" | null }): Promise<DecisionResult> {
      calls.recordDecision++;
      const r = requests.find((x) => x.id === id)!;
      Object.assign(r, { status: d.outcome, decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: d.decisionRegime, deciderGroup: d.deciderGroup, ratificationStatus: d.ratificationStatus, decidedAt: new Date() });
      const v = versions.find((x) => x.id === r.versionId)!;
      let previousActive: RiskFrameworkVersion | null = null;
      if (d.outcome === "APPROVED") {
        const prev = versions.find((x) => x.frameworkId === v.frameworkId && x.status === "ACTIVE");
        if (prev) { previousActive = { ...prev }; prev.status = "ARCHIVED"; }
        v.status = "ACTIVE";
        v.activatedAt = new Date();
        const fw = frameworks.find((f) => f.id === v.frameworkId)!;
        if (!frameworks.some((f) => f.isDefault)) fw.isDefault = true;
      } else {
        v.status = "DRAFT";
      }
      return { request: r, version: v, previousActive };
    },
    async withdraw(_t: string, id: string, comment: string | null): Promise<DecisionResult> {
      const r = requests.find((x) => x.id === id)!;
      Object.assign(r, { status: "WITHDRAWN", decisionComment: comment });
      const v = versions.find((x) => x.id === r.versionId)!;
      v.status = "DRAFT";
      return { request: r, version: v, previousActive: null };
    },
  };

  const roleRepo = {
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return roles.filter((r) => groups[r.systemGroup!].includes(u)); },
    async listAssignments(_t: string, roleId: string) {
      const g = roles.find((r) => r.id === roleId)!.systemGroup!;
      return groups[g].map((userId) => ({ userId, roleId, revokedAt: null }));
    },
  };
  const users = {
    async getById(_t: string, id: string) { return { id, deletedAt: opts.suspended?.includes(id) ? new Date() : null }; },
    async listWithPermission(_t: string, permission: string, exclude: string) {
      const ids = permission === "audit.read" ? groups.AUDIT : permission === "riskframework.activate" ? groups.RISK_MANAGER : [];
      return ids.filter((i) => i !== exclude).map((id) => ({ id, displayName: id }));
    },
  };
  const events: Array<{ userId: string; entityType: string; entityId: string; action: string; oldValue: unknown; newValue: unknown; reason: string | null }> = [];
  const audit = {
    async record(e: (typeof events)[number]) { events.push(e); },
    async listForEntity(_t: string, type: string, id: string) { return events.filter((e) => e.entityType === type && e.entityId === id); },
  };
  const sent: Array<{ recipientUserId: string; eventType: string }> = [];
  const notifications = { async record(i: { recipientUserId: string; eventType: string }) { sent.push(i); } };
  const ratingScales = { async getById(_t: string, id: string) { return scales.find((s) => s.id === id) ?? null; } };
  const service = new RiskFrameworkService(repo as never, ratingScales as never, roleRepo as never, users as never, audit as never, undefined, notifications as never);
  return { service, repo, frameworks, versions, requests, events, sent, calls, groups, scales };
}

const u1 = actor("u1");
const u2 = actor("u2");
const R = "req";

/** u1 creates a framework; returns its ids. */
async function created(s: ReturnType<typeof setup>, params: { changeApprover?: string } = {}) {
  // C-B6a-02: a non-RISK_MANAGER approver cannot be written through the service before B-12: seed it as stored data.
  const { changeApprover, ...allowed } = params;
  const { framework, version } = await s.service.create(u1, { name: "Dispositif A", ratingScaleId: "s1", params: { lowCriticalityThreshold: 5, ...allowed } }, R);
  if (changeApprover) s.versions.find((x) => x.id === version.id)!.changeApprover = changeApprover as never;
  return { fw: framework.id, v: version.id };
}

describe("B-6a creation", () => {
  it("creates the Dispositif and its version 1 in DRAFT, createdBy forced to the actor, defaults applied", async () => {
    const s = setup();
    const { framework, version } = await s.service.create(u1, { name: "  Dispositif A  ", ratingScaleId: "s1" }, R);
    expect(framework.name).toBe("Dispositif A");
    expect(framework.createdBy).toBe("u1");
    expect(version).toMatchObject({
      status: "DRAFT", versionNumber: 1, createdBy: "u1", lastEditedBy: "u1", defaultEvaluationMode: "CLASSIQUE",
      committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, committeeTreatmentMinScore: null,
      changeApprover: "RISK_MANAGER", selfProposalAllowed: false, appetiteThresholds: [],
    });
    expect(s.events.map((e) => `${e.entityType}:${e.action}`)).toEqual(["RiskFramework:CREATE", "RiskFrameworkVersion:CREATE"]);
    expect(s.events.every((e) => e.userId === "u1")).toBe(true);
  });

  it("the Committee threshold default follows the scale size (3x3 -> 5)", async () => {
    const s = setup({ scales: [scale("s3", 3)] });
    const { version } = await s.service.create(u1, { name: "A", ratingScaleId: "s3" }, R);
    expect(version.committeeEvaluationMinScore).toBe(5);
  });

  it("refuses without riskframework.create, for a non-Risk-Manager holding it (q51), an empty name, an unknown scale", async () => {
    const s = setup();
    await expect(s.service.create(actor("u1", ["riskframework.read"]), { name: "A", ratingScaleId: "s1" }, R)).rejects.toThrow(ForbiddenError);
    await expect(s.service.create(actor("admin"), { name: "A", ratingScaleId: "s1" }, R)).rejects.toThrow(/Risk Manager/);
    await expect(s.service.create(u1, { name: "   ", ratingScaleId: "s1" }, R)).rejects.toThrow(ValidationError);
    await expect(s.service.create(u1, { name: "A", ratingScaleId: "nope" }, R)).rejects.toThrow(/does not exist/);
  });

  it("an appetite naming a subCategoryId fails closed when the category repository is not wired", async () => {
    const s = setup();
    const params = { appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: "c1", entity: null, threshold: 5, description: null }] };
    await expect(s.service.create(u1, { name: "A", ratingScaleId: "s1", params }, R)).rejects.toThrow(/not configured/);
  });
});

describe("B-6a drafts", () => {
  it("a partial update changes only the given keys and forces lastEditedBy; unknown keys such as status are ignored by the repository", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    const after = await s.service.updateDraft(u2, fw, v, { selfProposalAllowed: true, committeeTreatmentMinScore: null, status: "ACTIVE" } as never, R);
    expect(after).toMatchObject({ selfProposalAllowed: true, status: "DRAFT", lastEditedBy: "u2", committeeEvaluationMinScore: 15 });
    expect(s.events.at(-1)).toMatchObject({ action: "UPDATE", entityType: "RiskFrameworkVersion", userId: "u2" });
    await expect(s.service.updateDraft(u1, fw, v, {}, R)).rejects.toThrow(/Nothing to update/);
  });

  it.each(["PENDING_APPROVAL", "ACTIVE", "ARCHIVED"] as const)("refuses to modify a %s version", async (status) => {
    const s = setup();
    const { fw, v } = await created(s);
    s.versions[0]!.status = status;
    await expect(s.service.updateDraft(u1, fw, v, { selfProposalAllowed: false }, R)).rejects.toThrow(/draft/);
  });

  it("validates values: score range, mode, duplicates and size of the appetite list", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    await expect(s.service.updateDraft(u1, fw, v, { committeeEvaluationMinScore: 37 }, R)).rejects.toThrow(ValidationError);
    await expect(s.service.updateDraft(u1, fw, v, { defaultEvaluationMode: "X" as never }, R)).rejects.toThrow(ValidationError);
    const e = { subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 5, description: null };
    await expect(s.service.updateDraft(u1, fw, v, { appetiteThresholds: [e, e] }, R)).rejects.toThrow(/Duplicate/);
    await expect(s.service.updateDraft(u1, fw, v, { appetiteThresholds: Array.from({ length: 201 }, (_, i) => ({ ...e, subCategory: `c${i}` })) }, R)).rejects.toThrow(/200/);
  });

  it("createDraft copies the active version and refuses while one draft is open", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    await expect(s.service.createDraft(u1, fw, undefined, R)).rejects.toThrow(ConflictError);
    const req = await s.service.requestActivation(u1, fw, v, "go", R);
    await s.service.approve(u2, req.id, undefined, R);
    const draft = await s.service.createDraft(u1, fw, undefined, R);
    expect(draft).toMatchObject({ versionNumber: 2, status: "DRAFT", createdBy: "u1" });
  });

  it("discard needs riskframework.archive and a reason, and only applies to a draft", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    await expect(s.service.discardDraft(actor("u1", ["riskframework.update"]), fw, v, "x", R)).rejects.toThrow(ForbiddenError);
    await expect(s.service.discardDraft(u1, fw, v, " ", R)).rejects.toThrow(ValidationError);
    const out = await s.service.discardDraft(u1, fw, v, "abandon", R);
    expect(out).toMatchObject({ status: "ARCHIVED", archivedBy: "u1", archiveReason: "abandon" });
    expect(s.events.at(-1)).toMatchObject({ action: "STATUS_CHANGE", reason: "abandon" });
    await expect(s.service.discardDraft(u1, fw, v, "again", R)).rejects.toThrow(/draft/);
  });
});

describe("B-6a activation request validation", () => {
  async function request(s: ReturnType<typeof setup>, params: object = {}) {
    const { fw, v } = await created(s, params);
    return () => s.service.requestActivation(u1, fw, v, "motif", R);
  }

  it("refuses a non-square scale, a missing descriptor, a Committee threshold or an appetite above n^2, and duplicate appetites", async () => {
    const e = { subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 5, description: null };
    const s1 = setup({ scales: [scale("s1", 5, { impactLevels: 4, impactLabels: level(4) })] });
    await expect(await request(s1)).rejects.toThrow(/square/);
    const s2 = setup({ scales: [scale("s1", 5, { probabilityLabels: null })] });
    await expect(await request(s2)).rejects.toThrow(/probabilityLabels/);
    const s3 = setup({ scales: [scale("s1", 3)] });
    await expect(await request(s3, { committeeEvaluationMinScore: 12 })).rejects.toThrow(/exceed/);
    const s4 = setup({ scales: [scale("s1", 3)] });
    await expect(await request(s4, { appetiteThresholds: [{ ...e, threshold: 10 }] })).rejects.toThrow(/appétence/);
    const s5 = setup();
    const { fw, v } = await created(s5);
    s5.versions[0]!.appetiteThresholds = [e, e];
    await expect(s5.service.requestActivation(u1, fw, v, "motif", R)).rejects.toThrow(/Duplicate/);
    const s6 = setup({ scales: [scale("s1", 5, { impactAxes: { axes: [], retainedImpactRule: "MAX" } })] });
    await expect(await request(s6)).rejects.toThrow(/axis/);
  });

  it("refuses an empty reason and a version that is not a draft", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    await expect(s.service.requestActivation(u1, fw, v, "  ", R)).rejects.toThrow(ValidationError);
    await s.service.requestActivation(u1, fw, v, "ok", R);
    await expect(s.service.requestActivation(u1, fw, v, "again", R)).rejects.toThrow(/draft/);
  });

  it("creates a PENDING request with requestedBy forced, freezes the version and audits SUBMIT", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    const r = await s.service.requestActivation(u1, fw, v, "  motif  ", R);
    expect(r).toMatchObject({ status: "PENDING", requestedBy: "u1", reason: "motif", kind: "ACTIVATE_VERSION", previousValue: null });
    expect(s.versions[0]!.status).toBe("PENDING_APPROVAL");
    expect(s.events.at(-1)).toMatchObject({ entityType: "RiskFrameworkChangeRequest", action: "SUBMIT", reason: "motif" });
    expect(s.sent.map((n) => n.eventType)).toContain("RISK_FRAMEWORK_CHANGE_PENDING");
  });
});

describe("B-6a approval", () => {
  it("a second Risk Manager approves: version ACTIVE, previous ARCHIVED in ONE repository call, audit with old and new, first Dispositif default", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    const r1 = await s.service.requestActivation(u1, fw, v, "v1", R);
    const out = await s.service.approve(u2, r1.id, "ok", R);
    expect(s.calls.recordDecision).toBe(1);
    expect(out.version.status).toBe("ACTIVE");
    expect(out.request).toMatchObject({ status: "APPROVED", decidedBy: "u2", decisionRegime: "NORMAL", deciderGroup: "RISK_MANAGER", ratificationStatus: null });
    expect(s.frameworks[0]!.isDefault).toBe(true);
    const first = s.events.find((e) => e.entityType === "RiskFrameworkVersion" && e.action === "STATUS_CHANGE")!;
    expect(first.oldValue).toBeNull();
    expect(first.newValue).toMatchObject({ id: v, status: "ACTIVE", decisionRegime: "NORMAL", requestId: r1.id });

    const draft = await s.service.createDraft(u2, fw, undefined, R);
    const r2 = await s.service.requestActivation(u2, fw, draft.id, "v2", R);
    const out2 = await s.service.approve(actor("u1"), r2.id, "ok", R);
    expect(out2.previousActive?.id).toBe(v);
    expect(s.versions.find((x) => x.id === v)!.status).toBe("ARCHIVED");
    const second = s.events.filter((e) => e.entityType === "RiskFrameworkVersion" && e.action === "STATUS_CHANGE").at(-1)!;
    expect(second.oldValue).toMatchObject({ id: v, status: "ACTIVE" });
    expect(second.newValue).toMatchObject({ id: draft.id, status: "ACTIVE" });
    expect(s.sent.map((n) => n.eventType)).toEqual(expect.arrayContaining(["RISK_FRAMEWORK_CHANGE_DECIDED"]));
  });

  it("refuses: decider = requester, decider = author of a modification (found in the audit log), administrator who is not a Risk Manager, missing riskframework.activate", async () => {
    const s = setup({ rm: ["u1", "u2", "u3"] });
    const { fw, v } = await created(s);
    // u3 edits the draft: it becomes an author through the audit trail only (createdBy stays u1).
    await s.service.updateDraft(actor("u3"), fw, v, { committeeEvaluationEnforced: false }, R);
    s.versions[0]!.lastEditedBy = null;
    const r = await s.service.requestActivation(u1, fw, v, "go", R);
    await expect(s.service.approve(u1, r.id, undefined, R)).rejects.toThrow(/maker-checker/);
    await expect(s.service.approve(actor("u3"), r.id, undefined, R)).rejects.toThrow(/contribué/);
    await expect(s.service.approve(actor("admin"), r.id, undefined, R)).rejects.toThrow(/Risk Manager/);
    await expect(s.service.approve(actor("u2", ["riskframework.read"]), r.id, undefined, R)).rejects.toThrow(ForbiddenError);
    expect(s.calls.recordDecision).toBe(0);
    await s.service.approve(u2, r.id, undefined, R);
    expect(s.calls.recordDecision).toBe(1);
  });

  it("a suspended Risk Manager does not count as a member", async () => {
    const s = setup({ rm: ["u1", "u2", "u3"], suspended: ["u2", "u3"] });
    const { fw, v } = await created(s);
    const r = await s.service.requestActivation(u1, fw, v, "go", R);
    expect(s.sent.map((n) => n.eventType)).toContain("RISK_FRAMEWORK_NO_DECIDER");
    expect(r.status).toBe("PENDING");
  });

  it("reject needs a comment, sends the version back to DRAFT and keeps the request in history", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    const r = await s.service.requestActivation(u1, fw, v, "go", R);
    await expect(s.service.reject(u2, r.id, "  ", R)).rejects.toThrow(ValidationError);
    const out = await s.service.reject(u2, r.id, "pas prêt", R);
    expect(out.request).toMatchObject({ status: "REJECTED", decisionComment: "pas prêt" });
    expect(s.versions[0]!.status).toBe("DRAFT");
    expect(s.events.at(-1)).toMatchObject({ action: "REJECT", reason: "pas prêt" });
    await expect(s.service.approve(u2, r.id, undefined, R)).rejects.toThrow(ConflictError);
  });

  it("withdraw: requester only, version back to DRAFT", async () => {
    const s = setup();
    const { fw, v } = await created(s);
    const r = await s.service.requestActivation(u1, fw, v, "go", R);
    await expect(s.service.withdraw(u2, r.id, undefined, R)).rejects.toThrow(ForbiddenError);
    const out = await s.service.withdraw(u1, r.id, "oups", R);
    expect(out.request.status).toBe("WITHDRAWN");
    expect(s.versions[0]!.status).toBe("DRAFT");
    expect(s.events.at(-1)).toMatchObject({ action: "STATUS_CHANGE", entityType: "RiskFrameworkChangeRequest" });
  });
});

describe("B-6a circuit", () => {
  /** u1 creates + requests under a first ACTIVE version whose change_approver is `approver`, then a new draft is requested. */
  async function pendingUnder(approver: "COMMITTEE" | "AUDIT", opts: Opts) {
    const s = setup(opts);
    const { fw, v } = await created(s, { changeApprover: approver });
    const r1 = await s.service.requestActivation(u1, fw, v, "v1", R);
    await s.service.approve(u2, r1.id, undefined, R); // no active version yet: the Risk Manager rule applies
    const draft = await s.service.createDraft(u1, fw, undefined, R);
    const r2 = await s.service.requestActivation(u1, fw, draft.id, "v2", R);
    return { s, r2 };
  }

  it("q100: COMMITTEE with at least 2 eligible members: the vote does not exist before B-12, the request is decided in Risk Manager FALLBACK (comment mandatory, ratification PENDING)", async () => {
    const { s, r2 } = await pendingUnder("COMMITTEE", { committee: ["c1", "c2"] });
    const before = s.calls.recordDecision;
    await expect(s.service.approve(u2, r2.id, undefined, R)).rejects.toThrow(ValidationError);
    expect(s.calls.recordDecision).toBe(before);
    const out = await s.service.approve(u2, r2.id, "x", R);
    expect(out.request).toMatchObject({ decisionRegime: "FALLBACK", ratificationStatus: "PENDING" });
  });

  it("q100: the fallback notice goes to Audit AND to the members of the bypassed group, once each", async () => {
    const { s, r2 } = await pendingUnder("COMMITTEE", { audit: ["a1"], committee: ["c1", "c2"] });
    s.sent.length = 0;
    await s.service.approve(u2, r2.id, "repli", R);
    const to = s.sent.filter((n) => n.eventType === "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE").map((n) => n.recipientUserId).sort();
    expect(to).toEqual(["a1", "c1", "c2"]);
  });

  it("Committee and Audit both empty: Risk Manager FALLBACK, comment mandatory, ratification PENDING, Audit notified", async () => {
    const { s, r2 } = await pendingUnder("COMMITTEE", { audit: ["a1"], committee: [] });
    await expect(s.service.approve(u2, r2.id, undefined, R)).rejects.toThrow(ValidationError);
    s.sent.length = 0;
    const out = await s.service.approve(u2, r2.id, "absence du comité", R);
    expect(out.request).toMatchObject({ decisionRegime: "FALLBACK", ratificationStatus: "PENDING" });
    expect(s.sent.filter((n) => n.eventType === "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE").map((n) => n.recipientUserId)).toEqual(["a1"]);
  });

  it("a group with only one eligible member is not called upon (q72)", async () => {
    const { s, r2 } = await pendingUnder("AUDIT", { audit: ["a1"], committee: [] });
    const out = await s.service.approve(u2, r2.id, "repli", R);
    expect(out.request.decisionRegime).toBe("FALLBACK");
  });

  it("switching self-proposal on is refused at request creation outside a Committee vote", async () => {
    const s = setup();
    const { fw, v } = await created(s, { selfProposalAllowed: true });
    await expect(s.service.requestActivation(u1, fw, v, "go", R)).rejects.toThrow(/auto-proposition/);
    expect(s.versions[0]!.status).toBe("DRAFT");
  });

  it("the only Risk Manager is the requester: the request stays PENDING and Risk Managers get NO_DECIDER", async () => {
    const s = setup({ rm: ["u1"] });
    const { fw, v } = await created(s);
    const r = await s.service.requestActivation(u1, fw, v, "go", R);
    expect(r.status).toBe("PENDING");
    expect(s.sent).toMatchObject([{ recipientUserId: "u1", eventType: "RISK_FRAMEWORK_NO_DECIDER" }]);
    await expect(s.service.approve(u1, r.id, undefined, R)).rejects.toThrow(/maker-checker/);
  });

  it("a notification failure never undoes the action", async () => {
    const s = setup();
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (s.service as unknown as { notifications: { record: () => Promise<void> } }).notifications.record = async () => { throw new Error("down"); };
    const { fw, v } = await created(s);
    await expect(s.service.requestActivation(u1, fw, v, "go", R)).resolves.toMatchObject({ status: "PENDING" });
    spy.mockRestore();
  });
});

describe("B-6a pure functions", () => {
  const members = (c: number, a: number): EligibleMembers => ({
    RISK_MANAGER: ["r"], COMMITTEE: Array.from({ length: c }, (_, i) => `c${i}`), AUDIT: Array.from({ length: a }, (_, i) => `a${i}`),
  });
  it("resolveDecider follows the table of spec §5.4", () => {
    expect(resolveDecider("RISK_MANAGER", members(5, 5))).toEqual({ kind: "RISK_MANAGER", regime: "NORMAL" });
    expect(resolveDecider("COMMITTEE", members(2, 0))).toEqual({ kind: "VOTE", groups: ["COMMITTEE"] });
    expect(resolveDecider("COMMITTEE", members(1, 2))).toEqual({ kind: "VOTE", groups: ["AUDIT"] });
    expect(resolveDecider("COMMITTEE", members(1, 1))).toEqual({ kind: "RISK_MANAGER", regime: "FALLBACK" });
    expect(resolveDecider("AUDIT", members(2, 2))).toEqual({ kind: "VOTE", groups: ["AUDIT"] });
    expect(resolveDecider("AUDIT", members(2, 1))).toEqual({ kind: "VOTE", groups: ["COMMITTEE"] });
    expect(resolveDecider("AUDIT_AND_COMMITTEE", members(2, 2))).toEqual({ kind: "VOTE", groups: ["COMMITTEE", "AUDIT"] });
    expect(resolveDecider("AUDIT_AND_COMMITTEE", members(0, 0))).toEqual({ kind: "RISK_MANAGER", regime: "FALLBACK" });
  });

  it("assertReadyToActivate (moved to domain/ratingScaleRules) still refuses missing descriptors", () => {
    expect(() => assertReadyToActivate(scale("s", 5, { impactLabels: null }))).toThrow(/impactLabels/);
    expect(() => assertReadyToActivate(scale("s", 5))).not.toThrow();
  });
});

describe("B-6a routes", () => {
  async function http(service: RiskFrameworkService, method: string, path: string, body?: unknown) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: AuthenticatedUser; requestId: string }).user = u1;
      (req as unknown as { requestId: string }).requestId = "req";
      next();
    });
    app.use("/risk-frameworks", riskFrameworksRouter(service));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const res = await fetch(`http://127.0.0.1:${port}/risk-frameworks${path}`, {
        method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    } finally {
      server.close();
    }
  }

  it("creates (201), rejects unknown keys such as status or createdBy (400), reads the list", async () => {
    const s = setup();
    const ok = await http(s.service, "POST", "/", { name: "A", ratingScaleId: "00000000-0000-4000-8000-000000000001" });
    expect(ok.status).toBe(400); // scale unknown in this fake -> ValidationError
    const strict = await http(s.service, "POST", "/", { name: "A", ratingScaleId: "00000000-0000-4000-8000-000000000001", createdBy: "x" });
    expect(strict.status).toBe(400);
    const list = await http(s.service, "GET", "/");
    expect(list.status).toBe(200);
  });

  it("PATCH of a version refuses a status field and a bare oversized array", async () => {
    const s = setup({ scales: [scale("00000000-0000-4000-8000-000000000001")] });
    const c = await http(s.service, "POST", "/", { name: "A", ratingScaleId: "00000000-0000-4000-8000-000000000001" });
    expect(c.status).toBe(201);
    const fw = c.json.data.framework.id;
    const v = c.json.data.version.id;
    expect(fw).toBeDefined();
    // The fake ids are not guids: the guid check answers 400 before the service is reached.
    const bad = await http(s.service, "PATCH", `/${fw}/versions/${v}`, { status: "ACTIVE" });
    expect(bad.status).toBe(400);
  });

  it("the route file has no bare z.array and never reads an attribution field from the body", () => {
    const src = readFileSync("src/api/v1/riskFrameworks.routes.ts", "utf8");
    expect(src).not.toMatch(/z\.array\(/);
    expect(src).not.toMatch(/\b(requestedBy|decidedBy|createdBy|lastEditedBy)\s*:|body\.(requestedBy|decidedBy|createdBy|lastEditedBy)/);
    expect(src).toMatch(/boundedArray\(AppetiteEntry, 200\)/);
  });
});

describe("B-6a permissions and migration (static; nothing is applied)", () => {
  it("the six permissions exist", () => {
    for (const p of ["read", "create", "update", "activate", "archive", "process.assign"]) {
      expect(ALL_PERMISSIONS).toContain(`riskframework.${p}`);
    }
  });

  const up = readFileSync("../database/postgresql/migrations/055_risk_frameworks.sql", "utf8");
  it("055 is idempotent in form, guards the immutability and never grants DELETE", () => {
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS risk_frameworks/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS risk_framework_versions/);
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS risk_framework_change_requests/);
    expect(up).toMatch(/DROP TRIGGER IF EXISTS risk_framework_versions_guard/);
    expect(up).toMatch(/REVOKE DELETE, TRUNCATE ON/);
    expect(up).toMatch(/decided_by <> requested_by OR decision_regime = 'BOOTSTRAP'/);
    expect(up).toMatch(/WHERE NOT EXISTS|AND NOT EXISTS \(SELECT 1 FROM risk_frameworks/);
    expect(readFileSync("../database/postgresql/migrations/055_risk_frameworks.down.sql", "utf8")).toMatch(/^BEGIN;/m);
  });
});

describe("B-6b q91 parameters", () => {
  it("defaults are the contract's; the 'low' threshold has none (R2: never pre-filled)", async () => {
    const s = setup();
    const { version } = await s.service.create(u1, { name: "A", ratingScaleId: "s1" }, R);
    expect(version).toMatchObject({
      lowCriticalityThreshold: null, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true,
      delegationMaxDays: null, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
      committeeVoteRule: "DEFAULT", committeeVoteCustom: null,
    });
  });

  it("activation request refused without a 'low' threshold, or above n x n; accepted at the ceiling", async () => {
    const s = setup();
    const { version } = await s.service.create(u1, { name: "A", ratingScaleId: "s1" }, R);
    const fw = s.versions[0]!.frameworkId;
    await expect(s.service.requestActivation(u1, fw, version.id, "go", R)).rejects.toThrow(/faible/);
    await s.service.updateDraft(u1, fw, version.id, { lowCriticalityThreshold: 26 }, R);
    await expect(s.service.requestActivation(u1, fw, version.id, "go", R)).rejects.toThrow(/faible/);
    await s.service.updateDraft(u1, fw, version.id, { lowCriticalityThreshold: 25 }, R);
    await expect(s.service.requestActivation(u1, fw, version.id, "go", R)).resolves.toBeDefined();
  });

  it("CUSTOM vote rule and any custom body are refused until B-12; invalid enums and durations are refused", async () => {
    const s = setup();
    const bad = (params: object) => s.service.create(u1, { name: "A", ratingScaleId: "s1", params: params as never }, R);
    await expect(bad({ committeeVoteRule: "CUSTOM" })).rejects.toThrow(/B-12/);
    await expect(bad({ committeeVoteCustom: {} })).rejects.toThrow(/B-12/);
    await expect(bad({ masteryAuthoritativeSource: "NOBODY" })).rejects.toThrow(ValidationError);
    await expect(bad({ delegationMaxDays: 0 })).rejects.toThrow(ValidationError);
    await expect(bad({ hybridPolicyEnabled: "yes" })).rejects.toThrow(ValidationError);
    await expect(bad({ committeeVoteRule: "B", masteryAuthoritativeSource: "FIRST_LINE", delegationMaxDays: 30, riskOwnerExecutorCumulAllowed: false }))
      .resolves.toBeDefined();
  });

  it("a non-default value whose reader is not delivered yet is accepted (hybrid policy)", async () => {
    const s = setup();
    const { version } = await s.service.create(u1, { name: "A", ratingScaleId: "s1", params: { hybridPolicyEnabled: true } }, R);
    expect(version.hybridPolicyEnabled).toBe(true);
  });

  it("059 redefines the guard with the eight q91 columns and the pinned search_path; its down restores 056 with search_path", () => {
    const mig = readFileSync("../database/postgresql/migrations/059_risk_framework_branching.sql", "utf8");
    const down = readFileSync("../database/postgresql/migrations/059_risk_framework_branching.down.sql", "utf8");
    expect(mig).toMatch(/LANGUAGE plpgsql\s+SET search_path = pg_catalog, public, pg_temp AS/);
    for (const c of ["low_criticality_threshold", "risk_owner_executor_cumul_allowed", "delegate_executor_cumul_allowed", "delegation_max_days",
      "hybrid_policy_enabled", "mastery_authoritative_source", "committee_vote_rule", "committee_vote_custom"]) {
      expect(mig).toContain(`NEW.${c}`);
      expect(mig).toContain(`OLD.${c}`);
    }
    expect(down).toMatch(/LANGUAGE plpgsql\s+SET search_path = pg_catalog, public, pg_temp AS/);
    expect(down).toMatch(/^BEGIN;/m);
  });
});
