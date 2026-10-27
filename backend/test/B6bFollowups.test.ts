import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import { DashboardService } from "../src/services/DashboardService.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Permission } from "../src/domain/permissions.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { RiskFrameworkVersion } from "../src/domain/entities/RiskFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level 1 tests for the B-6b follow-ups (B-6b-01/02/04/05, F-B6b-01/03, QA-B6b-01). Edge cases are A08's.

const actor = (perms: Permission[]): AuthenticatedUser => ({ userId: "u1", tenantId: "t1", email: "a@x", roles: perms }) as AuthenticatedUser;
const version = (over: Partial<RiskFrameworkVersion> = {}): RiskFrameworkVersion => ({
  id: "ver1", tenantId: "t1", frameworkId: "fw1", versionNumber: 2, status: "ACTIVE", ratingScaleId: "s5",
  defaultEvaluationMode: "CLASSIQUE", committeeEvaluationMinScore: 12, committeeEvaluationEnforced: true,
  committeeTreatmentMinScore: null, appetiteThresholds: [{ subCategory: "Fraude", subCategoryId: null, entity: null, threshold: 9, description: null }],
  changeApprover: "RISK_MANAGER", selfProposalAllowed: false, lowCriticalityThreshold: 5, riskOwnerExecutorCumulAllowed: true,
  delegateExecutorCumulAllowed: true, delegationMaxDays: null, hybridPolicyEnabled: false, masteryAuthoritativeSource: "RISK_TEAM",
  committeeVoteRule: "DEFAULT", committeeVoteCustom: null, createdBy: "u9", lastEditedBy: "u9", createdAt: new Date(), updatedAt: new Date(),
  activatedAt: new Date(), activationRequestId: "rq", archivedAt: null, archivedBy: null, archiveReason: null, ...over,
});
const frameworksFake = (versions: RiskFrameworkVersion[] = [version()]) => ({
  async getDefaultFramework() { return { id: "fw1", name: "D" } as never; },
  async getProcessFrameworkId() { return null; },
  async getActiveVersion(_t: string, fid: string) { return versions.find((v) => v.frameworkId === fid && v.status === "ACTIVE") ?? null; },
  async getVersionById(_t: string, id: string) { return versions.find((v) => v.id === id) ?? null; },
  async listFrameworks() { return []; },
  async listVersions() { return versions; },
  async getVersion(_t: string, _f: string, id: string) { return versions.find((v) => v.id === id) ?? null; },
  async getFramework() { return { id: "fw1", name: "D" } as never; },
});
const scalesFake = { async getById() { return { id: "s5", probabilityLevels: 5, impactLevels: 5 } as never; }, async list() { return [] as never; } };

describe("B-6b-01: RatingScaleService.activateVersion closed once the Dispositif is wired", () => {
  const wired = { async listFrameworks() { return []; } };
  it("refuses with the Dispositif message; the dedicated permission is still checked first; unwired is unchanged", async () => {
    const s = new RatingScaleService({} as never, {} as never, {} as never, undefined, undefined, wired);
    await expect(s.activateVersion(actor(["ratingscale.update"]), "id", "rq")).rejects.toThrow(ForbiddenError);
    await expect(s.activateVersion(actor(["ratingscale.delete"]), "id", "rq")).rejects.toThrow(/porté par le Dispositif.*nouvelle version/);
    const open = new RatingScaleService({ async getById() { return null; } } as never, {} as never, {} as never);
    await expect(open.activateVersion(actor(["ratingscale.delete", "ratingscale.read"]), "id", "rq")).rejects.not.toThrow(/Dispositif/);
  });
});

describe("QA-B6b-01: a version without a copied committee threshold fails closed", () => {
  it("validate never reads configs for an evaluation attached to a version", async () => {
    const getByTenant = vi.fn(async () => ({ committeeEvaluationMinScore: 99, committeeEvaluationEnforced: false }));
    const e = { id: "e1", riskId: "r1", status: "BROUILLON", evaluatorId: "u2", residualScore: 13, riskFrameworkVersionId: "ver1", committeeEvaluationMinScore: null, committeeEvaluationEnforced: null } as unknown as RiskEvaluation;
    const evaluations = { async getById() { return e; }, async recordValidation() { return e; } };
    const s = new RiskEvaluationService(evaluations as never, { async record() {} } as never, undefined, undefined, undefined, undefined, { getByTenant } as never, frameworksFake() as never);
    await expect(s.validate(actor(["riskevaluation.validate", "riskevaluation.read"]), "e1", null, "rq")).rejects.toThrow(ValidationError);
    expect(getByTenant).not.toHaveBeenCalled();
  });
});

describe("F-B6b-03 / B-6b-05: GET /applicable and the reduced-independence mark", () => {
  const service = (v: RiskFrameworkVersion) => new RiskFrameworkService(frameworksFake([v]) as never, scalesFake as never, {} as never, {} as never, {} as never, undefined, undefined, { async getById() { return { id: "r1", processId: null }; } } as never);
  it("riskId needs risk.read in addition to riskframework.read", async () => {
    const s = service(version());
    await expect(s.getApplicable(actor(["riskframework.read"]), { riskId: "r1" })).rejects.toThrow(ForbiddenError);
    await expect(s.getApplicable(actor(["riskframework.read", "risk.read"]), { riskId: "r1" })).resolves.toBeTruthy();
  });
  it("FIRST_LINE marks the version as reduced independence on read, RISK_TEAM does not", async () => {
    const reader = actor(["riskframework.read", "risk.read"]);
    expect((await service(version({ masteryAuthoritativeSource: "FIRST_LINE" })).getApplicable(reader, {}))?.version.reducedMasteryIndependence).toBe(true);
    expect((await service(version()).getApplicable(reader, {}))?.version.reducedMasteryIndependence).toBe(false);
    expect((await service(version({ masteryAuthoritativeSource: "FIRST_LINE" })).getVersion(reader, "fw1", "ver1")).reducedMasteryIndependence).toBe(true);
  });
});

describe("F-B6b-01: appetite-vs-residual reads the Dispositif, not risk_appetites", () => {
  it("threshold comes from the applicable version; the legacy table is never read", async () => {
    const list = vi.fn(async () => [{ subCategory: "Fraude", entity: null, threshold: 1 }]);
    const s = new DashboardService(
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { list } as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, undefined, undefined, scalesFake as never, frameworksFake() as never,
    );
    vi.spyOn(s as never, "getScoredRisks").mockResolvedValue([
      { risk: { id: "r1", processId: null }, evaluation: { subCategory: "Fraude", entity: null }, score: 15 },
      { risk: { id: "r2", processId: null }, evaluation: { subCategory: "Fraude", entity: null }, score: 4 },
    ] as never);
    const rows = await s.getAppetiteVsResidual(actor(["dashboard.executive"]));
    expect(rows).toEqual([expect.objectContaining({ subCategory: "Fraude", threshold: 9, maxResidualScore: 15, exceedanceCount: 1, exceeded: true, frameworkVersionId: "ver1" })]);
    expect(list).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// B-6b-04: wiring of server.ts. B-6b-02: B-6c precondition, the inventory of legacy readers.
// ---------------------------------------------------------------------------------------------

const SRC = join(__dirname, "..", "src");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("B-6b-04: server.ts passes the Dispositif repository", () => {
  const server = readFileSync(join(SRC, "server.ts"), "utf8");
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
  // TreatmentDecisionService has no Dispositif dependency by design: it reads the threshold frozen on the evaluation.
  it.each(["RiskEvaluationService", "ConfigService", "RiskAppetiteService", "RatingScaleService", "DashboardService", "CartographyService", "RiskDeviceViewService"])(
    "%s receives riskFrameworkRepository",
    (cls) => {
      expect(callArgs(cls)).toContain("riskFrameworkRepository");
    },
  );
});

describe("B-6c precondition: inventory of the readers of the legacy settings is closed", () => {
  // Each legacy reader below is one of: (w) behind `!this.frameworks`, i.e. only reached when the Dispositif is not
  // wired; (c) on a row created before the Dispositif (no version), read-only history (spec §8.1); (u) unreachable once
  // wired because the writer in front of it is closed (spec §3); (p) platform setting that stays in `configs`.
  // A NEW reader makes this test fail: migrate it to the Dispositif, or add it here with its category and a reason.
  const INVENTORY: Record<string, Record<string, number>> = {
    // the "ACTIVE scale" ceiling helper
    "resolveMaxScore(": { "services/scoreCeiling.ts": 1, "services/ConfigService.ts": 3 /* (u)(u)(c) */, "services/RiskAppetiteService.ts": 1 /* (u) */, "services/RiskEvaluationService.ts": 1 /* (c) */ },
    // "the ACTIVE scale" through the list of scales
    "ratingScales.list(": { "services/scoreCeiling.ts": 1, "services/RiskEvaluationService.ts": 1 /* (w) */, "services/CartographyService.ts": 1 /* (w) */, "services/RatingScaleService.ts": 1 /* public GET /rating-scales */ },
    // configs thresholds / modes
    "configs.getByTenant(": { "services/ConfigService.ts": 2 /* (c) obsolete GET /config */, "services/RiskEvaluationService.ts": 2 /* (c) */, "services/TreatmentDecisionService.ts": 1 /* (c) */, "services/RatingScaleService.ts": 1 /* (u) */, "services/RoleService.ts": 1 /* (p) cumul setting */, "services/SelfValidationGate.ts": 1 /* (p) self-validation policy, D4 */, "services/GovernancePrincipleAcceptanceService.ts": 1 /* (p) q169 acceptance max duration */ },
    // risk_appetites
    "appetites.read": { "services/RiskEvaluationService.ts": 1 /* (c) */, "services/RatingScaleService.ts": 1 /* (u) */, "services/DashboardService.ts": 1 /* (w) */, "services/RiskAppetiteService.ts": 3 /* obsolete GET /appetite + closed writers */, "services/RiskDeviceViewService.ts": 1 /* (w) */ },
  };
  const PATTERNS: Record<string, RegExp> = {
    "resolveMaxScore(": /resolveMaxScore\(/g,
    "ratingScales.list(": /ratingScales\??\.list\(/g,
    "configs.getByTenant(": /configs\??\.getByTenant\(/g,
    "appetites.read": /(?:riskAppetites|appetites)\??\.(?:list|getBySubCategory|getApplicable)\(/g,
  };

  it("matches the documented list exactly (no new reader, none silently removed)", () => {
    const files = walk(SRC).filter((f) => !/\/infrastructure\/|\/domain\/repositories\//.test(f));
    for (const [name, re] of Object.entries(PATTERNS)) {
      const found: Record<string, number> = {};
      for (const f of files) {
        const n = (readFileSync(f, "utf8").match(re) ?? []).length;
        if (n > 0) found[relative(SRC, f)] = n;
      }
      expect(found, `readers of ${name}`).toEqual(INVENTORY[name]);
    }
  });
});
