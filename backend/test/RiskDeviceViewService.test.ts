import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskDeviceViewService } from "../src/services/RiskDeviceViewService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { RaciEnrichmentViewService } from "../src/services/RaciEnrichmentViewService.js";
import { RiskService } from "../src/services/RiskService.js";
import { ControlService } from "../src/services/ControlService.js";
import { RaciAssignmentService } from "../src/services/RaciAssignmentService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ControlEffectivenessRepository } from "../src/domain/repositories/ControlEffectivenessRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RaciAssignmentRepository } from "../src/domain/repositories/RaciAssignmentRepository.js";
import type { RiskAppetiteRepository } from "../src/domain/repositories/RiskAppetiteRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { ControlEffectivenessAssessment } from "../src/domain/entities/ControlEffectivenessAssessment.js";
import type { ActionLink, ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { RaciAssignment } from "../src/domain/entities/RaciAssignment.js";
import type { RiskAppetite } from "../src/domain/entities/RiskAppetite.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";

const TENANT = "tenant-1";

const actor: AuthenticatedUser = {
  userId: "user-reader",
  tenantId: TENANT,
  email: "reader@example.com",
  displayName: "Reader",
  roles: ["risk.read", "riskevaluation.read", "control.read", "actionplan.read", "riskappetite.read", "raci.read"],
};

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

function risk(id = "risk-1", tenantId = TENANT): Risk {
  return {
    id,
    tenantId,
    process: "Paiements",
    processId: null,
    description: "Risque test",
    ownerDepartmentId: null,
    ownerId: null,
    superiorOwnerId: null,
    status: "ACTIVE",
  } as Risk;
}

function control(id: string, tenantId = TENANT): Control {
  return { id, tenantId, label: `Contrôle ${id}`, status: "ACTIVE", coveredRiskIds: [] } as Control;
}

function assessment(
  id: string,
  controlId: string,
  createdAt: Date,
  overrides: Partial<ControlEffectivenessAssessment> = {},
): ControlEffectivenessAssessment {
  return {
    id,
    tenantId: TENANT,
    controlId,
    createdAt,
    evalDate: createdAt,
    evaluatedBy: "user-assessor",
    operationalEffectiveness: "EFFECTIVE",
    justification: "Échantillon testé",
    status: "COMPLETED",
    validatedBy: null,
    validatedAt: null,
    ...overrides,
  } as ControlEffectivenessAssessment;
}

function evaluation(overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    riskId: "risk-1",
    evaluationType: "ANNUELLE",
    status: "BROUILLON",
    evaluatorId: "user-evaluator",
    subCategory: "Fraude interne",
    entity: null,
    evaluationMode: "CLASSIQUE",
    ratingScaleId: null,
    ratingScaleVersion: null,
    inherentProbability: null,
    inherentImpacts: null,
    inherentImpactRetained: null,
    inherentScore: null,
    masteryLines: null,
    masteryGlobal: null,
    residualProbability: null,
    residualImpacts: null,
    residualImpactRetained: null,
    residualScore: null,
    residualJustification: null,
    appetiteThresholdSuggested: null,
    appetiteThresholdOverride: null,
    appetiteThresholdApplied: null,
    appetiteExceeded: null,
    validatedBy: null,
    validatedAt: null,
    comment: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  } as RiskEvaluation;
}

/** Scoped helper mirroring RiskEvaluationViewService.test.ts. */
function scoped<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => r.tenantId === tenantId);
}

function fakeRiskRepository(risks: Risk[]): RiskRepository {
  return {
    async getById(tenantId, id) {
      return scoped(risks, tenantId).find((r) => r.id === id) ?? null;
    },
    async listByIds() {
      return [];
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
    async assignOwner() {
      throw new Error("not used in this test");
    },
    async assignSuperiorOwner() {
      throw new Error("not used in this test");
    },
  } as unknown as RiskRepository;
}

function fakeRiskEvaluationRepository(evaluations: RiskEvaluation[]): RiskEvaluationRepository {
  return {
    async getById(tenantId, id) {
      return scoped(evaluations, tenantId).find((e) => e.id === id) ?? null;
    },
    async listForRisk(tenantId, riskId) {
      return scoped(evaluations, tenantId)
        .filter((e) => e.riskId === riskId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
  } as unknown as RiskEvaluationRepository;
}

function fakeControlRepository(controlsByRisk: Record<string, Control[]>): ControlRepository {
  return {
    async getById(tenantId, id) {
      for (const list of Object.values(controlsByRisk)) {
        const found = scoped(list, tenantId).find((c) => c.id === id);
        if (found) return found;
      }
      return null;
    },
    async list() {
      return [];
    },
    async listCoveringRisk(tenantId, riskId) {
      return scoped(controlsByRisk[riskId] ?? [], tenantId);
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  } as unknown as ControlRepository;
}

function fakeEffectivenessRepository(assessmentsByControl: Record<string, ControlEffectivenessAssessment[]>): ControlEffectivenessRepository {
  return {
    async listForControl(tenantId, controlId) {
      return scoped(assessmentsByControl[controlId] ?? [], tenantId);
    },
  } as unknown as ControlEffectivenessRepository;
}

function inMemoryActionPlanRepository(actions: ActionPlan[], links: Map<string, ActionLink[]> = new Map()): ActionPlanRepository {
  return {
    async getById(tenantId, id) {
      return actions.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async updateProgress() {
      throw new Error("not used in this test");
    },
    async start() {
      throw new Error("not used in this test");
    },
    async close() {
      throw new Error("not used in this test");
    },
    async listLinks(_tenantId, actionId) {
      return links.get(actionId) ?? [];
    },
    async replaceLinks() {
      throw new Error("not used in this test");
    },
    async listForRisk(tenantId, riskId) {
      const direct = actions.filter((a) => a.tenantId === tenantId && a.sourceType === "RISK" && a.sourceId === riskId);
      const linkedIds = [...links.entries()]
        .filter(([, actionLinks]) => actionLinks.some((l) => l.resourceType === "RISK" && l.resourceId === riskId))
        .map(([actionId]) => actionId);
      const linked = actions.filter((a) => a.tenantId === tenantId && linkedIds.includes(a.id));
      const byId = new Map([...direct, ...linked].map((a) => [a.id, a]));
      return [...byId.values()];
    },
  } as unknown as ActionPlanRepository;
}

function actionPlan(id: string, overrides: Partial<ActionPlan> = {}): ActionPlan {
  return {
    id,
    tenantId: TENANT,
    title: `Action ${id}`,
    description: null,
    sourceType: "RISK",
    sourceId: "risk-1",
    responsibleUserId: "user-responsible",
    departmentId: null,
    dueDate: new Date("2027-01-01"),
    status: "PLANIFIEE",
    progressPercent: 0,
    progressComment: null,
    evidenceId: null,
    createdBy: "user-creator",
    closedBy: null,
    closedAt: null,
    closureComment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ActionPlan;
}

function inMemoryRaciRepository(assignments: RaciAssignment[] = []): RaciAssignmentRepository {
  return {
    async create() {
      throw new Error("not used in this test");
    },
    async getById() {
      throw new Error("not used in this test");
    },
    async listForEntity(tenantId, entityType, entityId) {
      return assignments.filter(
        (a) => a.tenantId === tenantId && a.entityType === entityType && a.entityId === entityId && !a.deletedAt,
      );
    },
    async listForUser() {
      return [];
    },
    async remove() {
      throw new Error("not used in this test");
    },
  };
}

function raciAssignment(entityId: string, userId: string, role: RaciAssignment["role"]): RaciAssignment {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    entityType: "RISK",
    entityId,
    userId,
    role,
    createdBy: "user-admin",
    createdAt: new Date(),
    deletedAt: null,
  };
}

function inMemoryRiskAppetiteRepository(appetites: RiskAppetite[] = []): RiskAppetiteRepository {
  return {
    async getById() {
      throw new Error("not used in this test");
    },
    async getBySubCategory(tenantId, subCategory, entity, options) {
      return (
        appetites.find(
          (a) =>
            a.tenantId === tenantId &&
            a.subCategory === subCategory &&
            a.entity === entity &&
            !a.deletedAt &&
            (!options?.activeOnly || a.active),
        ) ?? null
      );
    },
    async list() {
      return [];
    },
    async upsert() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

function appetite(subCategory: string, threshold: number, entity: string | null = null): RiskAppetite {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    subCategory,
    subCategoryId: null,
    entity,
    threshold,
    methodologyVersion: "v1",
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  };
}

interface Fixture {
  risks?: Risk[];
  evaluations?: RiskEvaluation[];
  controlsByRisk?: Record<string, Control[]>;
  assessmentsByControl?: Record<string, ControlEffectivenessAssessment[]>;
  actions?: ActionPlan[];
  links?: Map<string, ActionLink[]>;
  raci?: RaciAssignment[];
  appetites?: RiskAppetite[];
}

function buildService(fixture: Fixture): RiskDeviceViewService {
  const risks = fixture.risks ?? [risk()];
  const riskRepository = fakeRiskRepository(risks);
  const riskEvaluationRepository = fakeRiskEvaluationRepository(fixture.evaluations ?? []);
  const controlRepository = fakeControlRepository(fixture.controlsByRisk ?? {});
  const effectivenessRepository = fakeEffectivenessRepository(fixture.assessmentsByControl ?? {});
  const actionPlanRepository = inMemoryActionPlanRepository(fixture.actions ?? [], fixture.links);
  const raciRepository = inMemoryRaciRepository(fixture.raci ?? []);
  const appetiteRepository = inMemoryRiskAppetiteRepository(fixture.appetites ?? []);
  const audit = inMemoryAuditRepository();

  const actionPlanService = new ActionPlanService(actionPlanRepository, audit, riskRepository, controlRepository);
  const riskService = new RiskService(riskRepository, audit);
  const controlService = new ControlService(controlRepository, riskRepository, audit);
  const raciAssignmentService = new RaciAssignmentService(raciRepository, audit, riskRepository, controlRepository, actionPlanRepository);
  const raciEnrichmentViewService = new RaciEnrichmentViewService(riskService, controlService, actionPlanService, raciAssignmentService);
  const riskAppetiteService = new RiskAppetiteService(appetiteRepository, audit);

  return new RiskDeviceViewService(
    riskRepository,
    riskEvaluationRepository,
    controlRepository,
    effectivenessRepository,
    actionPlanService,
    raciEnrichmentViewService,
    riskAppetiteService,
  );
}

describe("RiskDeviceViewService", () => {
  it("composes risk + latest authoritative evaluation + controls + action plans + raci + appetite", async () => {
    const service = buildService({
      risks: [risk()],
      evaluations: [
        evaluation({ status: "VALIDATED", createdAt: new Date("2026-05-01"), residualScore: 9, appetiteThresholdApplied: 5, appetiteExceeded: true }),
      ],
      controlsByRisk: { "risk-1": [control("control-1")] },
      assessmentsByControl: { "control-1": [assessment("a-1", "control-1", new Date("2026-04-01"))] },
      actions: [actionPlan("action-1")],
      raci: [raciAssignment("risk-1", "user-a", "R")],
      appetites: [appetite("Fraude interne", 5)],
    });

    const device = await service.getDevice(actor, "risk-1");

    expect(device.risk.id).toBe("risk-1");
    expect(device.latestAuthoritativeEvaluation?.status).toBe("VALIDATED");
    expect(device.residualScore).toBe(9);
    expect(device.evaluationStatus).toBe("VALIDATED");
    expect(device.coveringControls).toHaveLength(1);
    expect(device.coveringControls[0]?.lastEffectiveness?.id).toBe("a-1");
    expect(device.actionPlans.map((a) => a.id)).toEqual(["action-1"]);
    expect(device.raci).toHaveLength(1);
    expect(device.appetite.appliedThreshold).toBe(5);
    expect(device.appetite.exceeded).toBe(true);
    expect(device.appetite.currentThreshold?.threshold).toBe(5);
  });

  describe("RISK_BLOCK — residualScore never appears without evaluationStatus", () => {
    it("never surfaces a BROUILLON evaluation as authoritative — residualScore/evaluationStatus stay null", async () => {
      const service = buildService({
        evaluations: [evaluation({ status: "BROUILLON", residualScore: 15, createdAt: new Date("2026-06-01") })],
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.latestAuthoritativeEvaluation).toBeNull();
      expect(device.residualScore).toBeNull();
      expect(device.evaluationStatus).toBeNull();
      // The draft is still visible in the full history, just never mistaken for authoritative.
      expect(device.evaluationHistory).toHaveLength(1);
      expect(device.evaluationHistory[0]?.status).toBe("BROUILLON");
    });

    it("never surfaces a REJECTED evaluation as authoritative", async () => {
      const service = buildService({
        evaluations: [evaluation({ status: "REJECTED", residualScore: 20, createdAt: new Date("2026-06-01") })],
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.latestAuthoritativeEvaluation).toBeNull();
      expect(device.residualScore).toBeNull();
      expect(device.evaluationStatus).toBeNull();
    });

    it("picks the most recent of VALIDATED/VALIDE_COMITE regardless of which one, never a hardcoded single-status filter", async () => {
      const service = buildService({
        evaluations: [
          evaluation({ status: "VALIDATED", residualScore: 6, createdAt: new Date("2026-01-01") }),
          evaluation({ status: "VALIDE_COMITE", residualScore: 18, createdAt: new Date("2026-07-01") }),
          evaluation({ status: "BROUILLON", residualScore: 99, createdAt: new Date("2026-08-01") }), // most recent overall, but not authoritative
        ],
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.evaluationStatus).toBe("VALIDE_COMITE");
      expect(device.residualScore).toBe(18);
    });

    it("a risk with no evaluation at all exposes null score and null status, not an error", async () => {
      const service = buildService({ evaluations: [] });
      const device = await service.getDevice(actor, "risk-1");
      expect(device.latestAuthoritativeEvaluation).toBeNull();
      expect(device.residualScore).toBeNull();
      expect(device.evaluationStatus).toBeNull();
      expect(device.appetite.currentThreshold).toBeNull();
    });
  });

  describe("appetite drift visibility", () => {
    it("shows the currently active threshold even when it differs from what was applied at evaluation time", async () => {
      const service = buildService({
        evaluations: [
          evaluation({ status: "VALIDATED", residualScore: 8, appetiteThresholdApplied: 5, createdAt: new Date("2026-01-01") }),
        ],
        appetites: [appetite("Fraude interne", 12)], // redefined since the evaluation was scored
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.appetite.appliedThreshold).toBe(5); // what the evaluation actually used
      expect(device.appetite.currentThreshold?.threshold).toBe(12); // what's active now
    });

    it("P-04: never surfaces a deactivated threshold as the current one", async () => {
      const service = buildService({
        evaluations: [
          evaluation({ status: "VALIDATED", residualScore: 8, appetiteThresholdApplied: 5, createdAt: new Date("2026-01-01") }),
        ],
        appetites: [{ ...appetite("Fraude interne", 12), active: false }],
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.appetite.appliedThreshold).toBe(5); // unaffected — captured on the evaluation itself
      expect(device.appetite.currentThreshold).toBeNull(); // the only threshold on file is inactive, not applicable
    });
  });

  describe("tenant scoping", () => {
    it("a risk from another tenant is not found", async () => {
      const service = buildService({ risks: [risk("risk-1", TENANT)] });
      const foreign: AuthenticatedUser = { ...actor, tenantId: "tenant-2" };
      await expect(service.getDevice(foreign, "risk-1")).rejects.toThrow(NotFoundError);
    });

    it("does not leak controls, action plans, or RACI belonging to another tenant", async () => {
      const foreignControl = { ...control("control-foreign"), tenantId: "tenant-2" };
      const service = buildService({
        risks: [risk()],
        controlsByRisk: { "risk-1": [control("control-1"), foreignControl] },
        actions: [actionPlan("action-1"), { ...actionPlan("action-foreign"), tenantId: "tenant-2" }],
        raci: [raciAssignment("risk-1", "user-a", "R"), { ...raciAssignment("risk-1", "user-b", "A"), tenantId: "tenant-2" }],
      });

      const device = await service.getDevice(actor, "risk-1");

      expect(device.coveringControls.map((c) => c.control.id)).toEqual(["control-1"]);
      expect(device.actionPlans.map((a) => a.id)).toEqual(["action-1"]);
      expect(device.raci).toHaveLength(1);
    });
  });

  describe("permissions — checked up front, before any assembly", () => {
    it("requires risk.read", async () => {
      const service = buildService({ risks: [risk()] });
      const noRiskRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "risk.read") };
      await expect(service.getDevice(noRiskRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("requires riskevaluation.read", async () => {
      const service = buildService({ risks: [risk()] });
      const noEvalRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "riskevaluation.read") };
      await expect(service.getDevice(noEvalRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("requires control.read", async () => {
      const service = buildService({ risks: [risk()] });
      const noControlRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "control.read") };
      await expect(service.getDevice(noControlRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("requires actionplan.read", async () => {
      const service = buildService({ risks: [risk()] });
      const noActionRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "actionplan.read") };
      await expect(service.getDevice(noActionRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("requires riskappetite.read", async () => {
      const service = buildService({ risks: [risk()] });
      const noAppetiteRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "riskappetite.read") };
      await expect(service.getDevice(noAppetiteRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("requires raci.read (enforced by RaciEnrichmentViewService, composed not duplicated)", async () => {
      const service = buildService({
        risks: [risk()],
        raci: [raciAssignment("risk-1", "user-a", "R")],
      });
      const noRaciRead: AuthenticatedUser = { ...actor, roles: actor.roles.filter((r) => r !== "raci.read") };
      await expect(service.getDevice(noRaciRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });
  });
});
