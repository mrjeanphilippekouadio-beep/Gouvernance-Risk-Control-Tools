import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DashboardService } from "../src/services/DashboardService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { AnomalyRepository } from "../src/domain/repositories/AnomalyRepository.js";
import type { KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { KriMeasureRepository } from "../src/domain/repositories/KriMeasureRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { RiskAppetiteRepository } from "../src/domain/repositories/RiskAppetiteRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ControlExecutionRepository } from "../src/domain/repositories/ControlExecutionRepository.js";
import type { ControlEffectivenessRepository } from "../src/domain/repositories/ControlEffectivenessRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { KpiRepository } from "../src/domain/repositories/KpiRepository.js";
import type { KpiMeasureRepository } from "../src/domain/repositories/KpiMeasureRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { RiskAppetite } from "../src/domain/entities/RiskAppetite.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// Minimal in-memory test doubles — only the methods DashboardService
// actually calls are implemented; everything else throws, same
// convention as CartographyService.test.ts.
// ---------------------------------------------------------------------

const NOT_IMPLEMENTED = () => {
  throw new Error("not implemented");
};

function fakeRisks(risks: Risk[]): RiskRepository {
  return {
    getById: NOT_IMPLEMENTED,
    listByIds: NOT_IMPLEMENTED,
    async list(tenantId, options) {
      return risks.filter(
        (r) =>
          r.tenantId === tenantId &&
          (options?.includeArchived || r.status !== "ARCHIVED") &&
          (options?.ownerId === undefined || r.ownerId === options.ownerId),
      );
    },
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    assignOwner: NOT_IMPLEMENTED,
    assignSuperiorOwner: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function fakeEvaluations(evaluations: RiskEvaluation[]): RiskEvaluationRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async listForRisk(tenantId, riskId, options) {
      const statuses = options?.status ? (Array.isArray(options.status) ? options.status : [options.status]) : null;
      return evaluations
        .filter((e) => e.tenantId === tenantId && e.riskId === riskId && (!statuses || statuses.includes(e.status)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, options?.limit ?? 50);
    },
    create: NOT_IMPLEMENTED,
    recordInherentScoring: NOT_IMPLEMENTED,
    recordMasteryAssessment: NOT_IMPLEMENTED,
    recordResidualScoring: NOT_IMPLEMENTED,
    recordValidation: NOT_IMPLEMENTED,
    recordRejection: NOT_IMPLEMENTED,
  };
}

function fakeAnomalies(): AnomalyRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async list() {
      return [];
    },
    create: NOT_IMPLEMENTED,
    updateStatus: NOT_IMPLEMENTED,
  };
}

function fakeKris(kris: Kri[]): KriRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async list(tenantId) {
      return kris.filter((k) => k.tenantId === tenantId);
    },
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
    listCoveredRiskIds: NOT_IMPLEMENTED,
    replaceCoveredRisks: NOT_IMPLEMENTED,
  };
}

function fakeKriMeasures(): KriMeasureRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async listForKri() {
      return { items: [], total: 0, page: 1, pageSize: 0 };
    },
    async getLatest() {
      return null;
    },
    create: NOT_IMPLEMENTED,
  };
}

function fakeActionPlans(actions: ActionPlan[]): ActionPlanRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async list(tenantId, filters) {
      return actions.filter(
        (a) =>
          a.tenantId === tenantId &&
          (filters?.responsibleUserId === undefined || a.responsibleUserId === filters.responsibleUserId) &&
          (filters?.departmentId === undefined || a.departmentId === filters.departmentId) &&
          (filters?.sourceType === undefined || a.sourceType === filters.sourceType),
      );
    },
    create: NOT_IMPLEMENTED,
    updateProgress: NOT_IMPLEMENTED,
    start: NOT_IMPLEMENTED,
    close: NOT_IMPLEMENTED,
    listLinks: NOT_IMPLEMENTED,
    replaceLinks: NOT_IMPLEMENTED,
  };
}

function fakeRiskAppetites(appetites: RiskAppetite[]): RiskAppetiteRepository {
  return {
    getById: NOT_IMPLEMENTED,
    getBySubCategory: NOT_IMPLEMENTED,
    async list(tenantId) {
      return appetites.filter((a) => a.tenantId === tenantId);
    },
    upsert: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function fakeControls(): ControlRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async list() {
      return [];
    },
    listCoveringRisk: NOT_IMPLEMENTED,
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function fakeControlExecutions(): ControlExecutionRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async listForControl() {
      return [];
    },
    create: NOT_IMPLEMENTED,
    recordValidation: NOT_IMPLEMENTED,
  };
}

function fakeControlEffectiveness(): ControlEffectivenessRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async listForControl() {
      return [];
    },
    create: NOT_IMPLEMENTED,
    recordValidation: NOT_IMPLEMENTED,
  };
}

function fakeDepartments(departments: Department[]): DepartmentRepository {
  return {
    async getById(tenantId, id) {
      return departments.find((d) => d.tenantId === tenantId && d.id === id) ?? null;
    },
    async list(tenantId) {
      return departments.filter((d) => d.tenantId === tenantId);
    },
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    designateRiskOwner: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function fakeKpis(): KpiRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async list() {
      return [];
    },
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function fakeKpiMeasures(): KpiMeasureRepository {
  return {
    getById: NOT_IMPLEMENTED,
    listForKpi: NOT_IMPLEMENTED,
    async getLatest() {
      return null;
    },
    create: NOT_IMPLEMENTED,
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TENANT = "tenant-1";

function actorWith(roles: string[], overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { userId: "user-1", tenantId: TENANT, email: "user@djamo.example", displayName: "User", roles, ...overrides };
}

function buildRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    process: "Payments",
    description: "Fraud on instant transfers",
    ownerDepartmentId: null,
    ownerId: null,
    superiorOwnerId: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function buildEvaluation(riskId: string, overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  const createdAt = overrides.createdAt ?? new Date();
  return {
    id: randomUUID(),
    tenantId: TENANT,
    riskId,
    evaluationType: "AD_HOC",
    status: "VALIDATED",
    evaluatorId: "evaluator-1",
    subCategory: "Fraude",
    entity: "CI",
    ratingScaleId: null,
    ratingScaleVersion: null,
    inherentProbability: 3,
    inherentImpacts: [],
    inherentImpactRetained: 4,
    inherentScore: 12,
    masteryLines: null,
    masteryGlobal: 2,
    residualProbability: 2,
    residualImpacts: [],
    residualImpactRetained: 3,
    residualScore: 6,
    residualJustification: "Post-maîtrise",
    appetiteThresholdSuggested: null,
    appetiteThresholdOverride: null,
    appetiteThresholdApplied: null,
    appetiteExceeded: null,
    validatedBy: "validator-1",
    validatedAt: new Date(),
    comment: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function buildDepartment(overrides: Partial<Department> = {}): Department {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    name: "Operations",
    entity: null,
    manager: "manager@djamo.example",
    riskOwner: "pilot@djamo.example",
    riskOwnerDesignatedBy: null,
    riskOwnerDesignatedAt: null,
    linkedProcesses: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function buildAppetite(overrides: Partial<RiskAppetite> = {}): RiskAppetite {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    subCategory: "Fraude",
    entity: "CI",
    threshold: 10,
    methodologyVersion: "2026.1",
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function newService(fixtures: {
  risks?: Risk[];
  evaluations?: RiskEvaluation[];
  kris?: Kri[];
  actionPlans?: ActionPlan[];
  appetites?: RiskAppetite[];
  departments?: Department[];
}): DashboardService {
  return new DashboardService(
    fakeRisks(fixtures.risks ?? []),
    fakeEvaluations(fixtures.evaluations ?? []),
    fakeAnomalies(),
    fakeKris(fixtures.kris ?? []),
    fakeKriMeasures(),
    fakeActionPlans(fixtures.actionPlans ?? []),
    fakeRiskAppetites(fixtures.appetites ?? []),
    fakeControls(),
    fakeControlExecutions(),
    fakeControlEffectiveness(),
    fakeDepartments(fixtures.departments ?? []),
    fakeKpis(),
    fakeKpiMeasures(),
  );
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("DashboardService", () => {
  describe("tenant scoping", () => {
    it("getRisksOverview never returns another tenant's risks", async () => {
      const ownRisk = buildRisk();
      const otherTenantRisk = buildRisk({ tenantId: "tenant-2" });
      const service = newService({ risks: [ownRisk, otherTenantRisk] });

      const rows = await service.getRisksOverview(actorWith(["dashboard.read"]));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.riskId).toBe(ownRisk.id);
    });

    it("rejects a caller without dashboard.read", async () => {
      const service = newService({ risks: [buildRisk()] });
      await expect(service.getRisksOverview(actorWith([]))).rejects.toThrow();
    });
  });

  describe("department scoping", () => {
    it("grants access to the department's designated risk pilot without dashboard.executive", async () => {
      const department = buildDepartment({ riskOwner: "pilot@djamo.example" });
      const ownRisk = buildRisk({ ownerDepartmentId: department.id });
      const otherDeptRisk = buildRisk({ ownerDepartmentId: "other-dept" });
      const service = newService({ risks: [ownRisk, otherDeptRisk], departments: [department] });

      const view = await service.getDepartmentView(
        actorWith(["dashboard.read"], { email: "PILOT@djamo.example" }), // case-insensitive match
        department.id,
      );

      expect(view.risks).toHaveLength(1);
      expect(view.risks[0]?.riskId).toBe(ownRisk.id);
    });

    it("rejects a non-pilot caller who lacks dashboard.executive", async () => {
      const department = buildDepartment({ riskOwner: "pilot@djamo.example" });
      const service = newService({ departments: [department] });

      await expect(
        service.getDepartmentView(actorWith(["dashboard.read"], { email: "someone-else@djamo.example" }), department.id),
      ).rejects.toThrow(ForbiddenError);
    });

    it("grants a non-pilot access when they hold dashboard.executive", async () => {
      const department = buildDepartment({ riskOwner: "pilot@djamo.example" });
      const service = newService({ departments: [department] });

      await expect(
        service.getDepartmentView(
          actorWith(["dashboard.read", "dashboard.executive"], { email: "admin@djamo.example" }),
          department.id,
        ),
      ).resolves.toBeDefined();
    });
  });

  describe("risk-owner personal view (ACT-240)", () => {
    it("only includes risks whose ownerId matches the caller", async () => {
      const myRisk = buildRisk({ ownerId: "user-1" });
      const someoneElsesRisk = buildRisk({ ownerId: "user-2" });
      const service = newService({ risks: [myRisk, someoneElsesRisk] });

      const dashboard = await service.getRiskOwnerView(actorWith(["dashboard.read"]));

      expect(dashboard.risks).toHaveLength(1);
      expect(dashboard.risks[0]?.riskId).toBe(myRisk.id);
      expect(dashboard.ownerId).toBe("user-1");
    });

    it("raises an APPETITE_EXCEEDED alert when the owner's most recent validated evaluation exceeded appetite", async () => {
      const myRisk = buildRisk({ ownerId: "user-1" });
      const evaluation = buildEvaluation(myRisk.id, { appetiteExceeded: true, residualScore: 15 });
      const service = newService({ risks: [myRisk], evaluations: [evaluation] });

      const dashboard = await service.getRiskOwnerView(actorWith(["dashboard.read"]));

      expect(dashboard.alerts).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "APPETITE_EXCEEDED", riskId: myRisk.id })]),
      );
    });

    it("2026-09-30 audit fix: shows the score of a risk whose only evaluation is VALIDE_COMITE, not just VALIDATED", async () => {
      const myRisk = buildRisk({ ownerId: "user-1" });
      const committeeValidated = buildEvaluation(myRisk.id, { status: "VALIDE_COMITE", residualScore: 25 });
      const service = newService({ risks: [myRisk], evaluations: [committeeValidated] });

      const dashboard = await service.getRiskOwnerView(actorWith(["dashboard.read"]));

      expect(dashboard.risks[0]?.score).toBe(25);
      expect(dashboard.risks[0]?.evaluationStatus).toBe("VALIDE_COMITE");
    });

    it("still reports score: null and evaluationStatus: null for a risk with only BROUILLON/REJECTED evaluations", async () => {
      const myRisk = buildRisk({ ownerId: "user-1" });
      const draft = buildEvaluation(myRisk.id, {
        status: "BROUILLON",
        residualScore: null,
        residualProbability: null,
        residualImpactRetained: null,
        createdAt: new Date("2026-01-01"),
      });
      const rejected = buildEvaluation(myRisk.id, { status: "REJECTED", residualScore: 99, createdAt: new Date("2026-02-01") });
      const service = newService({ risks: [myRisk], evaluations: [draft, rejected] });

      const dashboard = await service.getRiskOwnerView(actorWith(["dashboard.read"]));

      expect(dashboard.risks[0]?.score).toBeNull();
      expect(dashboard.risks[0]?.evaluationStatus).toBeNull();
    });

    it("prefers the more recent of a VALIDATED and a VALIDE_COMITE evaluation, regardless of which status is newer", async () => {
      const myRisk = buildRisk({ ownerId: "user-1" });
      const olderValidated = buildEvaluation(myRisk.id, {
        status: "VALIDATED",
        residualScore: 5,
        createdAt: new Date("2026-01-01"),
      });
      const newerCommittee = buildEvaluation(myRisk.id, {
        status: "VALIDE_COMITE",
        residualScore: 25,
        createdAt: new Date("2026-03-01"),
      });
      const service = newService({ risks: [myRisk], evaluations: [olderValidated, newerCommittee] });

      const dashboard = await service.getRiskOwnerView(actorWith(["dashboard.read"]));

      expect(dashboard.risks[0]?.score).toBe(25);
      expect(dashboard.risks[0]?.evaluationStatus).toBe("VALIDE_COMITE");
    });
  });

  describe("appetite vs residual (ACT-214)", () => {
    it("flags a sub-category/entity group as exceeded only when the max residual score is above the threshold", async () => {
      const overThreshold = buildRisk();
      const underThreshold = buildRisk();
      const evalOver = buildEvaluation(overThreshold.id, { subCategory: "Fraude", entity: "CI", residualScore: 15 });
      const evalUnder = buildEvaluation(underThreshold.id, { subCategory: "Conformité", entity: "CI", residualScore: 3 });
      const appetiteFraude = buildAppetite({ subCategory: "Fraude", entity: "CI", threshold: 10 });
      const appetiteConformite = buildAppetite({ subCategory: "Conformité", entity: "CI", threshold: 10 });

      const service = newService({
        risks: [overThreshold, underThreshold],
        evaluations: [evalOver, evalUnder],
        appetites: [appetiteFraude, appetiteConformite],
      });

      const rows = await service.getAppetiteVsResidual(actorWith(["dashboard.executive"]));

      const fraudeRow = rows.find((r) => r.subCategory === "Fraude");
      const conformiteRow = rows.find((r) => r.subCategory === "Conformité");

      expect(fraudeRow).toMatchObject({ threshold: 10, maxResidualScore: 15, exceeded: true, exceedanceCount: 1 });
      expect(conformiteRow).toMatchObject({ threshold: 10, maxResidualScore: 3, exceeded: false, exceedanceCount: 0 });
    });

    it("still reports a threshold-only group (no current evaluation) with a null score and exceeded=false", async () => {
      const appetite = buildAppetite({ subCategory: "Blanchiment", entity: null, threshold: 8 });
      const service = newService({ appetites: [appetite] });

      const rows = await service.getAppetiteVsResidual(actorWith(["dashboard.executive"]));

      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ subCategory: "Blanchiment", threshold: 8, maxResidualScore: null, exceeded: false }),
        ]),
      );
    });

    it("rejects a caller without dashboard.executive", async () => {
      const service = newService({});
      await expect(service.getAppetiteVsResidual(actorWith(["dashboard.read"]))).rejects.toThrow();
    });
  });
});
