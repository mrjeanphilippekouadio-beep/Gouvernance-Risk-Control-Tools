import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ModuleToggleService } from "../src/services/ModuleToggleService.js";
import type { ModuleToggleRepository } from "../src/domain/repositories/ModuleToggleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ModuleToggle } from "../src/domain/entities/ModuleToggle.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryModuleToggleRepository(): ModuleToggleRepository {
  const byKey = new Map<string, ModuleToggle>();
  const key = (tenantId: string, moduleName: string) => `${tenantId}::${moduleName}`;
  return {
    async list(tenantId) {
      return [...byKey.values()].filter((t) => t.tenantId === tenantId);
    },
    async getByName(tenantId, moduleName) {
      return byKey.get(key(tenantId, moduleName)) ?? null;
    },
    async upsert(tenantId, moduleName, enabled, updatedBy) {
      const toggle: ModuleToggle = {
        id: byKey.get(key(tenantId, moduleName))?.id ?? randomUUID(),
        tenantId,
        moduleName,
        enabled,
        updatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byKey.set(key(tenantId, moduleName), toggle);
      return toggle;
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

describe("ModuleToggleService", () => {
  it("lists every known module as enabled by default when nothing has been toggled yet", async () => {
    const service = new ModuleToggleService(inMemoryModuleToggleRepository(), inMemoryAuditRepository());
    const modules = await service.list(admin);
    expect(modules.every((m) => m.enabled)).toBe(true);
    expect(modules.map((m) => m.moduleName)).toContain("RISK");
  });

  it("rejects toggle for an actor without config.manage", async () => {
    const service = new ModuleToggleService(inMemoryModuleToggleRepository(), inMemoryAuditRepository());
    await expect(service.toggle(readOnlyActor, "RISK", false, "REQ-1")).rejects.toThrow(ForbiddenError);
  });

  it("rejects an unknown module name", async () => {
    const service = new ModuleToggleService(inMemoryModuleToggleRepository(), inMemoryAuditRepository());
    await expect(service.toggle(admin, "NOT_A_MODULE", false, "REQ-1")).rejects.toThrow(ValidationError);
  });

  it("disables a module and reflects it back in list()", async () => {
    const service = new ModuleToggleService(inMemoryModuleToggleRepository(), inMemoryAuditRepository());
    await service.toggle(admin, "KRI", false, "REQ-1");
    const modules = await service.list(admin);
    expect(modules.find((m) => m.moduleName === "KRI")?.enabled).toBe(false);
    expect(modules.find((m) => m.moduleName === "KPI")?.enabled).toBe(true);
  });
});
