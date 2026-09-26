import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DepartmentService } from "../src/services/DepartmentService.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

const DEFAULT_DESIGNATION_LABEL = "Pilote par défaut (manager, aucune désignation explicite)";

function inMemoryDepartmentRepository(): DepartmentRepository {
  const store = new Map<string, Department>();
  return {
    async getById(tenantId, id) {
      const d = store.get(id);
      return d && d.tenantId === tenantId && !d.deletedAt ? d : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (d) => d.tenantId === tenantId && !d.deletedAt && (options?.includeInactive || d.active),
      );
    },
    async create(input) {
      const riskOwner = input.riskOwner?.trim() || input.manager;
      const designatedBy = input.riskOwner?.trim()
        ? (input.riskOwnerDesignatedBy ?? input.manager)
        : DEFAULT_DESIGNATION_LABEL;
      const department: Department = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        entity: input.entity ?? null,
        manager: input.manager,
        riskOwner,
        riskOwnerDesignatedBy: designatedBy,
        riskOwnerDesignatedAt: new Date(),
        linkedProcesses: input.linkedProcesses ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(department.id, department);
      return department;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async designateRiskOwner(tenantId, id, riskOwner, designatedBy) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = {
        ...existing,
        riskOwner,
        riskOwnerDesignatedBy: designatedBy,
        riskOwnerDesignatedAt: new Date(),
        updatedAt: new Date(),
      };
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
  roles: ["department.read", "department.create", "department.update", "department.delete"],
};

describe("DepartmentService", () => {
  it("defaults the risk owner to the manager when none is given", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const dept = await service.create(actor, { name: "Finance", manager: "alice@djamo.com" }, "REQ-1");
    expect(dept.riskOwner).toBe("alice@djamo.com");
    expect(dept.riskOwnerDesignatedBy).toBe(DEFAULT_DESIGNATION_LABEL);
  });

  it("respects an explicit risk owner", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const dept = await service.create(
      actor,
      { name: "Finance", manager: "alice@djamo.com", riskOwner: "bob@djamo.com" },
      "REQ-2",
    );
    expect(dept.riskOwner).toBe("bob@djamo.com");
  });

  it("requires a manager", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    await expect(service.create(actor, { name: "Finance", manager: "  " }, "REQ-3")).rejects.toThrow(
      ValidationError,
    );
  });

  it("re-designates the risk owner explicitly", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const dept = await service.create(actor, { name: "Finance", manager: "alice@djamo.com" }, "REQ-4");
    const updated = await service.designateRiskOwner(actor, dept.id, "carol@djamo.com", "REQ-5");
    expect(updated.riskOwner).toBe("carol@djamo.com");
    expect(updated.riskOwnerDesignatedBy).toBe("user-1");
  });

  it("requires a reason to archive", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const dept = await service.create(actor, { name: "Finance", manager: "alice@djamo.com" }, "REQ-6");
    await expect(service.archive(actor, dept.id, "", "REQ-7")).rejects.toThrow(ValidationError);
  });
});
