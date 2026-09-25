import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import type { ControlExecutionRepository } from "../src/domain/repositories/ControlExecutionRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ControlExecution } from "../src/domain/entities/ControlExecution.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryExecutionRepository(): ControlExecutionRepository {
  const store = new Map<string, ControlExecution>();
  return {
    async getById(tenantId, id) {
      const e = store.get(id);
      return e && e.tenantId === tenantId ? e : null;
    },
    async listForControl(tenantId, controlId) {
      return [...store.values()].filter((e) => e.tenantId === tenantId && e.controlId === controlId);
    },
    async create(input) {
      const execution: ControlExecution = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlId: input.controlId,
        plannedDate: input.plannedDate ?? null,
        completedDate: input.completedDate ?? null,
        executedBy: input.executedBy,
        result: input.result ?? null,
        observedAnomalies: input.observedAnomalies ?? null,
        justificationIfNotDone: input.justificationIfNotDone ?? null,
        status: input.status,
        validatedBy: null,
        validatedAt: null,
        createdAt: new Date(),
      };
      store.set(execution.id, execution);
      return execution;
    },
    async recordValidation(tenantId, id, validatedBy, appendToResult) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      if (existing.validatedAt) throw new ValidationError("This execution has already been validated");
      const updated: ControlExecution = {
        ...existing,
        validatedBy,
        validatedAt: new Date(),
        result: appendToResult ? `${existing.result ?? ""}\n[Validation] ${appendToResult}` : existing.result,
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

const executor: AuthenticatedUser = {
  userId: "user-executor",
  tenantId: "tenant-1",
  email: "executor@example.com",
  displayName: "Executor",
  roles: ["execution.read", "execution.create", "execution.validate"],
};

const validator: AuthenticatedUser = {
  ...executor,
  userId: "user-validator",
  email: "validator@example.com",
};

describe("ControlExecutionService", () => {
  it("records a DONE execution", async () => {
    const service = new ControlExecutionService(
      inMemoryExecutionRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const execution = await service.create(executor, { controlId: "control-1", status: "DONE" }, "REQ-1");
    expect(execution.status).toBe("DONE");
    expect(execution.executedBy).toBe("user-executor");
  });

  it("rejects a non-existent control", async () => {
    const service = new ControlExecutionService(
      inMemoryExecutionRepository(),
      fakeControlRepository([]),
      inMemoryAuditRepository(),
    );
    await expect(
      service.create(executor, { controlId: "missing", status: "DONE" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a justification for a non-DONE execution", async () => {
    const service = new ControlExecutionService(
      inMemoryExecutionRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    await expect(
      service.create(executor, { controlId: "control-1", status: "NOT_DONE" }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a non-DONE execution with a justification", async () => {
    const service = new ControlExecutionService(
      inMemoryExecutionRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const execution = await service.create(
      executor,
      { controlId: "control-1", status: "NOT_APPLICABLE", justificationIfNotDone: "Process retired" },
      "REQ-4",
    );
    expect(execution.status).toBe("NOT_APPLICABLE");
  });

  it("lets a different user validate an execution", async () => {
    const repo = inMemoryExecutionRepository();
    const service = new ControlExecutionService(repo, fakeControlRepository(["control-1"]), inMemoryAuditRepository());
    const execution = await service.create(executor, { controlId: "control-1", status: "DONE" }, "REQ-5");

    const validated = await service.validate(validator, execution.id, "Looks good", "REQ-6");
    expect(validated.validatedBy).toBe("user-validator");
    expect(validated.result).toContain("Looks good");
  });

  it("rejects an executor validating their own execution (maker-checker)", async () => {
    const repo = inMemoryExecutionRepository();
    const service = new ControlExecutionService(repo, fakeControlRepository(["control-1"]), inMemoryAuditRepository());
    const execution = await service.create(executor, { controlId: "control-1", status: "DONE" }, "REQ-7");

    await expect(service.validate(executor, execution.id, null, "REQ-8")).rejects.toThrow(ForbiddenError);
  });

  it("rejects validating an already-validated execution", async () => {
    const repo = inMemoryExecutionRepository();
    const service = new ControlExecutionService(repo, fakeControlRepository(["control-1"]), inMemoryAuditRepository());
    const execution = await service.create(executor, { controlId: "control-1", status: "DONE" }, "REQ-9");
    await service.validate(validator, execution.id, null, "REQ-10");

    await expect(service.validate(validator, execution.id, null, "REQ-11")).rejects.toThrow(ValidationError);
  });
});
