import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AuditMissionService } from "../src/services/AuditMissionService.js";
import type { AuditMissionRepository } from "../src/domain/repositories/AuditMissionRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { AuditMission } from "../src/domain/entities/AuditMission.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryAuditMissionRepository(): AuditMissionRepository {
  const store = new Map<string, AuditMission>();
  return {
    async getById(tenantId, id) {
      const m = store.get(id);
      return m && m.tenantId === tenantId ? m : null;
    },
    async list(tenantId, filters) {
      return [...store.values()].filter((m) => {
        if (m.tenantId !== tenantId) return false;
        if (filters?.status && m.status !== filters.status) return false;
        if (filters?.leadAuditorId && m.leadAuditorId !== filters.leadAuditorId) return false;
        return true;
      });
    },
    async create(input) {
      const mission: AuditMission = {
        id: randomUUID(),
        tenantId: input.tenantId,
        reference: input.reference,
        title: input.title,
        scope: input.scope,
        status: "PLANIFIEE",
        leadAuditorId: input.leadAuditorId,
        auditorIds: input.auditorIds ?? [],
        plannedStartDate: input.plannedStartDate,
        plannedEndDate: input.plannedEndDate,
        actualStartDate: null,
        actualEndDate: null,
        closureComment: null,
        createdBy: input.createdBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(mission.id, mission);
      return mission;
    },
    async start(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: AuditMission = { ...existing, status: "EN_COURS", actualStartDate: new Date(), updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async close(tenantId, id, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: AuditMission = {
        ...existing,
        status: "CLOTUREE",
        actualEndDate: new Date(),
        closureComment: comment,
        updatedAt: new Date(),
      };
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

function fakeUserRepository(users: User[]): UserRepository {
  return {
    async getById(tenantId, id) {
      return users.find((u) => u.id === id && u.tenantId === tenantId) ?? null;
    },
    async getByEmail() {
      return null;
    },
    async list() {
      return [];
    },
    async count() {
      return 0;
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async suspend() {
      throw new Error("not used in this test");
    },
    async reactivate() {
      throw new Error("not used in this test");
    },
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: "auditor-1",
    tenantId: "tenant-1",
    email: "auditor@example.com",
    displayName: "Lead Auditor",
    roles: [],
    departmentId: null,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["audit.mission.read", "audit.mission.create", "audit.mission.update", "audit.mission.close"],
};

function futureDate(days = 30): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function buildService(overrides: { missions?: AuditMissionRepository; users?: UserRepository } = {}) {
  return new AuditMissionService(
    overrides.missions ?? inMemoryAuditMissionRepository(),
    inMemoryAuditRepository(),
    overrides.users ?? fakeUserRepository([user({ id: "auditor-1" }), user({ id: "auditor-2" })]),
  );
}

describe("AuditMissionService", () => {
  it("creates a mission in PLANIFIEE status, attributed to the actor", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      {
        reference: "AUD-2026-001",
        title: "Audit du dispositif KYC",
        scope: "Processus d'entrée en relation client",
        leadAuditorId: "auditor-1",
        auditorIds: ["auditor-2"],
        plannedStartDate: futureDate(1),
        plannedEndDate: futureDate(30),
      },
      "REQ-1",
    );
    expect(mission.status).toBe("PLANIFIEE");
    expect(mission.createdBy).toBe("user-1");
    expect(mission.leadAuditorId).toBe("auditor-1");
  });

  it("rejects a plannedEndDate before plannedStartDate", async () => {
    const service = buildService();
    await expect(
      service.create(
        actor,
        {
          reference: "AUD-2026-002",
          title: "T",
          scope: "S",
          leadAuditorId: "auditor-1",
          plannedStartDate: futureDate(30),
          plannedEndDate: futureDate(1),
        },
        "REQ-2",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a leadAuditorId that does not exist in this tenant", async () => {
    const service = buildService({ users: fakeUserRepository([]) });
    await expect(
      service.create(
        actor,
        {
          reference: "AUD-2026-003",
          title: "T",
          scope: "S",
          leadAuditorId: "ghost",
          plannedStartDate: futureDate(1),
          plannedEndDate: futureDate(30),
        },
        "REQ-3",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("allows PLANIFIEE -> EN_COURS via start(), setting actualStartDate", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      { reference: "AUD-2026-004", title: "T", scope: "S", leadAuditorId: "auditor-1", plannedStartDate: futureDate(1), plannedEndDate: futureDate(30) },
      "REQ-4",
    );
    const started = await service.start(actor, mission.id, "REQ-5");
    expect(started.status).toBe("EN_COURS");
    expect(started.actualStartDate).not.toBeNull();
  });

  it("rejects starting a mission that is not PLANIFIEE", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      { reference: "AUD-2026-005", title: "T", scope: "S", leadAuditorId: "auditor-1", plannedStartDate: futureDate(1), plannedEndDate: futureDate(30) },
      "REQ-6",
    );
    await service.start(actor, mission.id, "REQ-7");
    await expect(service.start(actor, mission.id, "REQ-8")).rejects.toThrow(ValidationError);
  });

  it("requires a closure comment to close a mission, and rejects closing a PLANIFIEE mission", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      { reference: "AUD-2026-006", title: "T", scope: "S", leadAuditorId: "auditor-1", plannedStartDate: futureDate(1), plannedEndDate: futureDate(30) },
      "REQ-9",
    );

    await expect(service.close(actor, mission.id, "Done", "REQ-10")).rejects.toThrow(ValidationError);

    await service.start(actor, mission.id, "REQ-11");
    await expect(service.close(actor, mission.id, "", "REQ-12")).rejects.toThrow(ValidationError);

    const closed = await service.close(actor, mission.id, "Mission terminée, rapport diffusé", "REQ-13");
    expect(closed.status).toBe("CLOTUREE");
    expect(closed.actualEndDate).not.toBeNull();
    expect(closed.closureComment).toBe("Mission terminée, rapport diffusé");
  });

  it("enforces audit.mission.close as a distinct permission from audit.mission.update", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      { reference: "AUD-2026-007", title: "T", scope: "S", leadAuditorId: "auditor-1", plannedStartDate: futureDate(1), plannedEndDate: futureDate(30) },
      "REQ-14",
    );
    await service.start(actor, mission.id, "REQ-15");

    const noCloseActor: AuthenticatedUser = { ...actor, roles: ["audit.mission.read", "audit.mission.update"] };
    await expect(service.close(noCloseActor, mission.id, "Done", "REQ-16")).rejects.toThrow(ForbiddenError);
  });

  it("raises NotFoundError for a mission in another tenant", async () => {
    const service = buildService();
    const mission = await service.create(
      actor,
      { reference: "AUD-2026-008", title: "T", scope: "S", leadAuditorId: "auditor-1", plannedStartDate: futureDate(1), plannedEndDate: futureDate(30) },
      "REQ-17",
    );
    const otherTenantActor: AuthenticatedUser = { ...actor, tenantId: "tenant-2" };
    await expect(service.get(otherTenantActor, mission.id)).rejects.toThrow(NotFoundError);
  });
});
