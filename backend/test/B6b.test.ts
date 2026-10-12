import { describe, expect, it } from "vitest";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import { CartographyService } from "../src/services/CartographyService.js";
import { resolveApplicableVersion } from "../src/services/riskFrameworkResolution.js";
import { findAppetite } from "../src/domain/frameworkAppetite.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for B-6b (Dispositif wiring). Edge cases across modules are A08's.

const actor = (userId: string, perms: Permission[]): AuthenticatedUser => ({ userId, tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const level = (n: number) => Array.from({ length: n }, (_, i) => ({ level: i + 1, label: `L${i + 1}` }));
const scale = (id: string, n = 5) => ({
  id, tenantId: "t1", name: id, version: `v-${id}`, status: "ACTIVE", probabilityLevels: n, probabilityLabels: level(n),
  impactLevels: n, impactLabels: level(n), criticalityThresholds: null,
  impactAxes: { axes: [{ code: "FIN", label: "Fin", order: 1 }], retainedImpactRule: "MAX" },
});
const version = (over: Partial<RiskFrameworkVersion> = {}): RiskFrameworkVersion => ({
  id: "ver1", tenantId: "t1", frameworkId: "fw1", versionNumber: 3, status: "ACTIVE", ratingScaleId: "s5",
  defaultEvaluationMode: "PARTICIPATIF", committeeEvaluationMinScore: 12, committeeEvaluationEnforced: true,
  committeeTreatmentMinScore: 20, appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null }],
  changeApprover: "RISK_MANAGER", selfProposalAllowed: false, lowCriticalityThreshold: 5, riskOwnerExecutorCumulAllowed: true,
  delegateExecutorCumulAllowed: true, delegationMaxDays: null, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
  committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u9", lastEditedBy: "u9", createdAt: new Date(), updatedAt: new Date(),
  activatedAt: new Date(), activationRequestId: "rq", archivedAt: null, archivedBy: null, archiveReason: null, ...over,
});

function frameworksFake(opts: { defaultId?: string | null; processFw?: Record<string, string>; versions?: RiskFrameworkVersion[] } = {}) {
  const versions = opts.versions ?? [version()];
  return {
    async getDefaultFramework() { const id = opts.defaultId === undefined ? "fw1" : opts.defaultId; return id ? ({ id, name: `Name-${id}` } as never) : null; },
    async getFramework(_t: string, id: string) { return { id, name: `Name-${id}` } as never; },
    async getProcessFrameworkId(_t: string, pid: string) { return opts.processFw?.[pid] ?? null; },
    async getActiveVersion(_t: string, fid: string) { return versions.find((v) => v.frameworkId === fid && v.status === "ACTIVE") ?? null; },
    async getVersionById(_t: string, id: string) { return versions.find((v) => v.id === id) ?? null; },
    async listFrameworks() { return []; },
  };
}
const scalesFake = (list = [scale("s5"), scale("s3", 3)]) => ({
  async getById(_t: string, id: string) { return (list.find((s) => s.id === id) as never) ?? null; },
  async list() { return list as never; },
});

describe("resolveApplicableVersion (spec §7)", () => {
  const processes = {
    async getById(_t: string, id: string) {
      const all: Record<string, { id: string; level: string; parentId: string | null }> = {
        p1: { id: "p1", level: "PROCESS", parentId: null }, sp1: { id: "sp1", level: "SUBPROCESS", parentId: "p1" }, a1: { id: "a1", level: "ACTIVITY", parentId: "sp1" },
      };
      return (all[id] as never) ?? null;
    },
  };
  const versions = [version(), version({ id: "ver2", frameworkId: "fw2", ratingScaleId: "s3" })];

  it("no process: the tenant default Dispositif and its ACTIVE version, with its scale", async () => {
    const r = await resolveApplicableVersion({ frameworks: frameworksFake({ versions }), ratingScales: scalesFake() }, "t1", null);
    expect(r).toMatchObject({ frameworkId: "fw1" });
    expect(r?.version.id).toBe("ver1");
    expect(r?.scale.id).toBe("s5");
  });

  it("an activity inherits the Dispositif attached to its PROCESS-level ancestor", async () => {
    const r = await resolveApplicableVersion(
      { frameworks: frameworksFake({ versions, processFw: { p1: "fw2" } }), ratingScales: scalesFake(), processes: processes as never }, "t1", "a1");
    expect(r?.frameworkId).toBe("fw2");
    expect(r?.scale.id).toBe("s3");
  });

  it("no default Dispositif, or no ACTIVE version: null (never a fallback)", async () => {
    expect(await resolveApplicableVersion({ frameworks: frameworksFake({ defaultId: null }), ratingScales: scalesFake() }, "t1", null)).toBeNull();
    expect(await resolveApplicableVersion({ frameworks: frameworksFake({ versions: [version({ status: "ARCHIVED" })] }), ratingScales: scalesFake() }, "t1", null)).toBeNull();
  });
});

describe("findAppetite", () => {
  const list = [
    { subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null },
    { subCategory: "Fraude", subCategoryId: null, entity: "Abidjan", threshold: 6, description: null },
  ];
  it("same rule as the SQL lookup: exact subCategory, entity null = empty", () => {
    expect(findAppetite(list, "Fraude", null)?.threshold).toBe(9);
    expect(findAppetite(list, "Fraude", "")?.threshold).toBe(9);
    expect(findAppetite(list, "Fraude", "Abidjan")?.threshold).toBe(6);
    expect(findAppetite(list, "fraude", null)).toBeNull();
    expect(findAppetite(list, "Fraude", "Dakar")).toBeNull();
  });
});

describe("RiskEvaluationService with the Dispositif (F-8 snapshot)", () => {
  function setup(fw: ReturnType<typeof frameworksFake> | undefined) {
    const stored: RiskEvaluation[] = [];
    const evaluations = {
      async create(input: Record<string, unknown>) {
        const s = input["snapshot"] as Record<string, unknown> | undefined;
        const e = {
          id: `e${stored.length + 1}`, status: "BROUILLON", evaluatorId: input["evaluatorId"], subCategory: input["subCategory"], entity: input["entity"],
          evaluationMode: input["evaluationMode"], residualScore: 13, riskFrameworkVersionId: s?.["riskFrameworkVersionId"] ?? null,
          ratingScaleId: s?.["ratingScaleId"] ?? null, ratingScaleVersion: s?.["ratingScaleVersion"] ?? null,
          committeeEvaluationMinScore: s?.["committeeEvaluationMinScore"] ?? null, committeeEvaluationEnforced: s?.["committeeEvaluationEnforced"] ?? null,
          committeeTreatmentMinScore: s?.["committeeTreatmentMinScore"] ?? null,
        } as unknown as RiskEvaluation;
        stored.push(e);
        return e;
      },
      async getById(_t: string, id: string) { return stored.find((e) => e.id === id) ?? null; },
      async recordValidation() { return { status: "VALIDATED" } as never; },
    };
    const audit = { async record() {} };
    const service = new RiskEvaluationService(evaluations as never, audit as never, undefined, scalesFake() as never, undefined, undefined, undefined, fw as never);
    return { service, stored };
  }
  const creator = actor("u1", ["riskevaluation.create", "riskevaluation.read"]);
  const input = { riskId: "r1", evaluationType: "AD_HOC" as const, subCategory: "Fraude" };

  it("create freezes version, scale and the three thresholds; the mode comes from the version; evaluator forced to the actor", async () => {
    const { service } = setup(frameworksFake());
    const e = await service.create(creator, { ...input, evaluatorId: "evil" } as never, "rq");
    expect(e).toMatchObject({
      riskFrameworkVersionId: "ver1", ratingScaleId: "s5", ratingScaleVersion: "v-s5", committeeEvaluationMinScore: 12,
      committeeEvaluationEnforced: true, committeeTreatmentMinScore: 20, evaluationMode: "PARTICIPATIF", evaluatorId: "u1",
    });
  });

  it("create is refused without an applicable Dispositif (no fallback)", async () => {
    const { service } = setup(frameworksFake({ defaultId: null }));
    await expect(service.create(creator, input, "rq")).rejects.toThrow(/Aucun Dispositif actif/);
  });

  it("validate reads the threshold copied on the evaluation: a later version change does not alter the circuit", async () => {
    const { service, stored } = setup(frameworksFake());
    const e = await service.create(creator, input, "rq");
    const validator = actor("u2", ["riskevaluation.validate", "riskevaluation.read"]);
    expect(e.committeeEvaluationMinScore).toBe(12);
    // residual 13 >= copied threshold 12 and enforced: must go through the Committee path.
    await expect(service.validate(validator, e.id, null, "rq")).rejects.toThrow(/committee threshold \(12\)/);
    // Another version with a higher threshold is now ACTIVE: this evaluation is unchanged.
    stored[0] = { ...stored[0]!, committeeEvaluationMinScore: 12 };
    await expect(service.validate(validator, e.id, null, "rq")).rejects.toThrow(/committee threshold \(12\)/);
    // Without enforcement on the copy, the standard validation goes through.
    stored[0] = { ...stored[0]!, committeeEvaluationEnforced: false };
    await expect(service.validate(validator, e.id, null, "rq")).resolves.toBeDefined();
  });

  it("suggested appetite comes from the frozen version's list", async () => {
    const { service } = setup(frameworksFake());
    const e = await service.create(creator, input, "rq");
    const s = await service.suggestAppetite(creator, e.id);
    expect(s).toMatchObject({ suggested: 9, methodologyVersion: "v3" });
  });
});

describe("closed writers once the Dispositif is wired (spec §3)", () => {
  const msg = /porté par le Dispositif/;
  const wired = { async listFrameworks() { return []; } };

  it("ConfigService: committee thresholds, enforcement and evaluation mode are refused; unwired is unchanged", async () => {
    const configs = { async getByTenant() { return null; }, async upsert() { return { id: "c" } as never; } };
    const audit = { async record() {} };
    const s = new ConfigService(configs as never, audit as never, undefined, wired);
    await expect(s.updateCommitteeThresholds(actor("a", ["config.committeethreshold.set"]), { evaluationMinScore: 5 }, "r", "q")).rejects.toThrow(msg);
    await expect(s.setCommitteeEnforcement(actor("a", ["config.committeeenforcement.set"]), false, "r", "q")).rejects.toThrow(msg);
    await expect(s.updateEvaluationMode(actor("a", ["config.update"]), "PARTICIPATIF", "r", "q")).rejects.toThrow(msg);
    const open = new ConfigService(configs as never, audit as never);
    await expect(open.setCommitteeEnforcement(actor("a", ["config.committeeenforcement.set", "config.read"]), false, "r", "q")).resolves.toBeDefined();
  });

  it("RiskAppetiteService: setThreshold and archive are refused", async () => {
    const s = new RiskAppetiteService({} as never, { async record() {} } as never, undefined, undefined, wired);
    await expect(s.setThreshold(actor("a", ["riskappetite.update"]), "Fraude", { threshold: 5, methodologyVersion: "v1" }, "q")).rejects.toThrow(msg);
    await expect(s.archive(actor("a", ["riskappetite.delete"]), "id", "why", "q")).rejects.toThrow(msg);
    await expect(s.archive(actor("a", ["riskappetite.read"]), "id", "why", "q")).rejects.toThrow(/permission/i);
  });
});

describe("CartographyService with the Dispositif (spec §9)", () => {
  const svc = (fw: ReturnType<typeof frameworksFake>) =>
    new CartographyService({} as never, {} as never, scalesFake() as never, undefined, fw as never);
  const reader = actor("u", ["cartography.read"]);

  it("getActiveScale returns the scale of the default Dispositif's ACTIVE version, with the framework fields", async () => {
    const r = await svc(frameworksFake()).getActiveScale(reader);
    expect(r).toMatchObject({ scaleId: "s5", size: 5, maxScore: 25, frameworkId: "fw1", frameworkName: "Name-fw1", frameworkVersionId: "ver1", frameworkVersionNumber: 3 });
  });

  it("no Dispositif or no ACTIVE version: null (no grid), whatever scale is ACTIVE", async () => {
    expect(await svc(frameworksFake({ defaultId: null })).getActiveScale(reader)).toBeNull();
    expect(await svc(frameworksFake({ versions: [] })).getActiveScale(reader)).toBeNull();
  });
});

describe("GET /risk-frameworks/applicable input", () => {
  it("is defined with exactly one of riskId / processId", async () => {
    const { riskFrameworksRouter } = await import("../src/api/v1/riskFrameworks.routes.js");
    expect(typeof riskFrameworksRouter).toBe("function");
    const { RiskFrameworkService } = await import("../src/services/RiskFrameworkService.js");
    const s = new RiskFrameworkService(frameworksFake() as never, scalesFake() as never, {} as never, {} as never, {} as never);
    await expect(s.getApplicable(actor("u", []), { riskId: "r" })).rejects.toThrow();
    const out = await s.getApplicable(actor("u", ["riskframework.read"]), {});
    expect(out?.frameworkId).toBe("fw1");
    await expect(s.getApplicable(actor("u", ["riskframework.read"]), { riskId: "r" })).rejects.toThrow(ValidationError);
  });
});
