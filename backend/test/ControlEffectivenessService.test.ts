import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ControlEffectivenessService } from "../src/services/ControlEffectivenessService.js";
import type { ControlEffectivenessRepository } from "../src/domain/repositories/ControlEffectivenessRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ControlEffectivenessAssessment } from "../src/domain/entities/ControlEffectivenessAssessment.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryEffectivenessRepository(): ControlEffectivenessRepository {
  const store = new Map<string, ControlEffectivenessAssessment>();
  return {
    async getById(tenantId, id) {
      const a = store.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async listForControl(tenantId, controlId) {
      return [...store.values()].filter((a) => a.tenantId === tenantId && a.controlId === controlId);
    },
    async create(input) {
      const assessment: ControlEffectivenessAssessment = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlId: input.controlId,
        evalDate: new Date(),
        evalType: input.evalType ?? null,
        evaluatedBy: input.evaluatedBy,
        designAdequacy: input.designAdequacy ?? null,
        executionQuality: input.executionQuality ?? null,
        operationalEffectiveness: input.operationalEffectiveness,
        result: input.result ?? null,
        limitations: input.limitations ?? null,
        compensatingControls: input.compensatingControls ?? null,
        conclusion: input.conclusion ?? null,
        justification: input.justification,
        controlVersionSnapshot: input.controlVersionSnapshot ?? null,
        status: input.status ?? "COMPLETED",
        validatedBy: null,
        validatedAt: null,
        createdAt: new Date(),
      };
      store.set(assessment.id, assessment);
      return assessment;
    },
    async recordValidation(tenantId, id, validatedBy, appendToJustification) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      if (existing.validatedAt) throw new ValidationError("This assessment has already been validated");
      const updated: ControlEffectivenessAssessment = {
        ...existing,
        validatedBy,
        validatedAt: new Date(),
        justification: appendToJustification
          ? `${existing.justification}\n[Validation] ${appendToJustification}`
          : existing.justification,
      };
      store.set(id, updated);
      return updated;
    },
  };
}

function fakeControlRepository(existingControlIds: string[]): ControlRepository {
  const control = (id: string): Control => ({
    id,
    tenantId: "tenant-1",
    label: "L",
    objective: null,
    coveredRiskIds: [],
    process: null,
    departmentId: null,
    procedureDescription: null,
    controlType: "DETECTIVE",
    nature: null,
    defenseLine: null,
    frequency: "Mensuel",
    executor: "IT",
    validator: null,
    expectedEvidence: null,
    complianceCriteria: "criteria",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingControlIds.includes(id) ? control(id) : null;
    },
    async list() {
      return existingControlIds.map(control);
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
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
  };
}

const evaluator: AuthenticatedUser = {
  userId: "user-evaluator",
  tenantId: "tenant-1",
  email: "evaluator@example.com",
  displayName: "Evaluator",
  roles: ["effectiveness.read", "effectiveness.create", "effectiveness.validate"],
};

const validator: AuthenticatedUser = {
  ...evaluator,
  userId: "user-validator",
  email: "validator@example.com",
};

const validInput = {
  controlId: "control-1",
  operationalEffectiveness: "EFFECTIVE" as const,
  justification: "Sample tested, no exceptions found",
};

describe("ControlEffectivenessService", () => {
  it("records an assessment, always attributed to the calling actor", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const assessment = await service.create(evaluator, validInput, "REQ-1");
    expect(assessment.evaluatedBy).toBe("user-evaluator");
    expect(assessment.status).toBe("COMPLETED");
  });

  it("rejects a non-existent control", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository([]),
      inMemoryAuditRepository(),
    );
    await expect(service.create(evaluator, validInput, "REQ-2")).rejects.toThrow(ValidationError);
  });

  it("requires a justification even when operationalEffectiveness is provided", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    await expect(
      service.create(evaluator, { ...validInput, justification: "  " }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("lets a different user validate an assessment", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const assessment = await service.create(evaluator, validInput, "REQ-4");
    const validated = await service.validate(validator, assessment.id, "Reviewed", "REQ-5");
    expect(validated.validatedBy).toBe("user-validator");
    expect(validated.justification).toContain("Reviewed");
  });

  it("rejects an evaluator validating their own assessment (maker-checker)", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const assessment = await service.create(evaluator, validInput, "REQ-6");
    await expect(service.validate(evaluator, assessment.id, null, "REQ-7")).rejects.toThrow(ForbiddenError);
  });

  it("rejects validating an already-validated assessment", async () => {
    const service = new ControlEffectivenessService(
      inMemoryEffectivenessRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const assessment = await service.create(evaluator, validInput, "REQ-8");
    await service.validate(validator, assessment.id, null, "REQ-9");
    await expect(service.validate(validator, assessment.id, null, "REQ-10")).rejects.toThrow(
      ValidationError,
    );
  });
});
