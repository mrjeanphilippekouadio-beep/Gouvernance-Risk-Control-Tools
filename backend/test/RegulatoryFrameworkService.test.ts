import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RegulatoryFrameworkService } from "../src/services/RegulatoryFrameworkService.js";
import type { RegulatoryFrameworkRepository } from "../src/domain/repositories/RegulatoryFrameworkRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RegulatoryFramework } from "../src/domain/entities/RegulatoryFramework.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRepository(): RegulatoryFrameworkRepository {
  const byId = new Map<string, RegulatoryFramework>();
  return {
    async getById(tenantId, id) {
      const f = byId.get(id);
      return f && f.tenantId === tenantId ? f : null;
    },
    async getByName(tenantId, name) {
      return [...byId.values()].find((f) => f.tenantId === tenantId && f.name === name) ?? null;
    },
    async list(tenantId, options) {
      return [...byId.values()].filter((f) => f.tenantId === tenantId && (!options?.activeOnly || f.active));
    },
    async create(input) {
      const framework: RegulatoryFramework = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byId.set(framework.id, framework);
      return framework;
    },
    async update(_tenantId, id, input) {
      const existing = byId.get(id)!;
      const updated = { ...existing, ...input, updatedAt: new Date() };
      byId.set(id, updated);
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

const admin: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["config.read", "config.manage"],
};

const readOnlyActor: AuthenticatedUser = { ...admin, userId: "user-2", roles: ["config.read"] };

describe("RegulatoryFrameworkService", () => {
  it("creates a framework and rejects a duplicate name for the same tenant", async () => {
    const service = new RegulatoryFrameworkService(inMemoryRepository(), inMemoryAuditRepository());
    await service.create(admin, { name: "BCEAO" }, "REQ-1");
    await expect(service.create(admin, { name: "BCEAO" }, "REQ-2")).rejects.toThrow(ValidationError);
  });

  it("rejects create/update for an actor without config.manage", async () => {
    const service = new RegulatoryFrameworkService(inMemoryRepository(), inMemoryAuditRepository());
    await expect(service.create(readOnlyActor, { name: "ISO 31000" }, "REQ-1")).rejects.toThrow(ForbiddenError);
  });

  it("lists active frameworks by default, excluding inactive ones", async () => {
    const service = new RegulatoryFrameworkService(inMemoryRepository(), inMemoryAuditRepository());
    const active = await service.create(admin, { name: "COSO ERM" }, "REQ-1");
    await service.create(admin, { name: "DORA", active: false }, "REQ-2");

    const activeOnly = await service.list(admin);
    expect(activeOnly).toEqual([expect.objectContaining({ id: active.id })]);

    const all = await service.list(admin, true);
    expect(all).toHaveLength(2);
  });

  it("toggles active/inactive via update", async () => {
    const service = new RegulatoryFrameworkService(inMemoryRepository(), inMemoryAuditRepository());
    const framework = await service.create(admin, { name: "BCEAO" }, "REQ-1");
    const updated = await service.update(admin, framework.id, { active: false }, "REQ-2");
    expect(updated.active).toBe(false);
  });
});
