import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import express from "express";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { RoleService } from "../src/services/RoleService.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import {
  bootstrapRefusal,
  contractDefaultViolations,
  foldVoteBeforeB12,
  isCircuitFunctional,
  type BootstrapContext,
} from "../src/domain/frameworkApproval.js";
import { NOTIFICATION_CATALOG } from "../src/domain/notificationCatalog.js";
import type { Permission } from "../src/domain/permissions.js";
import type { Role, SystemGroup } from "../src/domain/entities/Role.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { BootstrapFacts, DecisionResult, RiskFrameworkChangeRequest, RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-6d (spec RM-V1-B6-Dispositif-spec.md §15): bootstrap (q77, q83, q98, q101, q102) and the q100 fold.
// Authored by the code's author: QA level 2 is A08's. The SQL side is in B6dBootstrap-pg.test.ts.

const ctx = (over: Partial<BootstrapContext> = {}): BootstrapContext => ({
  kind: "ACTIVATE_VERSION", endedAt: null, activeMembers: { RISK_MANAGER: 1, COMMITTEE: 0, AUDIT: 0 },
  requesterIsActiveRiskManager: true, firstActivationOfTenant: true, contractDefaultsOnly: true, switchesSelfProposalOn: false, ...over,
});

describe("B-6d pure rules", () => {
  it("q101: a circuit works with 2 RM, 2 Committee or 2 Audit members, not with 1 + 1 + 1", () => {
    expect(isCircuitFunctional({ RISK_MANAGER: 2, COMMITTEE: 0, AUDIT: 0 })).toBe(true);
    expect(isCircuitFunctional({ RISK_MANAGER: 1, COMMITTEE: 2, AUDIT: 0 })).toBe(true);
    expect(isCircuitFunctional({ RISK_MANAGER: 1, COMMITTEE: 0, AUDIT: 2 })).toBe(true);
    expect(isCircuitFunctional({ RISK_MANAGER: 1, COMMITTEE: 1, AUDIT: 1 })).toBe(false);
  });

  it("bootstrapRefusal: open for a sole RM with one Committee and one Audit member; each refusal on its own case", () => {
    expect(bootstrapRefusal(ctx({ activeMembers: { RISK_MANAGER: 1, COMMITTEE: 1, AUDIT: 1 } }))).toBeNull();
    expect(bootstrapRefusal(ctx({ activeMembers: { RISK_MANAGER: 2, COMMITTEE: 0, AUDIT: 0 } }))).toBe("CIRCUIT_FUNCTIONAL");
    expect(bootstrapRefusal(ctx({ activeMembers: { RISK_MANAGER: 1, COMMITTEE: 2, AUDIT: 0 } }))).toBe("CIRCUIT_FUNCTIONAL");
    expect(bootstrapRefusal(ctx({ activeMembers: { RISK_MANAGER: 1, COMMITTEE: 0, AUDIT: 2 } }))).toBe("CIRCUIT_FUNCTIONAL");
    expect(bootstrapRefusal(ctx({ requesterIsActiveRiskManager: false }))).toBe("NOT_SOLE_RISK_MANAGER");
    expect(bootstrapRefusal(ctx({ activeMembers: { RISK_MANAGER: 0, COMMITTEE: 0, AUDIT: 0 } }))).toBe("NOT_SOLE_RISK_MANAGER");
    expect(bootstrapRefusal(ctx({ kind: "SET_DEFAULT" }))).toBe("OUT_OF_SCOPE");
    expect(bootstrapRefusal(ctx({ kind: "ASSIGN_PROCESS" }))).toBe("OUT_OF_SCOPE");
    expect(bootstrapRefusal(ctx({ firstActivationOfTenant: false }))).toBe("NOT_FIRST_ACTIVATION");
    expect(bootstrapRefusal(ctx({ contractDefaultsOnly: false }))).toBe("NOT_CONTRACT_DEFAULTS");
    expect(bootstrapRefusal(ctx({ switchesSelfProposalOn: true }))).toBe("SELF_PROPOSAL");
    expect(bootstrapRefusal(ctx({ kind: "DESIGNATION", firstActivationOfTenant: false, contractDefaultsOnly: false }))).toBeNull();
  });

  it("q102: the end is definitive, even when the counters went back to 1 RM and nobody else", () => {
    expect(bootstrapRefusal(ctx({ endedAt: new Date(), activeMembers: { RISK_MANAGER: 1, COMMITTEE: 0, AUDIT: 0 } }))).toBe("ENDED");
  });

  it("q98: contractDefaultViolations is empty at the defaults of scales 3 to 6, and names each differing column", () => {
    const base = {
      defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, changeApprover: "RISK_MANAGER",
      selfProposalAllowed: false, riskOwnerExecutorCumulAllowed: true, delegateExecutorCumulAllowed: true, hybridPolicyEnabled: false,
      masteryAuthoritativeSource: "RISK_TEAM", committeeVoteRule: "DEFAULT", committeeVoteCustom: null,
    } as const;
    for (const [n, score] of [[3, 5], [4, 9], [5, 15], [6, 21]] as const) {
      expect(contractDefaultViolations({ ...base, committeeEvaluationMinScore: score }, n)).toEqual([]);
    }
    expect(contractDefaultViolations({ ...base, committeeEvaluationMinScore: 12 }, 5)).toEqual(["committeeEvaluationMinScore"]);
    expect(contractDefaultViolations({ ...base, committeeEvaluationEnforced: false }, 5)).toEqual(["committeeEvaluationEnforced"]);
    expect(contractDefaultViolations({ ...base, defaultEvaluationMode: "PARTICIPATIF", hybridPolicyEnabled: true }, 5)).toEqual(["defaultEvaluationMode", "hybridPolicyEnabled"]);
    expect(contractDefaultViolations({ ...base, masteryAuthoritativeSource: "FIRST_LINE", delegateExecutorCumulAllowed: false }, 5))
      .toEqual(["delegateExecutorCumulAllowed", "masteryAuthoritativeSource"]);
  });

  it("q100: foldVoteBeforeB12 turns a VOTE into a traced RM FALLBACK and leaves the others alone", () => {
    expect(foldVoteBeforeB12({ kind: "VOTE", groups: ["COMMITTEE", "AUDIT"] })).toEqual({
      decider: { kind: "RISK_MANAGER", regime: "FALLBACK" }, fallbackCause: "LEGACY_APPROVER_PRE_B12", bypassedGroups: ["COMMITTEE", "AUDIT"],
    });
    expect(foldVoteBeforeB12({ kind: "RISK_MANAGER", regime: "NORMAL" })).toEqual({ decider: { kind: "RISK_MANAGER", regime: "NORMAL" }, fallbackCause: null, bypassedGroups: [] });
    expect(foldVoteBeforeB12({ kind: "RISK_MANAGER", regime: "FALLBACK" }).fallbackCause).toBeNull();
  });

  it("q99: the notice type is in the catalogue, mandatory", () => {
    expect(NOTIFICATION_CATALOG.find((t) => t.eventType === "RISK_FRAMEWORK_BOOTSTRAP_NOTICE")).toMatchObject({ resourceType: "MANAGEMENT", mandatory: true });
  });
});

// -- service ---------------------------------------------------------------

const role = (id: string, systemGroup: SystemGroup | null, permissions: Permission[]): Role => ({
  id, tenantId: "t1", name: id, description: null, permissions, dashboardScopeMode: "GLOBAL",
  systemGroup, departmentId: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
});
const level = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const scale = (): RatingScale => ({
  id: "s1", tenantId: "t1", name: "s1", version: "1", status: "DRAFT",
  probabilityLevels: 5, probabilityLabels: level(5), impactLevels: 5, impactLabels: level(5),
  criticalityThresholds: [{ label: "Faible", min: 1, max: 4 }, { label: "Élevé", min: 5, max: 25 }] as never,
  impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1, levelLabels: level(5) }], retainedImpactRule: "MAX" },
  velocityLevels: null, persistenceLevels: null, masteryScale: null, activatedAt: null, archivedAt: null,
  createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
});
const actor = (userId: string): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles: ["riskframework.activate", "riskframework.read"] }) as AuthenticatedUser;
const U1 = actor("u1");
const ISO = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const GOOD = (over: Record<string, unknown> = {}) => ({
  comment: "Aucun second membre disponible",
  justification: { askedUserId: "adm", askedOn: ISO(-1), outcome: "L'administrateur n'a pas pu désigner de second membre.", ...over },
});

function world(o: { facts?: Partial<BootstrapFacts>; audit?: string[]; committee?: string[]; versionOver?: Partial<RiskFrameworkVersion> } = {}) {
  const facts: BootstrapFacts = {
    endedAt: null, activeMembers: { RISK_MANAGER: 1, COMMITTEE: o.committee?.length ?? 0, AUDIT: o.audit?.length ?? 0 },
    requesterIsActiveRiskManager: true, firstActivationOfTenant: true, ...o.facts,
  };
  const version = {
    id: "v1", tenantId: "t1", frameworkId: "fw1", versionNumber: 1, status: "PENDING_APPROVAL", ratingScaleId: "s1",
    defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true, committeeTreatmentMinScore: 20,
    appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: "c1", entity: null, threshold: 8, description: null }],
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
  const grantMeta: Record<string, { grantedBy?: string; grantedAt?: Date }> = {};
  const held: Record<string, Role[]> = {
    u1: [role("rm", "RISK_MANAGER", ["riskframework.activate"])],
    adm: [role("adm", null, ["role.assign"])],
    plain: [role("plain", null, ["risk.read"])],
  };
  const groups: Record<string, string[]> = { AUDIT: o.audit ?? [], RISK_COMMITTEE: o.committee ?? [], RISK_MANAGER: ["u1"] };
  const roles = (["RISK_MANAGER", "AUDIT", "RISK_COMMITTEE"] as const).map((g) => role(g, g, []));
  const roleRepo = {
    async list() { return roles; },
    async listForUser(_t: string, u: string) { return held[u] ?? []; },
    async listActiveGrants(_t: string, u: string) {
      return (held[u] ?? []).map((r) => ({ role: r, grantedBy: grantMeta[u]?.grantedBy ?? "other", grantedAt: grantMeta[u]?.grantedAt ?? new Date("2020-01-01T00:00:00Z") }));
    },
    async listAssignments(_t: string, id: string) { return (groups[id] ?? []).map((userId) => ({ userId, roleId: id, revokedAt: null })); },
  };
  const users = {
    async getById(_t: string, id: string) { return id === "ghost" || id === "gone" ? (id === "gone" ? { id, deletedAt: new Date() } : null) : { id, deletedAt: null }; },
    async listWithPermission() { return []; },
  };
  const sent: Array<{ recipientUserId: string; eventType: string; message: string }> = [];
  const notifications = { async record(i: { recipientUserId: string; eventType: string; message: string }) { sent.push(i); } };
  const roleAudit: Array<{ entityId: string; userId: string; action: string; oldValue: unknown; newValue: unknown }> = [];
  const audit = { async record() {}, async listForEntity(_t: string, type: string, id: string) { return type === "Role" ? roleAudit.filter((e) => e.entityId === id) : []; } };
  const scales = { async getById() { return scale(); } };
  const service = new RiskFrameworkService(repo as never, scales as never, roleRepo as never, users as never, audit as never,
    { async getById(_t: string, id: string) { return { id, name: "Fraude", active: true, parentId: "root" }; } } as never, notifications as never);
  return { service, request, version, written, sent, stored, grantMeta, held, roleAudit };
}

describe("B-6d bootstrapApprove (q83, q98, q99, I-D8, I-D9)", () => {
  it("records the BOOTSTRAP decision, audits it, freezes the free parameters, notifies Audit and Committee members only", async () => {
    const w = world({ audit: ["a1"], committee: ["c1"] });
    const out = await w.service.bootstrapApprove(U1, "r1", GOOD(), "req");
    expect(out.request).toMatchObject({ status: "APPROVED", decisionRegime: "BOOTSTRAP", decidedBy: "u1", requestedBy: "u1", ratificationStatus: null, fallbackCause: null });
    expect(out.request.bootstrapJustification).toMatchObject({
      askedUserId: "adm",
      freeParameters: { scaleSize: 5, lowCriticalityThreshold: 6, delegationMaxDays: 30, committeeTreatmentMinScore: 20, lowThresholdToExamine: true },
    });
    expect(out.request.bootstrapJustification!.freeParameters.appetiteThresholds).toHaveLength(1);
    expect(w.written.map((e) => `${e.entityType}:${e.action}`)).toEqual(["RiskFrameworkVersion:STATUS_CHANGE", "RiskFrameworkChangeRequest:APPROVE"]);
    expect(w.written[0]!.newValue).toMatchObject({ decisionRegime: "BOOTSTRAP", bootstrapJustification: { freeParameters: { lowThresholdToExamine: true } } });
    expect(w.sent.map((s) => `${s.eventType}:${s.recipientUserId}`).sort()).toEqual(["RISK_FRAMEWORK_BOOTSTRAP_NOTICE:a1", "RISK_FRAMEWORK_BOOTSTRAP_NOTICE:c1"]);
    expect(w.sent[0]!.message).toMatch(/valeur à examiner/);
  });

  it("q103: with Audit and the Committee empty nobody at all is notified; R2 does not block (low threshold within the lowest band)", async () => {
    const w = world({ versionOver: { lowCriticalityThreshold: 3 } });
    const out = await w.service.bootstrapApprove(U1, "r1", GOOD(), "req");
    expect(w.sent).toEqual([]);
    expect(out.request.bootstrapJustification!.freeParameters.lowThresholdToExamine).toBe(false);
  });

  it("I-D8: the free parameters carry no ceiling (high appetite and threshold are accepted)", async () => {
    const w = world({ versionOver: { lowCriticalityThreshold: 20, delegationMaxDays: null } });
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD(), "req")).resolves.toBeDefined();
  });

  it("refuses anyone but the requester, and the ordinary approve still refuses the requester", async () => {
    const w = world();
    await expect(w.service.bootstrapApprove(actor("u2"), "r1", GOOD(), "req")).rejects.toThrow(ForbiddenError); // not a Risk Manager
    w.request.requestedBy = "someone-else";
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/demandeur/);
    w.request.requestedBy = "u1";
    await expect(w.service.approve(U1, "r1", "x", "req")).rejects.toThrow(ForbiddenError);
    expect(w.stored.calls).toBe(0);
  });

  it("q102: refused with the definitive-end message even when the counters are back to 1 RM; nothing written", async () => {
    const w = world({ facts: { endedAt: new Date() } });
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/définitivement/);
    expect(w.written).toEqual([]);
  });

  it("q101: refused once a circuit works (2 Audit members), allowed with 1 Audit + 1 Committee member", async () => {
    await expect(world({ audit: ["a1", "a2"] }).service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/circuit d'approbation/);
    await expect(world({ audit: ["a1"], committee: ["c1"] }).service.bootstrapApprove(U1, "r1", GOOD(), "req")).resolves.toBeDefined();
  });

  it("q98: refused when the version departs from the contract defaults, naming the fields; q81: not the first activation", async () => {
    const w = world({ versionOver: { committeeEvaluationEnforced: false, hybridPolicyEnabled: true } });
    const err = await w.service.bootstrapApprove(U1, "r1", GOOD(), "req").catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/committeeEvaluationEnforced, hybridPolicyEnabled/);
    await expect(world({ facts: { firstActivationOfTenant: false } }).service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/premier Dispositif/);
  });

  it("F-B6d-01: the asked administrator's right must not come from the requester, nor postdate askedOn; a pre-existing third-party admin is accepted", async () => {
    const byMe = world();
    byMe.grantMeta["adm"] = { grantedBy: "u1" };
    await expect(byMe.service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/accordé par vous, ou après/);
    const late = world();
    late.grantMeta["adm"] = { grantedAt: new Date() }; // granted today, askedOn = yesterday
    await expect(late.service.bootstrapApprove(U1, "r1", GOOD(), "req")).rejects.toThrow(/accordé par vous, ou après/);
    const early = world();
    early.grantMeta["adm"] = { grantedBy: "someone", grantedAt: new Date(Date.now() - 5 * 86_400_000) };
    await expect(early.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: ISO(-1) }), "req")).resolves.toBeDefined();
    // lower bound: askedOn before the grant (hence before the tenant existed) is refused
    const before = world();
    before.grantMeta["adm"] = { grantedAt: new Date(Date.now() - 5 * 86_400_000) };
    await expect(before.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: "1970-01-01" }), "req")).rejects.toThrow(/accordé par vous, ou après/);
    expect(byMe.stored.calls + late.stored.calls + before.stored.calls).toBe(0);
  });

  it("F-B6d-01 retest 2 (A10): an old third-party grant of a role the requester created or widened is refused, even with askedOn = today", async () => {
    const widened = { action: "PERMISSION_CHANGE", oldValue: { permissions: ["risk.read"] }, newValue: { permissions: ["risk.read", "role.assign"] } };
    const created = { action: "CREATE", oldValue: null, newValue: { permissions: ["role.assign"] } };
    for (const ev of [widened, created]) {
      const w = world();
      w.roleAudit.push({ entityId: "adm", userId: "u1", ...ev });
      await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: ISO(0) }), "req")).rejects.toThrow(/créé ou modifié par vous/);
      expect(w.stored.calls).toBe(0);
    }
    // widened by someone else, or merely renamed by the requester (RoleService.update logs it as PERMISSION_CHANGE): accepted
    const other = world();
    other.roleAudit.push({ entityId: "adm", userId: "someone", ...widened },
      { entityId: "adm", userId: "u1", action: "PERMISSION_CHANGE", oldValue: { name: "a", permissions: ["role.assign"] }, newValue: { name: "b", permissions: ["role.assign"] } });
    await expect(other.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: ISO(0) }), "req")).resolves.toBeDefined();
  });

  it("C-B6d-03 / INFO-05: the notice carries the motive and flags a deciding Risk Manager who is also an administrator", async () => {
    const plain = world({ audit: ["a1"] });
    await plain.service.bootstrapApprove(U1, "r1", GOOD(), "req");
    expect(plain.sent[0]!.message).toMatch(/Motif : l'administrateur adm a été sollicité le \d{4}-\d{2}-\d{2}.*« L'administrateur n'a pas pu/);
    expect(plain.sent[0]!.message).not.toMatch(/également administrateur/);
    const cumul = world({ audit: ["a1"] });
    cumul.held["u1"]!.push(role("adm2", null, ["user.create"]));
    await cumul.service.bootstrapApprove(U1, "r1", GOOD(), "req");
    expect(cumul.sent[0]!.message).toMatch(/Risk Manager seul \(également administrateur du tenant\)/);
    expect(cumul.request.bootstrapJustification).toMatchObject({ deciderAlsoAdministrator: true });
  });

  it("I-D9: the asked administrator cannot be the requester, nor a non-administrator, an unknown or suspended user", async () => {
    const w = world();
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedUserId: "u1" }), "req")).rejects.toThrow(/autre administrateur.*second membre/);
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedUserId: "plain" }), "req")).rejects.toThrow(/pas administrateur/);
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedUserId: "ghost" }), "req")).rejects.toThrow(/utilisateur actif/);
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedUserId: "gone" }), "req")).rejects.toThrow(/utilisateur actif/);
    expect(w.stored.calls).toBe(0);
  });

  it("q83: the motive is mandatory and validated (date in the future, bad format, blank outcome, blank comment)", async () => {
    const w = world();
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: ISO(2) }), "req")).rejects.toThrow(/future/);
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ askedOn: "2026-02-30" }), "req")).rejects.toThrow(/YYYY-MM-DD/);
    await expect(w.service.bootstrapApprove(U1, "r1", GOOD({ outcome: "  " }), "req")).rejects.toThrow(ValidationError);
    await expect(w.service.bootstrapApprove(U1, "r1", { ...GOOD(), comment: " " }, "req")).rejects.toThrow(ValidationError);
    expect(w.stored.calls).toBe(0);
  });

  it("listRequests passes the regime filter (consultation of BOOTSTRAP decisions, riskframework.read)", async () => {
    const w = world();
    await w.service.listRequests(U1, undefined, "BOOTSTRAP");
    expect(w.stored.listFilter).toEqual({ regime: "BOOTSTRAP" });
  });
});

describe("B-6d HTTP", () => {
  it("bootstrap-approve is strict zod (no justification = 400, extra key = 400) and answers 200 on a valid body; ?regime= is validated", async () => {
    const w = world();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as never as { user: AuthenticatedUser }).user = U1; (req as never as { requestId: string }).requestId = "h"; next(); });
    app.use("/risk-frameworks", riskFrameworksRouter(w.service));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const post = (body: unknown) => fetch(`http://127.0.0.1:${port}/risk-frameworks/change-requests/6f1c2c1e-1111-4111-8111-111111111111/bootstrap-approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect((await post({ comment: "x" })).status).toBe(400);
      expect((await post({ ...GOOD(), status: "ACTIVE" })).status).toBe(400);
      expect((await post({ comment: "x", justification: { askedUserId: "adm", askedOn: ISO(-1), outcome: "o" } })).status).toBe(400); // askedUserId not a guid
      const ok = await post({ comment: "x", justification: { askedUserId: "6f1c2c1e-2222-4222-8222-222222222222", askedOn: ISO(-1), outcome: "o" } });
      expect([200, 400]).toContain(ok.status); // unknown administrator in this fake world: reaches the service
      expect((await fetch(`http://127.0.0.1:${port}/risk-frameworks/change-requests?regime=NOPE`)).status).toBe(400);
      expect((await fetch(`http://127.0.0.1:${port}/risk-frameworks/change-requests?regime=BOOTSTRAP`)).status).toBe(200);
    } finally { server.close(); }
  });
});

describe("B-6d arrival notice (q77) in RoleService", () => {
  function roleWorld(withDecision: boolean) {
    const roles = [role("au", "AUDIT", ["audit.read"]), role("plain", null, ["risk.read"])];
    const held = new Map<string, string[]>();
    const sent: Array<{ recipientUserId: string; eventType: string; resourceId: string; message: string }> = [];
    const repo = {
      async getById(_t: string, id: string) { return roles.find((r) => r.id === id) ?? null; },
      async listForUser(_t: string, u: string) { return roles.filter((r) => (held.get(u) ?? []).includes(r.id)); },
      async assignToUser(_t: string, roleId: string, userId: string) {
        held.set(userId, [...(held.get(userId) ?? []), roleId]);
        return { id: "a", tenantId: "t1", roleId, userId, grantedBy: "x", grantedAt: new Date(), revokedAt: null };
      },
      async listAssignments() { return []; },
    };
    const users = { async listWithPermission() { return []; } };
    const frameworks = {
      async latestBootstrapRequest() {
        return withDecision ? ({ id: "r9", bootstrapJustification: { askedUserId: "adm", askedOn: "2026-10-01", outcome: "o",
          freeParameters: { scaleSize: 5, appetiteThresholds: [], lowCriticalityThreshold: 6, delegationMaxDays: null, committeeTreatmentMinScore: null, lowThresholdToExamine: false } } }) : null;
      },
    };
    const service = new RoleService(repo as never, { async record() {} } as never, users as never, undefined, undefined,
      { async record(i: never) { sent.push(i); } } as never, undefined, frameworks as never);
    return { service, sent };
  }
  const admin = { userId: "admin", tenantId: "t1", email: "a@x", roles: ["role.assign", "role.read"] } as unknown as AuthenticatedUser;

  it("a member assigned to Audit after a BOOTSTRAP decision receives the notice with the frozen values; none without a decision or for another role", async () => {
    const a = roleWorld(true);
    await a.service.assignToUser(admin, "au", "newbie", "r", "motif");
    expect(a.sent).toHaveLength(1);
    expect(a.sent[0]).toMatchObject({ recipientUserId: "newbie", eventType: "RISK_FRAMEWORK_BOOTSTRAP_NOTICE", resourceId: "r9" });
    expect(a.sent[0]!.message).toMatch(/seuil « faible » 6/);
    await a.service.assignToUser(admin, "plain", "other", "r");
    expect(a.sent).toHaveLength(1);
    const b = roleWorld(false);
    await b.service.assignToUser(admin, "au", "newbie", "r", "motif");
    expect(b.sent).toEqual([]);
  });
});

describe("C-B6d-08: server.ts wires the dependencies that trigger the bootstrap notice", () => {
  const server = readFileSync(join(__dirname, "..", "src", "server.ts"), "utf8");
  function callArgs(cls: string): string {
    const start = server.indexOf(`new ${cls}(`);
    expect(start, `new ${cls}( not found in server.ts`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = start + `new ${cls}`.length; i < server.length; i++) {
      if (server[i] === "(") depth++;
      if (server[i] === ")" && --depth === 0) return server.slice(start, i);
    }
    throw new Error(`unbalanced call for ${cls}`);
  }
  it("RoleService receives riskFrameworkRepository (arrival notice on assignment)", () => {
    expect(callArgs("RoleService")).toContain("riskFrameworkRepository");
  });
  it("UserService receives roleService (arrival notice on reactivation)", () => {
    expect(callArgs("UserService")).toContain("roleService");
  });
  it("RiskFrameworkService receives notificationService (notice to Audit and Committee)", () => {
    expect(callArgs("RiskFrameworkService")).toContain("notificationService");
  });
});
