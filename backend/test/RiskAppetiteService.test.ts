import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import type { RiskAppetiteRepository } from "../src/domain/repositories/RiskAppetiteRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskCategoryRepository } from "../src/domain/repositories/RiskCategoryRepository.js";
import type { RiskAppetite } from "../src/domain/entities/RiskAppetite.js";
import type { RiskCategory } from "../src/domain/entities/RiskCategory.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function key(tenantId: string, subCategory: string, entity: string | null): string {
  return `${tenantId}::${subCategory}::${entity ?? ""}`;
}

function inMemoryRiskAppetiteRepository(): RiskAppetiteRepository {
  const byId = new Map<string, RiskAppetite>();
  const byKey = new Map<string, string>(); // natural key -> id

  return {
    async getById(tenantId, id) {
      const a = byId.get(id);
      return a && a.tenantId === tenantId && !a.deletedAt ? a : null;
    },
    async getBySubCategory(tenantId, subCategory, entity, options) {
      const id = byKey.get(key(tenantId, subCategory, entity));
      if (!id) return null;
      const a = byId.get(id);
      if (!a || a.deletedAt) return null;
      if (options?.activeOnly && !a.active) return null;
      return a;
    },
    async list(tenantId, options) {
      return [...byId.values()].filter(
        (a) =>
          a.tenantId === tenantId &&
          !a.deletedAt &&
          (options?.activeOnly === false || a.active) &&
          (!options?.entity || a.entity === options.entity),
      );
    },
    async upsert(input) {
      const entity = input.entity ?? null;
      const existingId = byKey.get(key(input.tenantId, input.subCategory, entity));
      const existing = existingId ? byId.get(existingId) : undefined;

      const appetite: RiskAppetite = {
        id: existing?.id ?? randomUUID(),
        tenantId: input.tenantId,
        subCategory: input.subCategory,
        subCategoryId: input.subCategoryId ?? null,
        entity,
        threshold: input.threshold,
        methodologyVersion: input.methodologyVersion,
        description: input.description ?? null,
        active: input.active ?? true,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      byId.set(appetite.id, appetite);
      byKey.set(key(input.tenantId, input.subCategory, entity), appetite.id);
      return appetite;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = byId.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      byId.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
  };
}

function inMemoryRiskCategoryRepository(categories: RiskCategory[]): RiskCategoryRepository {
  return {
    async getById(tenantId, id) {
      const c = categories.find((x) => x.tenantId === tenantId && x.id === id);
      return c ?? null;
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
  };
}

function stubRiskCategory(overrides: Partial<RiskCategory> = {}): RiskCategory {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    name: "Fraude interne",
    parentId: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
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

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["riskappetite.read", "riskappetite.update", "riskappetite.delete"],
};

const readOnlyActor: AuthenticatedUser = {
  ...actor,
  userId: "user-2",
  roles: ["riskappetite.read"],
};

describe("RiskAppetiteService", () => {
  it("creates a new threshold on first PUT for a sub-category", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    const appetite = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 12, methodologyVersion: "v1" },
      "REQ-1",
    );
    expect(appetite.subCategory).toBe("Fraude interne");
    expect(appetite.threshold).toBe(12);
    expect(appetite.entity).toBeNull();
    expect(appetite.active).toBe(true);
  });

  it("updates in place on a second PUT for the same sub-category and entity", async () => {
    const repo = inMemoryRiskAppetiteRepository();
    const service = new RiskAppetiteService(repo, inMemoryAuditRepository());
    const first = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 10, methodologyVersion: "v1" },
      "REQ-1",
    );
    const second = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 15, methodologyVersion: "v2" },
      "REQ-2",
    );
    expect(second.id).toBe(first.id);
    expect(second.threshold).toBe(15);
    expect(second.methodologyVersion).toBe("v2");
  });

  it("keeps distinct thresholds per entity for the same sub-category", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    const global = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 10, methodologyVersion: "v1" },
      "REQ-1",
    );
    const scoped = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 18, entity: "Djamo CI", methodologyVersion: "v1" },
      "REQ-2",
    );
    expect(scoped.id).not.toBe(global.id);
    expect(scoped.entity).toBe("Djamo CI");
    expect(global.entity).toBeNull();
  });

  it("rejects a threshold outside 1-25", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    await expect(
      service.setThreshold(actor, "Fraude interne", { threshold: 26, methodologyVersion: "v1" }, "REQ-1"),
    ).rejects.toThrow(ValidationError);
    await expect(
      service.setThreshold(actor, "Fraude interne", { threshold: 0, methodologyVersion: "v1" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a sub-category", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    await expect(
      service.setThreshold(actor, "   ", { threshold: 10, methodologyVersion: "v1" }, "REQ-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a methodology version", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    await expect(
      service.setThreshold(actor, "Fraude interne", { threshold: 10, methodologyVersion: "  " }, "REQ-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects setThreshold for an actor without riskappetite.update", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    await expect(
      service.setThreshold(readOnlyActor, "Fraude interne", { threshold: 10, methodologyVersion: "v1" }, "REQ-1"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects list/get for an actor without riskappetite.read", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    const writeOnlyActor: AuthenticatedUser = { ...actor, userId: "user-3", roles: ["riskappetite.update"] };
    await expect(service.list(writeOnlyActor)).rejects.toThrow(ForbiddenError);
  });

  describe("getApplicable (Risk 360/Dispositif de risque read-side helper)", () => {
    it("returns the threshold currently active for a (subCategory, entity) pair", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      await service.setThreshold(actor, "Fraude interne", { threshold: 10, methodologyVersion: "v1" }, "REQ-1");

      const applicable = await service.getApplicable(readOnlyActor, "Fraude interne", null);
      expect(applicable?.threshold).toBe(10);
    });

    it("returns null when no threshold is defined for that pair", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      await expect(service.getApplicable(readOnlyActor, "Inconnue", null)).resolves.toBeNull();
    });

    it("requires riskappetite.read", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      const noRead: AuthenticatedUser = { ...actor, userId: "user-4", roles: [] };
      await expect(service.getApplicable(noRead, "Fraude interne", null)).rejects.toThrow(ForbiddenError);
    });

    it("P-04: does not return a threshold that has been deactivated (active: false) but not soft-deleted", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      await service.setThreshold(
        actor,
        "Fraude interne",
        { threshold: 10, methodologyVersion: "v1", active: false },
        "REQ-1",
      );

      await expect(service.getApplicable(readOnlyActor, "Fraude interne", null)).resolves.toBeNull();
    });

    it("P-04: returns the active threshold again once reactivated", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      await service.setThreshold(
        actor,
        "Fraude interne",
        { threshold: 10, methodologyVersion: "v1", active: false },
        "REQ-1",
      );
      await service.setThreshold(actor, "Fraude interne", { threshold: 11, methodologyVersion: "v2" }, "REQ-2");

      const applicable = await service.getApplicable(readOnlyActor, "Fraude interne", null);
      expect(applicable?.threshold).toBe(11);
    });

    it("P-04: with several thresholds, only the active one for the matching (subCategory, entity) is applicable", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      await service.setThreshold(actor, "Fraude interne", { threshold: 10, methodologyVersion: "v1" }, "REQ-1");
      await service.setThreshold(
        actor,
        "Risque de change",
        { threshold: 8, methodologyVersion: "v1", active: false },
        "REQ-2",
      );

      await expect(service.getApplicable(readOnlyActor, "Fraude interne", null)).resolves.toMatchObject({ threshold: 10 });
      await expect(service.getApplicable(readOnlyActor, "Risque de change", null)).resolves.toBeNull();
    });
  });

  it("lists active thresholds by default and excludes inactive ones", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    await service.setThreshold(actor, "Fraude interne", { threshold: 10, methodologyVersion: "v1" }, "REQ-1");
    await service.setThreshold(
      actor,
      "Risque de change",
      { threshold: 8, methodologyVersion: "v1", active: false },
      "REQ-2",
    );

    const activeOnly = await service.list(actor);
    expect(activeOnly).toHaveLength(1);
    expect(activeOnly[0]?.subCategory).toBe("Fraude interne");

    const all = await service.list(actor, { activeOnly: false });
    expect(all).toHaveLength(2);
  });

  it("requires a reason to archive and enforces tenant scoping via getById", async () => {
    const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
    const appetite = await service.setThreshold(
      actor,
      "Fraude interne",
      { threshold: 10, methodologyVersion: "v1" },
      "REQ-1",
    );
    await expect(service.archive(actor, appetite.id, "", "REQ-2")).rejects.toThrow(ValidationError);

    await service.archive(actor, appetite.id, "Sous-catégorie fusionnée avec une autre", "REQ-3");
    await expect(service.get(actor, appetite.id)).rejects.toThrow(NotFoundError);
  });

  describe("subCategoryId (DIV-08)", () => {
    it("sets a threshold with a valid subCategoryId when RiskCategoryRepository is wired", async () => {
      const category = stubRiskCategory();
      const service = new RiskAppetiteService(
        inMemoryRiskAppetiteRepository(),
        inMemoryAuditRepository(),
        inMemoryRiskCategoryRepository([category]),
      );

      const appetite = await service.setThreshold(
        actor,
        "Fraude interne",
        { threshold: 12, methodologyVersion: "v1", subCategoryId: category.id },
        "REQ-10",
      );
      expect(appetite.subCategoryId).toBe(category.id);
    });

    it("sets a threshold with subCategoryId omitted (null), without needing RiskCategoryRepository", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());
      const appetite = await service.setThreshold(
        actor,
        "Fraude interne",
        { threshold: 12, methodologyVersion: "v1" },
        "REQ-11",
      );
      expect(appetite.subCategoryId).toBeNull();
    });

    it("rejects a subCategoryId that does not resolve to a risk category in the tenant", async () => {
      const service = new RiskAppetiteService(
        inMemoryRiskAppetiteRepository(),
        inMemoryAuditRepository(),
        inMemoryRiskCategoryRepository([]),
      );

      await expect(
        service.setThreshold(
          actor,
          "Fraude interne",
          { threshold: 12, methodologyVersion: "v1", subCategoryId: randomUUID() },
          "REQ-12",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("throws (does not silently skip validation) when subCategoryId is supplied but RiskCategoryRepository is not configured", async () => {
      const service = new RiskAppetiteService(inMemoryRiskAppetiteRepository(), inMemoryAuditRepository());

      await expect(
        service.setThreshold(
          actor,
          "Fraude interne",
          { threshold: 12, methodologyVersion: "v1", subCategoryId: randomUUID() },
          "REQ-13",
        ),
      ).rejects.toThrow(ValidationError);
    });

    it("rejects a subCategoryId belonging to another tenant", async () => {
      const otherTenantCategory = stubRiskCategory({ tenantId: "tenant-2" });
      const service = new RiskAppetiteService(
        inMemoryRiskAppetiteRepository(),
        inMemoryAuditRepository(),
        inMemoryRiskCategoryRepository([otherTenantCategory]),
      );

      await expect(
        service.setThreshold(
          actor,
          "Fraude interne",
          { threshold: 12, methodologyVersion: "v1", subCategoryId: otherTenantCategory.id },
          "REQ-14",
        ),
      ).rejects.toThrow(ValidationError);
    });
  });
});
