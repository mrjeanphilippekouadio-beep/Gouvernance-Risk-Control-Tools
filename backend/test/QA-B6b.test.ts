import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { TreatmentDecisionService } from "../src/services/TreatmentDecisionService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import { CartographyService } from "../src/services/CartographyService.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { cartographyRouter } from "../src/api/v1/cartography.routes.js";
import { riskFrameworksRouter } from "../src/api/v1/riskFrameworks.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA pass on B-6b (commit 45cbd86). Oracles written from spec RM-V1-B6-Dispositif-spec.md §3, §7, §8.1, §9.
// Pure in-memory: PostgreSQL is NOT exercised here (see the report).

const T1 = "t1";
const T2 = "t2";
const actor = (userId: string, perms: Permission[], tenantId = T1): AuthenticatedUser =>
  ({ userId, tenantId, email: "a@x", roles: perms }) as AuthenticatedUser;
const lv = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const scale = (id: string, n = 5, bands = false) => ({
  id, tenantId: T1, name: id, version: `v-${id}`, status: "ACTIVE", probabilityLevels: n, probabilityLabels: lv(n), impactLevels: n, impactLabels: lv(n),
  criticalityThresholds: bands ? [{ min: 1, max: n * n, label: `BAND-${id}`, color: "#000" }] : null,
  impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1 }], retainedImpactRule: "MAX" },
});
const ver = (over: Partial<RiskFrameworkVersion> = {}): RiskFrameworkVersion => ({
  id: "ver1", tenantId: T1, frameworkId: "fw1", versionNumber: 1, status: "ACTIVE", ratingScaleId: "s5",
  defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 12, committeeEvaluationEnforced: true, committeeTreatmentMinScore: 20,
  appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null }],
  changeApprover: "RISK_MANAGER", selfProposalAllowed: false, lowCriticalityThreshold: 5, riskOwnerExecutorCumulAllowed: true,
  delegateExecutorCumulAllowed: true, delegationMaxDays: null, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
  committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u9", lastEditedBy: "u9", createdAt: new Date(), updatedAt: new Date(),
  activatedAt: new Date(), activationRequestId: "rq", archivedAt: null, archivedBy: null, archiveReason: null, ...over,
});

interface Fw { id: string; name: string; tenantId: string; isDefault: boolean }
function frameworksFake(fws: Fw[], versions: RiskFrameworkVersion[], procFw: Record<string, string> = {}) {
  return {
    async getDefaultFramework(t: string) { return (fws.find((f) => f.tenantId === t && f.isDefault) as never) ?? null; },
    async getFramework(t: string, id: string) { return (fws.find((f) => f.tenantId === t && f.id === id) as never) ?? null; },
    async getProcessFrameworkId(_t: string, pid: string) { return procFw[pid] ?? null; },
    async getActiveVersion(t: string, fid: string) { return versions.find((v) => v.tenantId === t && v.frameworkId === fid && v.status === "ACTIVE") ?? null; },
    async getVersionById(t: string, id: string) { return versions.find((v) => v.tenantId === t && v.id === id) ?? null; },
    async listFrameworks() { return []; },
  };
}
const scalesFake = (list: ReturnType<typeof scale>[]) => ({
  async getById(t: string, id: string) { return (list.find((s) => s.tenantId === t && s.id === id) as never) ?? null; },
  async list(t: string) { return list.filter((s) => s.tenantId === t) as never; },
});

const FWS: Fw[] = [
  { id: "fw1", name: "Default", tenantId: T1, isDefault: true },
  { id: "fw2", name: "Second", tenantId: T1, isDefault: false },
  { id: "fwX", name: "Other tenant", tenantId: T2, isDefault: true },
];

// A shared in-memory evaluation store that mimics the Postgres repository's snapshot handling.
function evalStore() {
  const rows: RiskEvaluation[] = [];
  return {
    rows,
    async create(input: Record<string, unknown>) {
      const s = input["snapshot"] as Record<string, unknown> | undefined;
      const e = {
        id: `e${rows.length + 1}`, tenantId: input["tenantId"], riskId: input["riskId"], status: "BROUILLON", evaluatorId: input["evaluatorId"],
        subCategory: input["subCategory"], entity: input["entity"] ?? null, evaluationMode: input["evaluationMode"], createdAt: new Date(rows.length),
        residualScore: null, riskFrameworkVersionId: s?.["riskFrameworkVersionId"] ?? null, ratingScaleId: s?.["ratingScaleId"] ?? null,
        ratingScaleVersion: s?.["ratingScaleVersion"] ?? null, committeeEvaluationMinScore: s?.["committeeEvaluationMinScore"] ?? null,
        committeeEvaluationEnforced: s?.["committeeEvaluationEnforced"] ?? null, committeeTreatmentMinScore: s?.["committeeTreatmentMinScore"] ?? null,
      } as unknown as RiskEvaluation;
      rows.push(e);
      return e;
    },
    async getById(t: string, id: string) { return rows.find((e) => e.tenantId === t && e.id === id) ?? null; },
    async listForRisk(t: string, riskId: string) { return rows.filter((e) => e.tenantId === t && e.riskId === riskId).reverse(); },
    async recordValidation() { return { status: "VALIDATED" } as never; },
  };
}
const audit = () => { const events: unknown[] = []; return { events, async record(e: unknown) { events.push(e); } }; };

function evaluationService(fws: ReturnType<typeof frameworksFake> | undefined, scales: ReturnType<typeof scale>[], opts: { configs?: unknown; risk?: { processId: string | null }; appetites?: unknown } = {}) {
  const store = evalStore();
  const risks = { async getById(t: string, id: string) { return id === "r1" ? ({ id, tenantId: t, processId: opts.risk?.processId ?? null } as never) : null; } };
  const processes = {
    async getById(_t: string, id: string) {
      const all: Record<string, unknown> = { p1: { id: "p1", level: "PROCESS", parentId: null, evaluationMode: null }, a1: { id: "a1", level: "ACTIVITY", parentId: "p1", evaluationMode: null } };
      return (all[id] as never) ?? null;
    },
  };
  const a = audit();
  const service = new RiskEvaluationService(store as never, a as never, risks as never, scalesFake(scales) as never, opts.appetites as never, processes as never, opts.configs as never, fws as never);
  return { service, store, audit: a };
}
const creator = actor("u1", ["riskevaluation.create", "riskevaluation.read"]);
const validator = actor("u2", ["riskevaluation.validate", "riskevaluation.read"]);
const input = { riskId: "r1", evaluationType: "AD_HOC" as const, subCategory: "Fraude" };

describe("QA-B6b F-8 snapshot: coherence under a concurrent version activation", () => {
  it("the snapshot is taken from ONE version even if the Dispositif switches version between the lookups", async () => {
    const v1 = ver({ id: "v1", ratingScaleId: "s5", committeeEvaluationMinScore: 12, committeeTreatmentMinScore: 20 });
    const v2 = ver({ id: "v2", versionNumber: 2, status: "DRAFT", ratingScaleId: "s3", committeeEvaluationMinScore: 4, committeeTreatmentMinScore: 6, defaultEvaluationMode: "PARTICIPATIF" });
    const versions = [v1, v2];
    const base = frameworksFake(FWS, versions);
    // Activation of v2 (v1 archived) lands right after getActiveVersion returned v1.
    const fw = { ...base, async getActiveVersion(t: string, f: string) { const r = await base.getActiveVersion(t, f); v1.status = "ARCHIVED"; v2.status = "ACTIVE"; return r; } };
    const { service } = evaluationService(fw as never, [scale("s5"), scale("s3", 3)]);
    const e = await service.create(creator, input, "rq");
    expect(e).toMatchObject({ riskFrameworkVersionId: "v1", ratingScaleId: "s5", committeeEvaluationMinScore: 12, committeeTreatmentMinScore: 20, evaluationMode: "CLASSIQUE" });
  });

  it("20 parallel creations while the version flips: every row is internally coherent (version, scale, thresholds from the same version)", async () => {
    const v1 = ver({ id: "v1", ratingScaleId: "s5", committeeEvaluationMinScore: 12 });
    const v2 = ver({ id: "v2", versionNumber: 2, status: "DRAFT", ratingScaleId: "s3", committeeEvaluationMinScore: 4 });
    const versions = [v1, v2];
    const base = frameworksFake(FWS, versions);
    let n = 0;
    const fw = {
      ...base,
      async getActiveVersion(t: string, f: string) {
        await Promise.resolve();
        if (++n === 7) { v1.status = "ARCHIVED"; v2.status = "ACTIVE"; }
        return base.getActiveVersion(t, f);
      },
    };
    const { service, store } = evaluationService(fw as never, [scale("s5"), scale("s3", 3)]);
    await Promise.all(Array.from({ length: 20 }, () => service.create(creator, input, "rq")));
    expect(store.rows).toHaveLength(20);
    for (const e of store.rows) {
      const expected = e.riskFrameworkVersionId === "v1" ? { s: "s5", m: 12 } : { s: "s3", m: 4 };
      expect([e.ratingScaleId, e.committeeEvaluationMinScore]).toEqual([expected.s, expected.m]);
    }
    expect(new Set(store.rows.map((e) => e.riskFrameworkVersionId))).toEqual(new Set(["v1", "v2"]));
  });

  it("an evaluation frozen on an ARCHIVED version keeps its appetite, scale and committee threshold (no re-read of the new ACTIVE one)", async () => {
    const v1 = ver({ id: "v1", appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null }] });
    const versions = [v1];
    const { service } = evaluationService(frameworksFake(FWS, versions), [scale("s5"), scale("s3", 3)]);
    const e = await service.create(creator, input, "rq");
    v1.status = "ARCHIVED";
    versions.push(ver({ id: "v2", versionNumber: 2, ratingScaleId: "s3", appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 2, description: null }], committeeEvaluationMinScore: 3 }));
    expect((await service.suggestAppetite(creator, e.id)).suggested).toBe(9);
    // Committee threshold: still the copied 12 (residual injected below 12 => no committee, above => committee).
    (e as { residualScore: number | null }).residualScore = 11;
    await expect(service.validate(validator, e.id, null, "rq")).resolves.toBeDefined();
    (e as { residualScore: number | null }).residualScore = 12;
    await expect(service.validate(validator, e.id, null, "rq")).rejects.toThrow(/committee threshold \(12\)/);
  });
});

describe("QA-B6b creation: resolution, refusal, attribution", () => {
  it("process chain: a risk under an ACTIVITY inherits the Dispositif of its PROCESS (scale + mode + thresholds of fw2)", async () => {
    const versions = [ver(), ver({ id: "ver2", frameworkId: "fw2", ratingScaleId: "s3", defaultEvaluationMode: "PARTICIPATIF", committeeEvaluationMinScore: 4 })];
    const fw = frameworksFake(FWS, versions, { p1: "fw2" });
    const { service } = evaluationService(fw, [scale("s5"), scale("s3", 3)], { risk: { processId: "a1" } });
    const e = await service.create(creator, input, "rq");
    expect(e).toMatchObject({ riskFrameworkVersionId: "ver2", ratingScaleId: "s3", evaluationMode: "PARTICIPATIF", committeeEvaluationMinScore: 4 });
  });

  it("the Dispositif mode is the tenant default but a process-level mode still wins (resolveInheritedEvaluationMode kept)", async () => {
    const versions = [ver({ defaultEvaluationMode: "PARTICIPATIF" })];
    const base = frameworksFake(FWS, versions);
    const store = evalStore();
    const processes = { async getById() { return { id: "p1", level: "PROCESS", parentId: null, evaluationMode: "CLASSIQUE" } as never; } };
    const risks = { async getById(t: string) { return { id: "r1", tenantId: t, processId: "p1" } as never; } };
    const service = new RiskEvaluationService(store as never, audit() as never, risks as never, scalesFake([scale("s5")]) as never, undefined, processes as never, undefined, base as never);
    expect((await service.create(creator, input, "rq")).evaluationMode).toBe("CLASSIQUE");
  });

  it("Config.evaluationMode is NOT read any more once the Dispositif is wired", async () => {
    const configs = { async getByTenant() { throw new Error("configs must not be read"); } };
    const { service } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")], { configs });
    await expect(service.create(creator, input, "rq")).resolves.toBeDefined();
  });

  it("refused (no row, no audit) when: no default Dispositif, no ACTIVE version, or the version's scale is gone; other tenant's Dispositif is not used", async () => {
    for (const [fws, versions, scales] of [
      [[], [ver()], [scale("s5")]],
      [FWS, [ver({ status: "ARCHIVED" }), ver({ id: "d", versionNumber: 2, status: "DRAFT" })], [scale("s5")]],
      [FWS, [ver()], []],
      [[FWS[2]!], [ver({ tenantId: T2, frameworkId: "fwX" })], [scale("s5")]],
    ] as const) {
      const { service, store, audit: a } = evaluationService(frameworksFake([...fws], [...versions]), [...scales]);
      await expect(service.create(creator, input, "rq")).rejects.toThrow(/Aucun Dispositif actif/);
      expect(store.rows).toHaveLength(0);
      expect(a.events).toHaveLength(0);
    }
  });

  it("wired Dispositif without a RatingScaleRepository: configuration error, nothing stored", async () => {
    const store = evalStore();
    const risks = { async getById(t: string) { return { id: "r1", tenantId: t, processId: null } as never; } };
    const service = new RiskEvaluationService(store as never, audit() as never, risks as never, undefined, undefined, undefined, undefined, frameworksFake(FWS, [ver()]) as never);
    await expect(service.create(creator, input, "rq")).rejects.toThrow(/RatingScaleRepository/);
    expect(store.rows).toHaveLength(0);
  });

  it("unknown risk is refused before any Dispositif lookup effect", async () => {
    const { service, store } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")]);
    await expect(service.create(creator, { ...input, riskId: "nope" }, "rq")).rejects.toThrow(ValidationError);
    expect(store.rows).toHaveLength(0);
  });
});

describe("QA-B6b appetite lookup on a frozen version", () => {
  const entries = [
    { subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null },
    { subCategory: "Fraude", subCategoryId: null, entity: "Abidjan", threshold: 6, description: null },
  ];
  it("exact subCategory (case-sensitive), entity null == '' ; unknown entity -> no suggestion (no fallback to the generic one) ; methodologyVersion only when found", async () => {
    const { service, store } = evaluationService(frameworksFake(FWS, [ver({ appetiteThresholds: entries, versionNumber: 4 })]), [scale("s5")]);
    const e = await service.create(creator, input, "rq");
    const set = (sub: string, entity: string | null) => { Object.assign(store.rows[0]!, { subCategory: sub, entity }); return service.suggestAppetite(creator, e.id); };
    expect(await set("Fraude", null)).toMatchObject({ suggested: 9, methodologyVersion: "v4" });
    expect(await set("Fraude", "")).toMatchObject({ suggested: 9 });
    expect(await set("Fraude", "Abidjan")).toMatchObject({ suggested: 6 });
    expect(await set("Fraude", "Dakar")).toEqual({ subCategory: "Fraude", entity: "Dakar", suggested: null, methodologyVersion: null });
    expect(await set("fraude", null)).toMatchObject({ suggested: null, methodologyVersion: null });
  });

  it("the legacy risk_appetites table is NOT consulted for an evaluation frozen on a version", async () => {
    const appetites = { async getBySubCategory() { throw new Error("risk_appetites must not be read"); } };
    const { service } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")], { appetites });
    const e = await service.create(creator, input, "rq");
    expect((await service.suggestAppetite(creator, e.id)).suggested).toBe(9);
  });

  it("a frozen version that vanished -> ValidationError; Dispositif not wired -> fail closed (Error), never a silent 'no appetite'", async () => {
    const versions = [ver()];
    const { service, store } = evaluationService(frameworksFake(FWS, versions), [scale("s5")]);
    const e = await service.create(creator, input, "rq");
    versions.length = 0;
    await expect(service.suggestAppetite(creator, e.id)).rejects.toThrow(ValidationError);
    store.rows[0]!.riskFrameworkVersionId = "ver1";
    const unwired = new RiskEvaluationService(store as never, audit() as never);
    await expect(unwired.suggestAppetite(creator, e.id)).rejects.toThrow(/RiskFrameworkRepository/);
  });

  it("legacy row (no version): historical read of risk_appetites, retired threshold ignored (SEC-015)", async () => {
    const calls: string[] = [];
    const appetites = {
      async getBySubCategory(_t: string, sub: string) { calls.push(sub); return { threshold: 7, active: false, methodologyVersion: "old" } as never; },
    };
    const { service, store } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")], { appetites });
    const e = await service.create(creator, input, "rq");
    store.rows[0]!.riskFrameworkVersionId = null;
    expect(await service.suggestAppetite(creator, e.id)).toMatchObject({ suggested: null });
    expect(calls).toEqual(["Fraude"]);
  });
});

describe("QA-B6b copied thresholds missing on the evaluation (fakes / raw inserts)", () => {
  it("version set + copied evaluation threshold NULL: validate falls back to configs / default (PINNED OBSERVATION QA-B6b-01 — differs from TreatmentDecision)", async () => {
    // The CHECK of 059 leaves the columns nullable; the service always writes them, so only a raw insert gets here.
    const configs = { async getByTenant() { return { committeeEvaluationMinScore: 3, committeeEvaluationEnforced: true }; } };
    const { service, store } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")], { configs });
    const e = await service.create(creator, input, "rq");
    Object.assign(store.rows[0]!, { committeeEvaluationMinScore: null, committeeEvaluationEnforced: null, residualScore: 5 });
    // Spec §8.1 says configs are no longer read; today residual 5 >= configs 3 forces the Committee path.
    await expect(service.validate(validator, e.id, null, "rq")).rejects.toThrow(/committee threshold \(3\)/);
  });

  it("min set but enforced NULL: fail closed to enforced=true", async () => {
    const { service, store } = evaluationService(frameworksFake(FWS, [ver()]), [scale("s5")]);
    const e = await service.create(creator, input, "rq");
    Object.assign(store.rows[0]!, { committeeEvaluationEnforced: null, residualScore: 12 });
    await expect(service.validate(validator, e.id, null, "rq")).rejects.toThrow(/committee threshold \(12\)/);
  });

  it("enforced=false on the copy lets a high score through the ordinary path, but validate-committee keeps its floor", async () => {
    const { service, store } = evaluationService(frameworksFake(FWS, [ver({ committeeEvaluationEnforced: false })]), [scale("s5")]);
    const e = await service.create(creator, input, "rq");
    Object.assign(store.rows[0]!, { residualScore: 25 });
    await expect(service.validate(validator, e.id, null, "rq")).resolves.toBeDefined();
    Object.assign(store.rows[0]!, { residualScore: 11 });
    await expect(service.validateByCommittee(actor("u3", ["riskevaluation.validate.committee", "riskevaluation.read"]), e.id, null, "rq")).rejects.toThrow(/committee threshold \(12\)/);
  });

  describe("TreatmentDecisionService.validateByCommittee", () => {
    function treat(evaluation: Record<string, unknown>, configTreat: number | null) {
      const decision = { id: "d1", tenantId: T1, status: "PROPOSEE", decidedBy: "u1", validatorId: "u3", riskEvaluationId: "e1", riskId: "r1" };
      const decisions = { async getById() { return decision; }, async recordCommitteeValidation() { return { ...decision, status: "VALIDEE_COMITE" }; } };
      const evals = { async getById() { return evaluation; } };
      const configs = { async getByTenant() { return { committeeTreatmentMinScore: configTreat }; } };
      return new TreatmentDecisionService(decisions as never, evals as never, {} as never, audit() as never, configs as never);
    }
    const committee = actor("u3", ["treatmentdecision.validate.committee"]);

    it("version set + copied treatment threshold present: used, configs ignored even if lower", async () => {
      const s = treat({ riskFrameworkVersionId: "v", committeeTreatmentMinScore: 20, residualScore: 15 }, 1);
      await expect(s.validateByCommittee(committee, "d1", null, "rq")).rejects.toThrow(/threshold \(20\)/);
    });
    it("version set + copied treatment threshold NULL (version without one): refused fail-closed, configs never consulted even when they hold a value", async () => {
      const s = treat({ riskFrameworkVersionId: "v", committeeTreatmentMinScore: null, residualScore: 25 }, 1);
      await expect(s.validateByCommittee(committee, "d1", null, "rq")).rejects.toThrow(/No committee threshold/);
    });
    it("legacy evaluation (no version) without a copy: falls back to configs; with a copy: the copy wins", async () => {
      await expect(treat({ riskFrameworkVersionId: null, committeeTreatmentMinScore: null, residualScore: 25 }, 10).validateByCommittee(committee, "d1", null, "rq")).resolves.toMatchObject({ status: "VALIDEE_COMITE" });
      await expect(treat({ riskFrameworkVersionId: null, committeeTreatmentMinScore: 30, residualScore: 25 }, 10).validateByCommittee(committee, "d1", null, "rq")).rejects.toThrow(/threshold \(30\)/);
    });
    it("maker-checker kept: the proposer is refused even when the copied threshold is cleared", async () => {
      const s = treat({ riskFrameworkVersionId: "v", committeeTreatmentMinScore: 10, residualScore: 25 }, null);
      await expect(s.validateByCommittee(actor("u1", ["treatmentdecision.validate.committee"]), "d1", null, "rq")).rejects.toThrow(ForbiddenError);
    });
    it("missing parent evaluation: ValidationError, no validation recorded", async () => {
      const s = treat(null as never, 10);
      await expect(s.validateByCommittee(committee, "d1", null, "rq")).rejects.toThrow(ValidationError);
    });
  });
});

describe("QA-B6b closed writers (spec §3)", () => {
  const msg = /porté par le Dispositif/;
  const wired = { async listFrameworks() { return []; } };
  function cfg(withFw: boolean) {
    const writes: unknown[] = [];
    const a = audit();
    const configs = { async getByTenant() { return null; }, async upsert(...args: unknown[]) { writes.push(args); return { id: "c" } as never; } };
    return { service: new ConfigService(configs as never, a as never, undefined, withFw ? wired : undefined), writes, audit: a };
  }

  it("each closed ConfigService writer: no upsert, no audit, message names the Dispositif", async () => {
    const { service, writes, audit: a } = cfg(true);
    const p = (...x: Permission[]) => actor("a", x);
    await expect(service.updateCommitteeThresholds(p("config.committeethreshold.set"), { evaluationMinScore: 5, treatmentMinScore: 6 }, "r", "q")).rejects.toThrow(msg);
    await expect(service.setCommitteeEnforcement(p("config.committeeenforcement.set", "config.read"), true, "r", "q")).rejects.toThrow(msg);
    await expect(service.updateEvaluationMode(p("config.update"), "PARTICIPATIF", "r", "q")).rejects.toThrow(msg);
    expect(writes).toHaveLength(0);
    expect(a.events).toHaveLength(0);
  });

  it("the permission gate still comes first: without the permission it is a 403, not the 'owned by Dispositif' hint", async () => {
    const { service } = cfg(true);
    await expect(service.updateCommitteeThresholds(actor("a", []), { evaluationMinScore: 5 }, "r", "q")).rejects.toThrow(ForbiddenError);
    await expect(service.setCommitteeEnforcement(actor("a", []), true, "r", "q")).rejects.toThrow(ForbiddenError);
    await expect(service.updateEvaluationMode(actor("a", []), "PARTICIPATIF", "r", "q")).rejects.toThrow(ForbiddenError);
  });

  it("an empty reason still answers the Dispositif message first (closure precedes reason validation) — no write either way", async () => {
    const { service, writes } = cfg(true);
    await expect(service.setCommitteeEnforcement(actor("a", ["config.committeeenforcement.set"]), false, "", "q")).rejects.toThrow(msg);
    expect(writes).toHaveLength(0);
  });

  it("what the spec keeps in configs stays writable with the Dispositif wired: committee/audit cumul (q58), methodology, appetite mode", async () => {
    const { service, writes } = cfg(true);
    await expect(service.setCommitteeAuditCumul(actor("a", ["config.cumul.set", "config.read"]), false, "r", "q")).resolves.toBeDefined();
    await expect(service.updateAppetiteMode(actor("a", ["config.update"]), "MANUAL" as never, "r", "q")).rejects.not.toThrow(msg);
    expect(writes.length).toBeGreaterThan(0);
  });

  it("RiskAppetiteService: setThreshold (create, update and active:false) and archive refused with nothing written; permission checked first", async () => {
    const calls: string[] = [];
    const repo = new Proxy({}, { get: (_t, k) => async () => { calls.push(String(k)); return null; } });
    const a = audit();
    const s = new RiskAppetiteService(repo as never, a as never, undefined, undefined, wired);
    await expect(s.setThreshold(actor("a", ["riskappetite.update"]), "Fraude", { threshold: 5, methodologyVersion: "v1" }, "q")).rejects.toThrow(msg);
    await expect(s.setThreshold(actor("a", ["riskappetite.update", "riskappetite.delete"]), "Fraude", { threshold: 5, methodologyVersion: "v1", active: false }, "q")).rejects.toThrow(msg);
    await expect(s.archive(actor("a", ["riskappetite.delete"]), "id", "why", "q")).rejects.toThrow(msg);
    await expect(s.setThreshold(actor("a", []), "Fraude", { threshold: 5, methodologyVersion: "v1" }, "q")).rejects.toThrow(ForbiddenError);
    // active:false needs the dedicated delete permission BEFORE the closure message (SEC-014 gate kept)
    await expect(s.setThreshold(actor("a", ["riskappetite.update"]), "Fraude", { threshold: 5, methodologyVersion: "v1", active: false }, "q")).rejects.toThrow(ForbiddenError);
    expect(calls).toEqual([]);
    expect(a.events).toHaveLength(0);
  });
});

describe("QA-B6b cartography", () => {
  const S = [scale("s5", 5, true), scale("s3", 3, true)];
  function world(opts: { wired?: boolean; fws?: Fw[]; versions?: RiskFrameworkVersion[] } = {}) {
    const versions = opts.versions ?? [
      ver({ id: "v1", frameworkId: "fw1", ratingScaleId: "s5" }),
      ver({ id: "v2", frameworkId: "fw2", ratingScaleId: "s3" }),
      ver({ id: "vX", tenantId: T2, frameworkId: "fwX" }),
    ];
    const fw = frameworksFake(opts.fws ?? FWS, versions);
    const risks = ["r1", "r2", "r3", "r4"].map((id) => ({ id, tenantId: T1, status: "VALIDE", process: "P", processId: null, department: null }));
    const evals: Partial<RiskEvaluation>[] = [];
    const add = (riskId: string, versionId: string | null, scaleId: string | null, score = 10) =>
      evals.push({ id: `ev-${riskId}`, tenantId: T1, riskId, status: "VALIDATED", subCategory: "Fraude", entity: null, createdAt: new Date(), riskFrameworkVersionId: versionId, ratingScaleId: scaleId,
        inherentProbability: 2, inherentImpactRetained: 5, inherentScore: score, residualProbability: 2, residualImpactRetained: 5, residualScore: score });
    const riskRepo = { async list(t: string) { return risks.filter((r) => r.tenantId === t) as never; }, async getById() { return null; } };
    const evalRepo = { async listForRisk(t: string, riskId: string) { return evals.filter((e) => e.tenantId === t && e.riskId === riskId) as never; } };
    const service = new CartographyService(riskRepo as never, evalRepo as never, scalesFake(S) as never, undefined, opts.wired === false ? undefined : (fw as never));
    return { service, add, evals, versions };
  }
  const reader = actor("u", ["cartography.read"]);
  const ids = (pts: { riskId: string }[]) => pts.map((p) => p.riskId).sort();

  it("legacy rows (no version) appear with the default Dispositif only, flagged frameworkVersionId null; versioned rows only with their own", async () => {
    const w = world();
    w.add("r1", null, "s5"); w.add("r2", "v1", "s5"); w.add("r3", "v2", "s3");
    const dflt = await w.service.getCartography(reader);
    expect(ids(dflt)).toEqual(["r1", "r2"]);
    expect(dflt.find((p) => p.riskId === "r1")).toMatchObject({ frameworkVersionId: null });
    expect(dflt.find((p) => p.riskId === "r2")).toMatchObject({ frameworkVersionId: "v1" });
    expect(ids(await w.service.getCartography(reader, "residual", { frameworkId: "fw1" }))).toEqual(["r1", "r2"]);
    const other = await w.service.getCartography(reader, "residual", { frameworkId: "fw2" });
    expect(ids(other)).toEqual(["r3"]);
    expect(other[0]).toMatchObject({ frameworkVersionId: "v2" });
  });

  it("each point keeps the bands of ITS OWN evaluation's scale (not of the shown Dispositif's active scale)", async () => {
    const w = world();
    w.add("r1", "v1", "s5");
    const pts = await w.service.getCartography(reader, "residual", { frameworkId: "fw1" });
    expect(JSON.stringify(pts[0])).toContain("BAND-s5");
  });

  it("no default Dispositif: legacy rows still shown, versioned rows hidden, scale null", async () => {
    const w = world({ fws: [FWS[1]!, FWS[2]!] });
    w.add("r1", null, "s5"); w.add("r2", "v1", "s5");
    expect(ids(await w.service.getCartography(reader))).toEqual(["r1"]);
    expect(await w.service.getActiveScale(reader)).toBeNull();
  });

  it("frameworkId of another tenant / unknown: no point (not even legacy) and scale null; nothing of the other tenant leaks", async () => {
    const w = world();
    w.add("r1", null, "s5"); w.add("r2", "v1", "s5");
    for (const id of ["fwX", "11111111-1111-4111-8111-111111111111"]) {
      expect(await w.service.getCartography(reader, "residual", { frameworkId: id })).toEqual([]);
      expect(await w.service.getActiveScale(reader, id)).toBeNull();
    }
  });

  it("an evaluation pointing to a version of another tenant (getVersionById null) is hidden, never attributed to the default", async () => {
    const w = world();
    w.add("r1", "vX", "s5"); w.add("r2", "ghost", "s5");
    expect(await w.service.getCartography(reader)).toEqual([]);
  });

  it("round trip after a new version of the SAME Dispositif is activated: the evaluation frozen on the archived version is still shown, scale view follows the new ACTIVE one", async () => {
    const w = world();
    w.add("r2", "v1", "s5");
    w.versions[0]!.status = "ARCHIVED";
    w.versions.push(ver({ id: "v1b", versionNumber: 2, frameworkId: "fw1", ratingScaleId: "s3" }));
    expect(ids(await w.service.getCartography(reader))).toEqual(["r2"]);
    expect(await w.service.getActiveScale(reader)).toMatchObject({ scaleId: "s3", frameworkVersionId: "v1b", frameworkVersionNumber: 2 });
  });

  it("compare() applies the same Dispositif filter to both sides", async () => {
    const w = world();
    w.add("r1", null, "s5"); w.add("r3", "v2", "s3");
    const c = await w.service.compare(reader, { frameworkId: "fw2" });
    expect([ids(c.inherent), ids(c.residual)]).toEqual([["r3"], ["r3"]]);
    const d = await w.service.compare(reader);
    expect([ids(d.inherent), ids(d.residual)]).toEqual([["r1"], ["r1"]]);
  });

  it("not wired: frameworkId is ignored, no framework fields on points (pre-B-6b behaviour)", async () => {
    const w = world({ wired: false });
    w.add("r1", null, "s5"); w.add("r3", "v2", "s3");
    const pts = await w.service.getCartography(reader, "residual", { frameworkId: "fw2" });
    expect(ids(pts)).toEqual(["r1", "r3"]);
    expect(pts[0]).not.toHaveProperty("frameworkVersionId");
  });

  it("permission is checked before anything (403 without cartography.read, any frameworkId)", async () => {
    const w = world();
    await expect(w.service.getActiveScale(actor("u", []), "fw1")).rejects.toThrow(ForbiddenError);
    await expect(w.service.getCartography(actor("u", []))).rejects.toThrow(ForbiddenError);
  });

  it("HTTP: frameworkId malformed -> 400 on all three routes; valid -> 200; combined with the other filters", async () => {
    const w = world();
    w.add("r1", null, "s5"); w.add("r3", "v2", "s3", 4);
    const app = express();
    app.use((req, _res, next) => { (req as never as { user: AuthenticatedUser }).user = reader; next(); });
    app.use("/c", cartographyRouter(w.service));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const get = async (p: string) => { const r = await fetch(`http://127.0.0.1:${port}/c${p}`); return { status: r.status, json: await r.json().catch(() => null) as { data: never } | null }; };
      for (const p of ["/", "/scale", "/compare"]) {
        for (const bad of ["abc", "1", "'; DROP TABLE x;--", "%00", "fw1 "]) expect((await get(`${p}?frameworkId=${encodeURIComponent(bad)}`)).status).toBe(400);
      }
      const GOOD = "22222222-2222-4222-8222-222222222222";
      expect((await get(`/?frameworkId=${GOOD}`))).toMatchObject({ status: 200, json: { data: [] } });
      expect((await get(`/scale?frameworkId=${GOOD}`))).toMatchObject({ status: 200, json: { data: null } });
      expect((await get(`/compare?frameworkId=${GOOD}`)).status).toBe(200);
      // repeated parameter: array value -> not a string
      expect([200, 400]).toContain((await get(`/?frameworkId=${GOOD}&frameworkId=${GOOD}`)).status);
    } finally {
      server.close();
    }
  });
});

describe("QA-B6b GET /risk-frameworks/applicable", () => {
  function svc() {
    const versions = [ver(), ver({ id: "ver2", frameworkId: "fw2", ratingScaleId: "s3" })];
    const fw = frameworksFake(FWS, versions, { p1: "fw2" });
    const risks = { async getById(t: string, id: string) { return t === T1 && id === "11111111-1111-4111-8111-111111111111" ? ({ processId: "a1" } as never) : null; } };
    const processes = {
      async getById(t: string, id: string) {
        const all: Record<string, unknown> = { p1: { id: "p1", level: "PROCESS", parentId: null }, a1: { id: "a1", level: "ACTIVITY", parentId: "p1" } };
        return t === T1 ? ((all[id] as never) ?? null) : null;
      },
    };
    return new RiskFrameworkService(fw as never, scalesFake([scale("s5"), scale("s3", 3)]) as never, {} as never, {} as never, {} as never, undefined as never, undefined as never, risks as never, processes as never);
  }
  const RISK = "11111111-1111-4111-8111-111111111111";
  const PROC = "22222222-2222-4222-8222-222222222222";

  async function http(fn: (call: (path: string, as?: AuthenticatedUser) => Promise<{ status: number; json: { data?: unknown; error?: string } | null }>) => Promise<void>) {
    let current = actor("u", ["riskframework.read"]);
    const app = express();
    app.use((req, _res, next) => { (req as never as { user: AuthenticatedUser }).user = current; next(); });
    app.use("/rf", riskFrameworksRouter(svc() as never));
    app.use(errorHandler);
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      await fn(async (p, as) => { if (as) current = as; const r = await fetch(`http://127.0.0.1:${port}/rf${p}`); return { status: r.status, json: await r.json().catch(() => null) }; });
    } finally {
      server.close();
    }
  }

  it("400 for neither / both / malformed ids; 403 without riskframework.read; the route is not swallowed by /:id", async () => {
    await http(async (call) => {
      expect((await call("/applicable")).status).toBe(400);
      expect((await call(`/applicable?riskId=${RISK}&processId=${PROC}`)).status).toBe(400);
      expect((await call("/applicable?riskId=nope")).status).toBe(400);
      expect((await call("/applicable?processId=")).status).toBe(400);
      expect((await call(`/applicable?riskId=${RISK}`, actor("u", []))).status).toBe(403);
    });
  });

  it("risk -> chain -> PROCESS Dispositif fw2 (200 with the version and its scale id); unknown risk/process 404; other tenant 404", async () => {
    await http(async (call) => {
      const ok = await call(`/applicable?riskId=${RISK}`, actor("u", ["riskframework.read"]));
      expect(ok.status).toBe(200);
      expect(ok.json?.data).toMatchObject({ frameworkId: "fw2", ratingScaleId: "s3" });
      expect((await call("/applicable?riskId=33333333-3333-4333-8333-333333333333")).status).toBe(404);
      expect((await call("/applicable?processId=33333333-3333-4333-8333-333333333333")).status).toBe(404);
      expect((await call(`/applicable?riskId=${RISK}`, actor("u", ["riskframework.read"], T2))).status).toBe(404);
    });
  });
});

describe("QA-B6b static guarantees behind the loosened tests", () => {
  const repoSrc = readFileSync("src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.ts", "utf8");
  const mirror = repoSrc.slice(repoSrc.indexOf("mirrorScale"));

  it("mirrorScale (activation guard) no longer reads configs / risk_appetites, and still reads rating_scales with tenant_id = $1", () => {
    expect(mirror).not.toMatch(/FROM\s+configs/i);
    expect(mirror).not.toMatch(/FROM\s+risk_appetites/i);
    expect(mirror).toMatch(/rating_scales[\s\S]{0,400}tenant_id = \$1/);
  });

  it("the version-carried thresholds are still checked against the smallest ceiling (evaluation, treatment, appetite labels kept)", () => {
    for (const label of ["seuil Comité évaluation de la version", "seuil Comité traitement de la version", "de la version"]) expect(repoSrc).toContain(label);
  });

  it("059: evaluation snapshot columns nullable, ranges 1..36, backfill limited to rows with an empty copy, version id left NULL (nothing is claimed)", () => {
    const mig = readFileSync("../database/postgresql/migrations/059_risk_framework_branching.sql", "utf8");
    expect(mig).toMatch(/risk_framework_version_id uuid REFERENCES risk_framework_versions \(id\)/);
    expect(mig).toMatch(/WHERE e\.committee_evaluation_min_score IS NULL OR e\.committee_evaluation_enforced IS NULL/);
    expect(mig).not.toMatch(/SET[^;]*risk_framework_version_id\s*=/);
    expect(mig).not.toMatch(/\bDELETE\s+FROM\b|\bDROP\s+TABLE\b/i);
  });

  it("PostgresRiskEvaluationRepository.create writes all six snapshot columns in order and has no UPDATE path for them", () => {
    const src = readFileSync("src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.ts", "utf8");
    expect(src).toMatch(/risk_framework_version_id, rating_scale_id, rating_scale_version,\s+committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score\)\s+VALUES \(\$1, \$2, \$3, 'BROUILLON', \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11, \$12, \$13\)/);
    expect(src).not.toMatch(/SET[^`]*risk_framework_version_id/);
    expect(src).not.toMatch(/SET[^`]*committee_(evaluation|treatment)_/);
  });
});
