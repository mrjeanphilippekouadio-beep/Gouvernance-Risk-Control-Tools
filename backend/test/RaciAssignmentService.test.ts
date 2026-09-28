import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RaciAssignmentService } from "../src/services/RaciAssignmentService.js";
import type { RaciAssignmentRepository } from "../src/domain/repositories/RaciAssignmentRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { RaciAssignment } from "../src/domain/entities/RaciAssignment.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRaciRepository(): RaciAssignmentRepository {
  const store = new Map<string, RaciAssignment>();
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
      store.set(assignment.id, assignment);
      return assignment;
    },
    async getById(tenantId, id) {
      const a = store.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async listForEntity(tenantId, entityType, entityId) {
      return [...store.values()].filter(
        (a) => a.tenantId === tenantId && a.entityType === entityType && a.entityId === entityId && !a.deletedAt,
      );
    },
    async remove(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.deletedAt) throw new NotFoundError("RaciAssignment", id);
      const updated: RaciAssignment = { ...existing, deletedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
  };
}

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

function fakeRiskRepository(riskIds: string[], tenantId: string): RiskRepository {
  return {
    async getById(t, id) {
      return t === tenantId && riskIds.includes(id) ? ({ id, tenantId: t } as unknown as Risk) : null;
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
  } as unknown as RiskRepository;
}

const noopControlRepository = undefined as unknown as ControlRepository;
const noopActionPlanRepository = undefined as unknown as ActionPlanRepository;

function actor(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    userId: "user-1",
    tenantId: "tenant-1",
    email: "u1@example.com",
    displayName: "User One",
    roles: ["raci.assign", "raci.revoke", "raci.read"],
    ...overrides,
  };
}

describe("RaciAssignmentService", () => {
  it("assigns a RACI role on an existing entity and records the audit trail", async () => {
    const risks = fakeRiskRepository(["risk-1"], "tenant-1");
    const audit = inMemoryAuditRepository();
    let recorded: unknown = null;
    audit.record = async (event) => {
      recorded = event;
    };
    const service = new RaciAssignmentService(inMemoryRaciRepository(), audit, risks, noopControlRepository, noopActionPlanRepository);

    const assignment = await service.assign(actor(), "Risk", "risk-1", "user-2", "R", "req-1");

    expect(assignment.entityType).toBe("Risk");
    expect(assignment.userId).toBe("user-2");
    expect(assignment.role).toBe("R");
    expect(assignment.createdBy).toBe("user-1"); // forced server-side, never client-supplied
    expect(recorded).toMatchObject({ action: "CREATE", entityType: "RaciAssignment" });
  });

  it("lists assignments for an entity", async () => {
    const risks = fakeRiskRepository(["risk-1"], "tenant-1");
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository(), risks, noopControlRepository, noopActionPlanRepository);

    await service.assign(actor(), "Risk", "risk-1", "user-2", "R", "req-1");
    await service.assign(actor(), "Risk", "risk-1", "user-3", "C", "req-2");

    const list = await service.list(actor(), "Risk", "risk-1");
    expect(list).toHaveLength(2);
  });

  it("revokes (soft-deletes) an assignment", async () => {
    const risks = fakeRiskRepository(["risk-1"], "tenant-1");
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository(), risks, noopControlRepository, noopActionPlanRepository);

    const assignment = await service.assign(actor(), "Risk", "risk-1", "user-2", "R", "req-1");
    const revoked = await service.revoke(actor(), "Risk", "risk-1", assignment.id, "req-2");

    expect(revoked.deletedAt).not.toBeNull();
    const list = await service.list(actor(), "Risk", "risk-1");
    expect(list).toHaveLength(0);
  });

  it("rejects assignment when entityId does not exist in the tenant", async () => {
    const risks = fakeRiskRepository([], "tenant-1"); // no risks exist
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository(), risks, noopControlRepository, noopActionPlanRepository);

    await expect(service.assign(actor(), "Risk", "risk-does-not-exist", "user-2", "R", "req-1")).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown entityType", async () => {
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository());
    await expect(
      service.assign(actor(), "Incident" as never, "x", "user-2", "R", "req-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires raci.assign permission", async () => {
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository());
    await expect(
      service.assign(actor({ roles: [] }), "Risk", "risk-1", "user-2", "R", "req-1"),
    ).rejects.toThrow(ForbiddenError);
  });

  // Security guard-rail: self-designation as Accountable while already Responsible on the same entity.
  it("blocks self-designation as Accountable when the actor already holds Responsible on the same entity", async () => {
    const risks = fakeRiskRepository(["risk-1"], "tenant-1");
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository(), risks, noopControlRepository, noopActionPlanRepository);

    await service.assign(actor(), "Risk", "risk-1", "user-1", "R", "req-1"); // actor assigns themselves as Responsible

    await expect(service.assign(actor(), "Risk", "risk-1", "user-1", "A", "req-2")).rejects.toThrow(ForbiddenError);
  });

  it("still allows a different actor to designate that same user as Accountable", async () => {
    const risks = fakeRiskRepository(["risk-1"], "tenant-1");
    const service = new RaciAssignmentService(inMemoryRaciRepository(), inMemoryAuditRepository(), risks, noopControlRepository, noopActionPlanRepository);

    await service.assign(actor(), "Risk", "risk-1", "user-2", "R", "req-1"); // user-2 is Responsible
    const admin = actor({ userId: "admin-1", roles: ["raci.assign"] });
    const assignment = await service.assign(admin, "Risk", "risk-1", "user-2", "A", "req-2"); // admin (not user-2) assigns it

    expect(assignment.role).toBe("A");
  });
});
