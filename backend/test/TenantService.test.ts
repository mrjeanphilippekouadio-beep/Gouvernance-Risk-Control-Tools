import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TenantService } from "../src/services/TenantService.js";
import type { TenantRepository } from "../src/domain/repositories/TenantRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Tenant } from "../src/domain/entities/Tenant.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryTenantRepository(): TenantRepository {
  const byId = new Map<string, Tenant>();
  return {
    async getDriveFolderId() {
      return "folder";
    },
    async getById(id) {
      return byId.get(id) ?? null;
    },
    async list() {
      return [...byId.values()];
    },
    async create(input) {
      const tenant: Tenant = {
        id: randomUUID(),
        name: input.name,
        deploymentMode: input.deploymentMode ?? "managed_saas",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byId.set(tenant.id, tenant);
      return tenant;
    },
    async update(id, input) {
      const existing = byId.get(id);
      if (!existing) throw new NotFoundError("Tenant", id);
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

const superAdmin: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["config.manage"],
};

const noPermsActor: AuthenticatedUser = { ...superAdmin, userId: "user-2", roles: [] };

describe("TenantService", () => {
  it("rejects create/update/list for an actor without config.manage", async () => {
    const service = new TenantService(inMemoryTenantRepository(), inMemoryAuditRepository());
    await expect(service.create(noPermsActor, { name: "Djamo Sénégal" }, "REQ-1")).rejects.toThrow(ForbiddenError);
    await expect(service.list(noPermsActor)).rejects.toThrow(ForbiddenError);
  });

  it("requires a name to create a tenant", async () => {
    const service = new TenantService(inMemoryTenantRepository(), inMemoryAuditRepository());
    await expect(service.create(superAdmin, { name: "   " }, "REQ-1")).rejects.toThrow(ValidationError);
  });

  it("creates a tenant with its own isolated id, distinct from every other tenant", async () => {
    const service = new TenantService(inMemoryTenantRepository(), inMemoryAuditRepository());
    const first = await service.create(superAdmin, { name: "Djamo Côte d'Ivoire" }, "REQ-1");
    const second = await service.create(superAdmin, { name: "Djamo Sénégal" }, "REQ-2");

    expect(first.id).not.toBe(second.id);
    const all = await service.list(superAdmin);
    expect(all.map((t) => t.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("patching one tenant's name/active flag never touches another tenant's row", async () => {
    const service = new TenantService(inMemoryTenantRepository(), inMemoryAuditRepository());
    const first = await service.create(superAdmin, { name: "Djamo Côte d'Ivoire" }, "REQ-1");
    const second = await service.create(superAdmin, { name: "Djamo Sénégal" }, "REQ-2");

    const patched = await service.update(superAdmin, first.id, { active: false }, "REQ-3");

    expect(patched.id).toBe(first.id);
    expect(patched.active).toBe(false);
    const untouched = await service.get(superAdmin, second.id);
    expect(untouched.active).toBe(true);
    expect(untouched.name).toBe("Djamo Sénégal");
  });

  it("404s on update for a tenant id that doesn't exist", async () => {
    const service = new TenantService(inMemoryTenantRepository(), inMemoryAuditRepository());
    await expect(service.update(superAdmin, "does-not-exist", { active: false }, "REQ-1")).rejects.toThrow(
      NotFoundError,
    );
  });
});
