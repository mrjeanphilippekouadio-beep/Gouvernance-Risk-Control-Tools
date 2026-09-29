import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ControlService } from "../src/services/ControlService.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryControlRepository(): ControlRepository {
  const store = new Map<string, Control>();
  return {
    async getById(tenantId, id) {
      const c = store.get(id);
      return c && c.tenantId === tenantId && !c.deletedAt ? c : null;
    },
    async list(tenantId) {
      return [...store.values()].filter((c) => c.tenantId === tenantId && !c.deletedAt);
    },
    async listCoveringRisk(tenantId, riskId) {
      return [...store.values()].filter(
        (c) => c.tenantId === tenantId && !c.deletedAt && c.coveredRiskIds.includes(riskId),
      );
    },
    async create(input) {
      const control: Control = {
        id: randomUUID(),
        tenantId: input.tenantId,
        label: input.label,
        objective: input.objective ?? null,
        coveredRiskIds: input.coveredRiskIds,
        process: input.process ?? null,
        processId: input.processId ?? null,
        departmentId: input.departmentId ?? null,
        procedureDescription: input.procedureDescription ?? null,
        controlType: input.controlType,
        nature: input.nature ?? null,
        defenseLine: input.defenseLine ?? null,
        frequency: input.frequency,
        executor: input.executor,
        validator: input.validator ?? null,
        expectedEvidence: input.expectedEvidence ?? null,
        complianceCriteria: input.complianceCriteria,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(control.id, control);
      return control;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
  };
}

function fakeRiskRepository(existingRiskIds: string[]): RiskRepository {
  const risk = (id: string): Risk => ({
    id,
    tenantId: "tenant-1",
    process: "P",
    description: "D",
    ownerDepartmentId: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingRiskIds.includes(id) ? risk(id) : null;
    },
    async listByIds(_tenantId, ids) {
      return ids.filter((id) => existingRiskIds.includes(id)).map(risk);
    },
    async list() {
      return existingRiskIds.map(risk);
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

function inMemoryProcessRepository(processes: Process[]): ProcessRepository {
  return {
    async getById(tenantId, id) {
      const p = processes.find((x) => x.tenantId === tenantId && x.id === id && !x.deletedAt);
      return p ?? null;
    },
    async list() {
      throw new Error("not implemented");
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function stubProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    parentId: null,
    level: "PROCESS",
    name: "Onboarding",
    description: null,
    documentType: null,
    documentReference: null,
    owner: null,
    active: true,
    evaluationMode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
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

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["control.read", "control.create", "control.update", "control.delete"],
};

const validInput = {
  label: "Revue mensuelle des accès",
  coveredRiskIds: ["risk-1"],
  controlType: "DETECTIVE" as const,
  frequency: "Mensuel",
  executor: "IT Security",
  complianceCriteria: "100% des accès revus",
};

describe("ControlService", () => {
  it("creates a control when it covers at least one existing risk", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const control = await service.create(actor, validInput, "REQ-1");
    expect(control.status).toBe("DRAFT");
    expect(control.coveredRiskIds).toEqual(["risk-1"]);
  });

  it("rejects a control with no covered risk", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository([]), inMemoryAuditRepository());
    await expect(
      service.create(actor, { ...validInput, coveredRiskIds: [] }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a control referencing a risk that doesn't exist in this tenant", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    await expect(
      service.create(actor, { ...validInput, coveredRiskIds: ["risk-does-not-exist"] }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a control missing compliance criteria", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    await expect(
      service.create(actor, { ...validInput, complianceCriteria: "  " }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("allows DRAFT -> ACTIVE but rejects ACTIVE -> DRAFT", async () => {
    const repo = inMemoryControlRepository();
    const service = new ControlService(repo, fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const control = await service.create(actor, validInput, "REQ-5");

    const active = await service.update(actor, control.id, { status: "ACTIVE" }, "REQ-6");
    expect(active.status).toBe("ACTIVE");

    await expect(service.update(actor, control.id, { status: "DRAFT" }, "REQ-7")).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects setting status to ARCHIVED via update (must use archive endpoint)", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const control = await service.create(actor, validInput, "REQ-8");
    await expect(service.update(actor, control.id, { status: "ARCHIVED" }, "REQ-9")).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects clearing all covered risks via update", async () => {
    const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
    const control = await service.create(actor, validInput, "REQ-10");
    await expect(
      service.update(actor, control.id, { coveredRiskIds: [] }, "REQ-11"),
    ).rejects.toThrow(ValidationError);
  });

  describe("processId (DIV-05)", () => {
    it("creates a control with a valid processId when ProcessRepository is wired", async () => {
      const process = stubProcess();
      const service = new ControlService(
        inMemoryControlRepository(),
        fakeRiskRepository(["risk-1"]),
        inMemoryAuditRepository(),
        inMemoryProcessRepository([process]),
      );

      const control = await service.create(actor, { ...validInput, processId: process.id }, "REQ-12");
      expect(control.processId).toBe(process.id);
    });

    it("creates a control with processId omitted (null), without needing ProcessRepository", async () => {
      const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());
      const control = await service.create(actor, validInput, "REQ-13");
      expect(control.processId).toBeNull();
    });

    it("rejects a processId that does not resolve to a process in the tenant", async () => {
      const service = new ControlService(
        inMemoryControlRepository(),
        fakeRiskRepository(["risk-1"]),
        inMemoryAuditRepository(),
        inMemoryProcessRepository([]),
      );

      await expect(
        service.create(actor, { ...validInput, processId: randomUUID() }, "REQ-14"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws (does not silently skip validation) when processId is supplied but ProcessRepository is not configured", async () => {
      const service = new ControlService(inMemoryControlRepository(), fakeRiskRepository(["risk-1"]), inMemoryAuditRepository());

      await expect(
        service.create(actor, { ...validInput, processId: randomUUID() }, "REQ-15"),
      ).rejects.toThrow(ValidationError);
    });

    it("updates a control's processId when valid", async () => {
      const processA = stubProcess();
      const processB = stubProcess();
      const service = new ControlService(
        inMemoryControlRepository(),
        fakeRiskRepository(["risk-1"]),
        inMemoryAuditRepository(),
        inMemoryProcessRepository([processA, processB]),
      );
      const control = await service.create(actor, { ...validInput, processId: processA.id }, "REQ-16");

      const updated = await service.update(actor, control.id, { processId: processB.id }, "REQ-17");
      expect(updated.processId).toBe(processB.id);
    });

    it("rejects a processId belonging to another tenant", async () => {
      const otherTenantProcess = stubProcess({ tenantId: "tenant-2" });
      const service = new ControlService(
        inMemoryControlRepository(),
        fakeRiskRepository(["risk-1"]),
        inMemoryAuditRepository(),
        inMemoryProcessRepository([otherTenantProcess]),
      );

      await expect(
        service.create(actor, { ...validInput, processId: otherTenantProcess.id }, "REQ-18"),
      ).rejects.toThrow(ValidationError);
    });
  });
});
