import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskCategoryService } from "../src/services/RiskCategoryService.js";
import type { RiskCategoryRepository } from "../src/domain/repositories/RiskCategoryRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskCategory } from "../src/domain/entities/RiskCategory.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRepository(): RiskCategoryRepository {
  const byId = new Map<string, RiskCategory>();
  return {
    async getById(tenantId, id) {
      const c = byId.get(id);
      return c && c.tenantId === tenantId ? c : null;
    },
    async list(tenantId, options) {
      return [...byId.values()].filter((c) => c.tenantId === tenantId && (!options?.activeOnly || c.active));
    },
    async create(input) {
      const category: RiskCategory = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        parentId: input.parentId ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byId.set(category.id, category);
      return category;
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

describe("RiskCategoryService", () => {
  it("creates a top-level category and a sub-category under it", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    const category = await service.create(admin, { name: "Risque opérationnel" }, "REQ-1");
    const subCategory = await service.create(admin, { name: "Fraude interne", parentId: category.id }, "REQ-2");
    expect(subCategory.parentId).toBe(category.id);
  });

  it("rejects a sub-category whose parent does not exist", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    await expect(
      service.create(admin, { name: "Fraude interne", parentId: "does-not-exist" }, "REQ-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects nesting a sub-category under another sub-category (max one level deep)", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    const category = await service.create(admin, { name: "Risque opérationnel" }, "REQ-1");
    const subCategory = await service.create(admin, { name: "Fraude interne", parentId: category.id }, "REQ-2");
    await expect(
      service.create(admin, { name: "Fraude carte", parentId: subCategory.id }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects create/update for an actor without config.manage", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    await expect(service.create(readOnlyActor, { name: "Risque de change" }, "REQ-1")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("toggles active/inactive via update", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    const category = await service.create(admin, { name: "Risque opérationnel" }, "REQ-1");
    const updated = await service.update(admin, category.id, { active: false }, "REQ-2");
    expect(updated.active).toBe(false);
  });

  it("update revalidates parentId: unknown/other-tenant parent, sub-category parent, and parent-with-children are rejected", async () => {
    const service = new RiskCategoryService(inMemoryRepository(), inMemoryAuditRepository());
    const a = await service.create(admin, { name: "A" }, "R1");
    const b = await service.create(admin, { name: "B" }, "R2");
    const child = await service.create(admin, { name: "A1", parentId: a.id }, "R3");
    await expect(service.update(admin, b.id, { parentId: "nope" }, "R4")).rejects.toThrow(ValidationError);
    await expect(service.update(admin, b.id, { parentId: child.id }, "R5")).rejects.toThrow(ValidationError);
    // A has a child: it cannot become a sub-category of B (would be depth 2, and A<->B cycle path).
    await expect(service.update(admin, a.id, { parentId: b.id }, "R6")).rejects.toThrow(ValidationError);
    const moved = await service.update(admin, b.id, { parentId: a.id }, "R7");
    expect(moved.parentId).toBe(a.id);
    const detached = await service.update(admin, b.id, { parentId: null }, "R8");
    expect(detached.parentId).toBeNull();
  });
});
