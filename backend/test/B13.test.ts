import { describe, expect, it } from "vitest";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { DEFAULT_FRAMEWORK_TEMPLATES } from "../src/domain/defaultFrameworks.js";
import { contractDefaultViolations } from "../src/domain/frameworkApproval.js";
import { assertReadyToActivate } from "../src/domain/ratingScaleRules.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import { mapPgError } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type {
  ArchiveFrameworkResult,
  CreateDefaultRequestInput,
  DefaultResult,
  RecordDecisionInput,
  RiskFramework,
  RiskFrameworkChangeRequest,
  RiskFrameworkVersion,
  TransactionalAudit,
} from "../src/domain/entities/RiskFramework.js";
import type { ProvisionWithScaleInput } from "../src/domain/repositories/RiskFrameworkRepository.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-13 (DECISION-124/127): default Dispositif templates, SET_DEFAULT, archiving. Cross-module cases are A08's.

const ALL: Permission[] = ["riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive"];
const actor = (userId: string, perms: Permission[] = ALL): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: perms }) as AuthenticatedUser;
const role = (g: SystemGroup): Role => ({
  id: g, tenantId: "t1", name: g, description: null, permissions: [], dashboardScopeMode: "GLOBAL",
  systemGroup: g, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
}) as Role;

describe("B-13 templates (A13 values, validated by the PO)", () => {
  const by = (n: string) => DEFAULT_FRAMEWORK_TEMPLATES.find((t) => t.name === n)!;
  const asScale = (t: (typeof DEFAULT_FRAMEWORK_TEMPLATES)[number]) => ({
    probabilityLevels: t.scale.size, impactLevels: t.scale.size, probabilityLabels: t.scale.probabilityLabels, impactLabels: t.scale.impactLabels,
    impactAxes: { axes: t.scale.axes, retainedImpactRule: "MAX" },
  }) as unknown as RatingScale;

  it("exposes Tranché 4x4, Standard 5x5, Renforcé 6x6 with 5, 5 and 7 axes", () => {
    expect(DEFAULT_FRAMEWORK_TEMPLATES.map((t) => [t.name, t.scale.size, t.scale.axes.length])).toEqual([["Tranché", 4, 5], ["Standard", 5, 5], ["Renforcé", 6, 7]]);
  });

  it("each scale is complete enough to activate (a descriptor per level, per axis) and its bands cover 1..n x n", () => {
    for (const t of DEFAULT_FRAMEWORK_TEMPLATES) {
      expect(() => assertReadyToActivate(asScale(t))).not.toThrow();
      const bands = t.scale.thresholds;
      expect(bands[0]!.min).toBe(1);
      expect(bands.at(-1)!.max).toBe(t.scale.size * t.scale.size);
      bands.slice(1).forEach((b, i) => expect(b.min).toBe(bands[i]!.max + 1));
      // A13 section 5.2: "Critique" starts at the Committee threshold, the top of "Faible" is the low threshold.
      expect(bands.at(-1)!.min).toBe(t.params.committeeEvaluationMinScore);
      expect(bands[0]!.max).toBe(t.params.lowCriticalityThreshold);
    }
  });

  it("Tranché takes Standard's delegation (90 days), velocity, persistence, defense lines (variant 2)", () => {
    const [tr, st] = [by("Tranché"), by("Standard")];
    expect(tr.params.delegationMaxDays).toBe(90);
    expect(tr.scale.velocity).toEqual(st.scale.velocity);
    expect(tr.scale.persistence).toEqual(st.scale.persistence);
    expect(tr.scale.mastery.defenseLines).toEqual(["L1", "L2", "L3"]);
    expect(tr.scale.axes.map((a) => a.code)).toEqual(st.scale.axes.map((a) => a.code));
  });

  it("Standard and Tranché equal the contract defaults (bootstrap-compatible), Renforcé does not", () => {
    const defaults = { defaultEvaluationMode: "CLASSIQUE", committeeEvaluationEnforced: true, changeApprover: "RISK_MANAGER", selfProposalAllowed: false,
      hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM", committeeVoteRule: "DEFAULT", committeeVoteCustom: null } as const;
    const v = (t: (typeof DEFAULT_FRAMEWORK_TEMPLATES)[number]) => ({ ...defaults, ...t.params });
    expect(contractDefaultViolations(v(by("Standard")), 5)).toEqual([]);
    expect(contractDefaultViolations(v(by("Tranché")), 4)).toEqual([]);
    expect(contractDefaultViolations(v(by("Renforcé")), 6)).toEqual(expect.arrayContaining(["committeeEvaluationMinScore", "riskOwnerExecutorCumulAllowed", "delegateExecutorCumulAllowed"]));
  });
});

function setup(opts: { rm?: string[]; defaultId?: string; activeIds?: string[]; existing?: string[]; attachedProcess?: boolean; failOnTemplate?: string } = {}) {
  const rm = opts.rm ?? ["u1", "u2", "u3"];
  const fw = (id: string, name = id): RiskFramework => ({ id, tenantId: "t1", name, description: null, isDefault: id === (opts.defaultId ?? "fwA"), createdBy: "u1",
    createdAt: new Date(), updatedAt: new Date(), archivedAt: null, archivedBy: null, archiveReason: null }) as RiskFramework;
  const frameworks = [fw("fwA"), fw("fwB"), ...(opts.existing ?? []).map((n) => fw(`x-${n}`, n))];
  const activeIds = opts.activeIds ?? ["fwA", "fwB"];
  const requests: RiskFrameworkChangeRequest[] = [];
  const audit: Array<Record<string, unknown>> = [];
  const notified: Array<{ recipientUserId: string; eventType: string }> = [];
  const scales = new Map<string, RatingScale>();
  const drafts: Array<{ name: string; description: string | null; scaleId: string; params: Record<string, unknown> }> = [];

  const repo = {
    auditsInTransaction: true,
    async listFrameworks() { return frameworks; },
    async getFramework(_t: string, id: string) { return frameworks.find((f) => f.id === id) ?? null; },
    async getActiveVersion(_t: string, id: string) { return activeIds.includes(id) ? ({ id: `v-${id}`, frameworkId: id, status: "ACTIVE", changeApprover: "RISK_MANAGER" } as RiskFrameworkVersion) : null; },
    async getRequest(_t: string, id: string) { return requests.find((r) => r.id === id) ?? null; },
    async createDefaultRequest(i: CreateDefaultRequestInput) {
      const r = { id: `r${requests.length + 1}`, tenantId: i.tenantId, kind: "SET_DEFAULT", frameworkId: i.frameworkId, versionId: null, processId: null,
        reason: i.reason, status: "PENDING", requestedBy: i.requestedBy } as RiskFrameworkChangeRequest;
      requests.push(r);
      for (const e of i.audit?.(r) ?? []) audit.push(e);
      return r;
    },
    async decideDefault(_t: string, id: string, d: RecordDecisionInput, a?: TransactionalAudit<DefaultResult>) {
      const req = requests.find((r) => r.id === id)!;
      Object.assign(req, { status: d.outcome, decidedBy: d.decidedBy, decisionComment: d.comment, decisionRegime: d.decisionRegime });
      const prev = frameworks.find((f) => f.isDefault) ?? null;
      const target = frameworks.find((f) => f.id === req.frameworkId)!;
      const result: DefaultResult = { request: { ...req }, previousDefault: d.outcome === "APPROVED" ? prev && { ...prev } : null, framework: null };
      if (d.outcome === "APPROVED") {
        if (prev) prev.isDefault = false;
        target.isDefault = true;
        result.framework = { ...target };
      }
      for (const e of a?.(result) ?? []) audit.push(e);
      return result;
    },
    async withdrawDefault(_t: string, id: string, comment: string | null, a?: TransactionalAudit<DefaultResult>) {
      const req = requests.find((r) => r.id === id)!;
      Object.assign(req, { status: "WITHDRAWN", decisionComment: comment });
      const result: DefaultResult = { request: { ...req }, previousDefault: null, framework: null };
      for (const e of a?.(result) ?? []) audit.push(e);
      return result;
    },
    async archiveFramework(_t: string, id: string, by: string, reason: string, a?: TransactionalAudit<ArchiveFrameworkResult>) {
      if (opts.attachedProcess) throw new ValidationError("Des processus sont rattachés à ce Dispositif");
      const f = frameworks.find((x) => x.id === id)!;
      const before = { ...f };
      Object.assign(f, { archivedAt: new Date(), archivedBy: by, archiveReason: reason });
      const result: ArchiveFrameworkResult = { before, framework: { ...f }, versions: [] };
      for (const e of a?.(result) ?? []) audit.push(e);
      return result;
    },
    /** Mimics the repository transaction: scale + Dispositif commit together; a throwing audit callback commits nothing. */
    async provisionWithScale(i: ProvisionWithScaleInput) {
      const sc = i.scale;
      const scale = { id: `s${scales.size + 1}`, name: sc.name, status: "DRAFT", probabilityLevels: sc.size, impactLevels: sc.size, probabilityLabels: sc.probabilityLabels,
        impactLabels: sc.impactLabels, criticalityThresholds: sc.thresholds, impactAxes: sc.impactAxes, velocityLevels: sc.velocity, persistenceLevels: sc.persistence,
        masteryScale: sc.mastery } as unknown as RatingScale;
      const out = { scale, framework: fw(`new-${i.name}`, i.name), version: { id: `v-${i.name}`, status: "DRAFT" } as RiskFrameworkVersion };
      const events = i.audit?.(out) ?? [];
      if (opts.failOnTemplate === i.name) throw new Error("audit store down");
      scales.set(scale.id, scale);
      drafts.push({ name: i.name, description: i.description, scaleId: scale.id, params: i.params });
      for (const e of events) audit.push(e);
      return out;
    },
  };
  const ratingScales = { async getById(_t: string, id: string) { return scales.get(id) ?? null; } };
  const roles = {
    async list() { return [role("RISK_MANAGER"), role("AUDIT"), role("RISK_COMMITTEE")]; },
    async listForUser(_t: string, uid: string) { return rm.includes(uid) ? [role("RISK_MANAGER")] : []; },
    async listAssignments(_t: string, roleId: string) { return (roleId === "RISK_MANAGER" ? rm : []).map((userId) => ({ userId, revokedAt: null })); },
    async listActiveGrants() { return []; },
  };
  const users = { async getById(_t: string, id: string) { return { id, deletedAt: null }; }, async listWithPermission() { return []; } };
  const notifications = { async record(x: { recipientUserId: string; eventType: string }) { notified.push(x); } };
  const service = new RiskFrameworkService(repo as never, ratingScales as never, roles as never, users as never,
    { async record(e: Record<string, unknown>) { audit.push(e); }, async listForEntity() { return []; } } as never, undefined, notifications as never);
  return { service, requests, audit, frameworks, drafts, scales, notified };
}

describe("B-13 provisionDefaults", () => {
  it("creates the three templates as drafts (scale + Dispositif), audited, nothing default or activated", async () => {
    const s = setup();
    const r = await s.service.provisionDefaults(actor("u1"), "req");
    expect(r).toEqual({ created: ["Tranché", "Standard", "Renforcé"], skipped: [] });
    expect(s.scales.size).toBe(3);
    expect(s.drafts.map((d) => d.name)).toEqual(["Tranché", "Standard", "Renforcé"]);
    const std = s.drafts.find((d) => d.name === "Standard")!;
    expect(std.params).toMatchObject({ committeeEvaluationMinScore: 15, committeeTreatmentMinScore: 15, lowCriticalityThreshold: 4, delegationMaxDays: 90 });
    expect(std.description).toBe("5 niveaux, l'échelle classique. Le niveau 3 est un milieu, à utiliser avec prudence.");
    expect(s.audit.some((e) => e["entityType"] === "RiskFramework" && e["action"] === "CREATE")).toBe(true);
    expect(s.audit.some((e) => e["entityType"] === "RatingScale" && e["action"] === "CREATE")).toBe(true);
  });

  it("SEC-B13-02: a failure while provisioning one template leaves no orphan scale (earlier templates kept, replay completes)", async () => {
    const s = setup({ failOnTemplate: "Standard" });
    await expect(s.service.provisionDefaults(actor("u1"), "req")).rejects.toThrow("audit store down");
    expect(s.drafts.map((d) => d.name)).toEqual(["Tranché"]);
    expect(s.scales.size).toBe(1); // the Tranché scale, owned by its Dispositif; none for Standard
    const ok = setup({ existing: ["Tranché"] });
    expect((await ok.service.provisionDefaults(actor("u1"), "req")).created).toEqual(["Standard", "Renforcé"]);
  });

  it("is idempotent by name: an existing Dispositif is skipped", async () => {
    const s = setup({ existing: ["standard"] });
    const r = await s.service.provisionDefaults(actor("u1"), "req");
    expect(r.created).toEqual(["Tranché", "Renforcé"]);
    expect(r.skipped).toEqual(["Standard"]);
  });

  it("refuses without riskframework.create and for a non Risk Manager", async () => {
    const s = setup();
    await expect(s.service.provisionDefaults(actor("u1", ["riskframework.read"]), "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.provisionDefaults(actor("admin"), "r")).rejects.toThrow(ForbiddenError);
    expect(s.drafts).toHaveLength(0);
  });
});

describe("SEC-B13-03 deadlock mapping", () => {
  it("a deadlock (40P01) or serialization failure (40001) becomes a 409, other pg errors stay untouched", () => {
    expect(mapPgError({ code: "40P01" })).toBeInstanceOf(ConflictError);
    expect(mapPgError({ code: "40001" })).toBeInstanceOf(ConflictError);
    const other = { code: "XX000" };
    expect(mapPgError(other)).toBe(other);
  });
});

describe("B-13 SET_DEFAULT", () => {
  it("request: PENDING, requester forced to the actor, SUBMIT audited, nothing changes yet", async () => {
    const s = setup();
    const r = await s.service.requestSetDefault(actor("u1"), "fwB", "Aligner sur la méthode B", "req1");
    expect(r).toMatchObject({ kind: "SET_DEFAULT", status: "PENDING", requestedBy: "u1", frameworkId: "fwB" });
    expect(s.frameworks.find((f) => f.id === "fwB")!.isDefault).toBe(false);
    expect(s.audit[0]).toMatchObject({ entityType: "RiskFrameworkChangeRequest", action: "SUBMIT", reason: "Aligner sur la méthode B", userId: "u1" });
  });

  it("refuses: no permission, non Risk Manager, empty reason, already default, no ACTIVE version, archived", async () => {
    const s = setup({ activeIds: ["fwA"] });
    await expect(s.service.requestSetDefault(actor("u1", ["riskframework.read"]), "fwB", "x", "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.requestSetDefault(actor("admin"), "fwB", "x", "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.requestSetDefault(actor("u1"), "fwB", "  ", "r")).rejects.toThrow(ValidationError);
    await expect(s.service.requestSetDefault(actor("u1"), "fwA", "x", "r")).rejects.toThrow(/déjà/);
    await expect(s.service.requestSetDefault(actor("u1"), "fwB", "x", "r")).rejects.toThrow(/version active/);
    s.frameworks[1]!.archivedAt = new Date();
    await expect(s.service.requestSetDefault(actor("u1"), "fwB", "x", "r")).rejects.toThrow(/archivé/);
    expect(s.requests).toHaveLength(0);
  });

  it("approval by a third Risk Manager moves the default and audits both identities with the reason; the requester cannot decide", async () => {
    const s = setup();
    const r = await s.service.requestSetDefault(actor("u1"), "fwB", "Motif de la demande", "req1");
    await expect(s.service.approve(actor("u1"), r.id, undefined, "r")).rejects.toThrow(ForbiddenError);
    await s.service.approve(actor("u2"), r.id, undefined, "req2");
    expect(s.frameworks.find((f) => f.id === "fwB")!.isDefault).toBe(true);
    expect(s.frameworks.find((f) => f.id === "fwA")!.isDefault).toBe(false);
    const updates = s.audit.filter((e) => e["entityType"] === "RiskFramework" && e["action"] === "UPDATE");
    expect(updates.map((e) => e["entityId"])).toEqual(["fwA", "fwB"]);
    expect(updates.every((e) => e["reason"] === "Motif de la demande")).toBe(true);
    expect(s.audit.some((e) => e["entityType"] === "RiskFrameworkChangeRequest" && e["action"] === "APPROVE")).toBe(true);
  });

  it("a refusal needs a comment and leaves the default alone", async () => {
    const s = setup();
    const r = await s.service.requestSetDefault(actor("u1"), "fwB", "x", "req1");
    await expect(s.service.reject(actor("u2"), r.id, "  ", "r")).rejects.toThrow(ValidationError);
    await s.service.reject(actor("u2"), r.id, "Pas maintenant", "req2");
    expect(s.frameworks.find((f) => f.id === "fwA")!.isDefault).toBe(true);
    expect(s.audit.some((e) => e["action"] === "REJECT")).toBe(true);
  });

  it("only the requester can withdraw it", async () => {
    const s = setup();
    const r = await s.service.requestSetDefault(actor("u1"), "fwB", "x", "req1");
    await expect(s.service.withdraw(actor("u2"), r.id, "x", "r")).rejects.toThrow(ForbiddenError);
    await s.service.withdraw(actor("u1"), r.id, "J'annule", "req2");
    expect(s.requests[0]!.status).toBe("WITHDRAWN");
  });

  it("does not offer the sole-Risk-Manager confirmation (ASSIGN_PROCESS only)", async () => {
    const s = setup({ rm: ["u1"] });
    const r = await s.service.requestSetDefault(actor("u1"), "fwB", "x", "req1");
    await expect(s.service.confirmSoleAssignment(actor("u1", [...ALL, "riskframework.process.assign"]), r.id, { reason: "seul" }, "r")).rejects.toThrow(ValidationError);
  });
});

describe("B-13 archive a Dispositif", () => {
  it("needs its own permission: riskframework.update is not enough", async () => {
    const s = setup();
    await expect(s.service.archiveFramework(actor("u1", ["riskframework.read", "riskframework.update"]), "fwB", "x", "r")).rejects.toThrow(ForbiddenError);
    await expect(s.service.archiveFramework(actor("admin"), "fwB", "x", "r")).rejects.toThrow(ForbiddenError);
  });

  it("requires a reason, refuses the default Dispositif and an already archived one", async () => {
    const s = setup();
    await expect(s.service.archiveFramework(actor("u1"), "fwB", "  ", "r")).rejects.toThrow(ValidationError);
    await expect(s.service.archiveFramework(actor("u1"), "fwA", "x", "r")).rejects.toThrow(/par défaut/);
    s.frameworks[1]!.archivedAt = new Date();
    await expect(s.service.archiveFramework(actor("u1"), "fwB", "x", "r")).rejects.toThrow(/déjà archivé/);
  });

  it("happy path: STATUS_CHANGE audited with the reason, by the actor; a repository refusal (attached process) propagates", async () => {
    const s = setup();
    const f = await s.service.archiveFramework(actor("u1"), "fwB", "Plus utilisé", "req1");
    expect(f.archivedAt).not.toBeNull();
    expect(f.archivedBy).toBe("u1");
    expect(s.audit.find((e) => e["entityType"] === "RiskFramework" && e["action"] === "STATUS_CHANGE")).toMatchObject({ entityId: "fwB", reason: "Plus utilisé", userId: "u1" });
    const t = setup({ attachedProcess: true });
    await expect(t.service.archiveFramework(actor("u1"), "fwB", "x", "r")).rejects.toThrow(ValidationError);
    expect(t.audit).toHaveLength(0);
  });

  it("is not reachable through the generic identity update (no status field)", async () => {
    const s = setup();
    await s.service.updateIdentity(actor("u1"), "fwB", { name: "B2", reason: "x" }, "r").catch(() => undefined);
    expect(s.frameworks.find((f) => f.id === "fwB")!.archivedAt).toBeNull();
  });
});
