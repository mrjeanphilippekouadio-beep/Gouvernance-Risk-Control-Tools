import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { moduleGuard } from "../src/api/middleware/moduleGuard.js";
import { ModuleToggleService } from "../src/services/ModuleToggleService.js";
import type { ModuleToggleRepository } from "../src/domain/repositories/ModuleToggleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import { MODULE_NAMES, type ModuleToggle } from "../src/domain/entities/ModuleToggle.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";

function inMemoryModuleToggleRepository(seed: ModuleToggle[] = []): ModuleToggleRepository {
  const byKey = new Map(seed.map((t) => [`${t.tenantId}::${t.moduleName}`, t]));
  return {
    async list(tenantId) {
      return [...byKey.values()].filter((t) => t.tenantId === tenantId);
    },
    async getByName(tenantId, moduleName) {
      return byKey.get(`${tenantId}::${moduleName}`) ?? null;
    },
    async upsert(tenantId, moduleName, enabled, updatedBy) {
      const toggle: ModuleToggle = {
        id: "t1",
        tenantId,
        moduleName,
        enabled,
        updatedBy,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      byKey.set(`${tenantId}::${moduleName}`, toggle);
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

describe("moduleGuard", () => {
  // Every MODULE_NAMES entry is wired to moduleGuard in server.ts (ACT-221)
  // — one test per module confirms each is actually enforced, not just RISK.
  it.each(MODULE_NAMES)("blocks the request with a ForbiddenError when %s is disabled for the tenant", async (moduleName) => {
    const repo = inMemoryModuleToggleRepository([
      {
        id: "t1",
        tenantId: "tenant-1",
        moduleName,
        enabled: false,
        updatedBy: "admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const service = new ModuleToggleService(repo, inMemoryAuditRepository());
    const guard = moduleGuard(service, moduleName);

    const req = { user: { tenantId: "tenant-1", userId: "u1", email: "a@b.c", displayName: "A", roles: [] } } as Request;
    let nextArg: unknown;
    await guard(req, {} as Response, (err?: unknown) => {
      nextArg = err;
    });

    expect(nextArg).toBeInstanceOf(ForbiddenError);
  });

  it.each(MODULE_NAMES)("lets the request through when %s is enabled (or never toggled)", async (moduleName) => {
    const service = new ModuleToggleService(inMemoryModuleToggleRepository(), inMemoryAuditRepository());
    const guard = moduleGuard(service, moduleName);

    const req = { user: { tenantId: "tenant-1", userId: "u1", email: "a@b.c", displayName: "A", roles: [] } } as Request;
    let called = false;
    let nextArg: unknown;
    await guard(req, {} as Response, (err?: unknown) => {
      called = true;
      nextArg = err;
    });

    expect(called).toBe(true);
    expect(nextArg).toBeUndefined();
  });
});
