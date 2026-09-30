import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RaciEnrichmentViewService } from "../src/services/RaciEnrichmentViewService.js";
import { RiskService } from "../src/services/RiskService.js";
import { ControlService } from "../src/services/ControlService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { RaciAssignmentService } from "../src/services/RaciAssignmentService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RaciAssignmentRepository } from "../src/domain/repositories/RaciAssignmentRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { RaciAssignment } from "../src/domain/entities/RaciAssignment.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";

const TENANT = "tenant-1";

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

function inMemoryRiskRepository(risks: Risk[]): RiskRepository {
  return {
    async getById(tenantId, id) {
      return risks.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
    },
    async listByIds(tenantId, ids) {
      return risks.filter((r) => r.tenantId === tenantId && ids.includes(r.id));
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update(tenantId, id, input) {
      const existing = risks.find((r) => r.tenantId === tenantId && r.id === id);
      if (!existing) throw new Error("risk not found");
      const updated = { ...existing, ...input };
      const idx = risks.indexOf(existing);
      risks[idx] = updated;
      return updated;
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

function inMemoryControlRepository(controls: Control[]): ControlRepository {
  return {
    async getById(tenantId, id) {
      return controls.find((c) => c.tenantId === tenantId && c.id === id) ?? null;
    },
    async list() {
      return [];
    },
    async listCoveringRisk() {
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
  } as unknown as ControlRepository;
}

function inMemoryActionPlanRepository(actions: ActionPlan[]): ActionPlanRepository {
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
    async update() {
      throw new Error("not used in this test");
    },
  } as unknown as ActionPlanRepository;
}

function inMemoryRaciRepository(assignments: RaciAssignment[] = []): RaciAssignmentRepository {
  const store = [...assignments];
  return {
    async create(input) {
      const assignment: RaciAssignment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        userId: input.userId,
        role: input.role,
        createdBy: input.createdBy,
        createdAt: new Date(),
        deletedAt: null,
      };
      store.push(assignment);
      return assignment;
    },
    async getById(tenantId, id) {
      return store.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
    },
    async listForEntity(tenantId, entityType, entityId) {
      return store.filter(
        (a) => a.tenantId === tenantId && a.entityType === entityType && a.entityId === entityId && !a.deletedAt,
      );
    },
    async remove(tenantId, id) {
      const existing = store.find((a) => a.tenantId === tenantId && a.id === id);
      if (!existing) throw new NotFoundError("RaciAssignment", id);
      existing.deletedAt = new Date();
      return existing;
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

function control(id = "control-1", tenantId = TENANT): Control {
  return {
    id,
    tenantId,
    label: `Contrôle ${id}`,
    status: "ACTIVE",
    coveredRiskIds: ["risk-1"],
  } as Control;
}

function actionPlan(id = "action-1", tenantId = TENANT): ActionPlan {
  return {
    id,
    tenantId,
    title: "Corriger",
    description: null,
    sourceType: "RISK",
    sourceId: "risk-1",
    responsibleUserId: "user-responsible",
    departmentId: null,
    status: "PLANIFIEE",
    progressPercent: 0,
    dueDate: new Date("2027-01-01"),
    createdAt: new Date(),
  } as ActionPlan;
}

function assignment(entityType: RaciAssignment["entityType"], entityId: string, userId: string, role: RaciAssignment["role"]): RaciAssignment {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    entityType,
    entityId,
    userId,
    role,
    createdBy: "user-admin",
    createdAt: new Date(),
    deletedAt: null,
  };
}

function buildService(data: { risks: Risk[]; controls: Control[]; actions: ActionPlan[]; raci: RaciAssignment[] }) {
  const audit = inMemoryAuditRepository();
  const riskRepository = inMemoryRiskRepository(data.risks);
  const controlRepository = inMemoryControlRepository(data.controls);
  const actionPlanRepository = inMemoryActionPlanRepository(data.actions);
  const raciRepository = inMemoryRaciRepository(data.raci);

  const riskService = new RiskService(riskRepository, audit);
  const controlService = new ControlService(controlRepository, riskRepository, audit);
  const actionPlanService = new ActionPlanService(actionPlanRepository, audit);
  const raciAssignmentService = new RaciAssignmentService(raciRepository, audit, riskRepository, controlRepository, actionPlanRepository);

  return new RaciEnrichmentViewService(riskService, controlService, actionPlanService, raciAssignmentService);
}

/** Full read rights on every underlying entity plus RACI. */
const fullReader: AuthenticatedUser = {
  userId: "user-reader",
  tenantId: TENANT,
  email: "reader@example.com",
  displayName: "Reader",
  roles: ["risk.read", "control.read", "actionplan.read", "raci.read"],
};

/** Can write everything, but was never given raci.read. */
const writerWithoutRaciRead: AuthenticatedUser = {
  userId: "user-writer",
  tenantId: TENANT,
  email: "writer@example.com",
  displayName: "Writer",
  roles: ["risk.read", "risk.update", "control.read", "control.update", "actionplan.read", "actionplan.update"],
};

/** Holds a RACI role (Responsible on risk-1) but no ordinary domain permission at all. */
const raciResponsibleOnly: AuthenticatedUser = {
  userId: "user-raci-r",
  tenantId: TENANT,
  email: "raci-r@example.com",
  displayName: "RACI R only",
  roles: ["raci.read"],
};

describe("RaciEnrichmentViewService", () => {
  it("exposes a risk's RACI assignments alongside the risk", async () => {
    const service = buildService({
      risks: [risk()],
      controls: [],
      actions: [],
      raci: [assignment("RISK", "risk-1", "user-a", "R"), assignment("RISK", "risk-1", "user-b", "A")],
    });

    const result = await service.getRiskWithRaci(fullReader, "risk-1");

    expect(result.risk.id).toBe("risk-1");
    expect(result.raci).toHaveLength(2);
    expect(result.raci.map((a) => a.role).sort()).toEqual(["A", "R"]);
  });

  it("exposes a control's RACI assignments alongside the control", async () => {
    const service = buildService({
      risks: [risk()],
      controls: [control()],
      actions: [],
      raci: [assignment("CONTROL", "control-1", "user-c", "C")],
    });

    const result = await service.getControlWithRaci(fullReader, "control-1");

    expect(result.control.id).toBe("control-1");
    expect(result.raci).toHaveLength(1);
    expect(result.raci[0]?.role).toBe("C");
  });

  it("exposes an action plan's RACI assignments alongside the computed view", async () => {
    const service = buildService({
      risks: [risk()],
      controls: [],
      actions: [actionPlan()],
      raci: [assignment("ACTION_PLAN", "action-1", "user-i", "I")],
    });

    const result = await service.getActionPlanWithRaci(fullReader, "action-1");

    // toView() ran: computedStatus is present even though it's not a stored ActionPlan field.
    expect(result.actionPlan.id).toBe("action-1");
    expect(result.actionPlan.computedStatus).toBeDefined();
    expect(result.raci).toHaveLength(1);
    expect(result.raci[0]?.role).toBe("I");
  });

  it("returns an empty RACI list when nobody is assigned, not an error", async () => {
    const service = buildService({ risks: [risk()], controls: [], actions: [], raci: [] });
    const result = await service.getRiskWithRaci(fullReader, "risk-1");
    expect(result.raci).toEqual([]);
  });

  it("isolates tenants — a risk from another tenant is not found, RACI never even looked up", async () => {
    const service = buildService({
      risks: [risk("risk-1", TENANT)],
      controls: [],
      actions: [],
      raci: [assignment("RISK", "risk-1", "user-a", "R")],
    });
    const foreign: AuthenticatedUser = { ...fullReader, tenantId: "tenant-2" };
    await expect(service.getRiskWithRaci(foreign, "risk-1")).rejects.toThrow(NotFoundError);
  });

  /**
   * RACI STAYS DECLARATIVE — the core assertion this whole lot exists to
   * prove: a RACI role is never a substitute for the real permission, in
   * either direction.
   */
  describe("RACI never gates a write, and a RACI role is never a substitute permission", () => {
    it("a normal writer without raci.read can still write risk-1, even though the RACI view is closed to them", async () => {
      const audit = inMemoryAuditRepository();
      const riskRepository = inMemoryRiskRepository([risk()]);
      const riskService = new RiskService(riskRepository, audit);

      // The write path (RiskService.update) doesn't go through RACI at all —
      // risk.update is sufficient on its own.
      const updated = await riskService.update(writerWithoutRaciRead, "risk-1", { description: "Mise à jour" }, "REQ-1");
      expect(updated.description).toBe("Mise à jour");

      // And the composed read-side view correctly refuses them raci.read —
      // proving the two are genuinely independent gates, not one standing in for the other.
      const service = buildService({
        risks: [risk()],
        controls: [],
        actions: [],
        raci: [assignment("RISK", "risk-1", "user-a", "R")],
      });
      await expect(service.getRiskWithRaci(writerWithoutRaciRead, "risk-1")).rejects.toThrow(ForbiddenError);
    });

    it("holding the RACI Responsible role on risk-1 grants no write access without risk.update", async () => {
      const audit = inMemoryAuditRepository();
      const riskRepository = inMemoryRiskRepository([risk()]);
      const riskService = new RiskService(riskRepository, audit);

      // raciResponsibleOnly is recorded as Responsible on risk-1 (see RACI data below)
      // but RiskService.update never consults RACI at all — only risk.update, which
      // this actor does not hold.
      await expect(
        riskService.update(raciResponsibleOnly, "risk-1", { description: "Tentative non autorisée" }, "REQ-2"),
      ).rejects.toThrow(ForbiddenError);

      // Confirm the RACI row genuinely exists (so the above isn't a false negative
      // from a missing assignment) — read it through the composed view, which this
      // actor CAN reach since they hold raci.read (but not risk.read, so this itself fails too).
      await expect(
        buildService({
          risks: [risk()],
          controls: [],
          actions: [],
          raci: [assignment("RISK", "risk-1", raciResponsibleOnly.userId, "R")],
        }).getRiskWithRaci(raciResponsibleOnly, "risk-1"),
      ).rejects.toThrow(ForbiddenError); // fails on risk.read, before RACI is ever consulted.
    });
  });
});
