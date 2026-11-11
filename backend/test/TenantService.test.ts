import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TenantService } from "../src/services/TenantService.js";
import type { TenantRepository } from "../src/domain/repositories/TenantRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Tenant } from "../src/domain/entities/Tenant.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

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

function recordingAuditRepository(): AuditRepository & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async record(event) {
      events.push({ ...event, id: randomUUID(), timestamp: new Date() });
    },
    async listForEntity(tenantId, entityType, entityId) {
      return events.filter((e) => e.tenantId === tenantId && e.entityType === entityType && e.entityId === entityId).reverse();
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
  roles: [],
  dashboardScopeMode: "GLOBAL",
  isSuperAdmin: true,
};
const otherSuperAdmin: AuthenticatedUser = { ...superAdmin, userId: "user-3", email: "other@example.com" };
// A tenant admin holding config.manage (and more) but not the platform status: refused everywhere (SEC-F8-01).
const tenantAdmin: AuthenticatedUser = { ...superAdmin, userId: "user-2", roles: ["config.manage", "role.assign", "role.update"], isSuperAdmin: false };

function setup() {
  const audit = recordingAuditRepository();
  return { service: new TenantService(inMemoryTenantRepository(), audit), audit };
}

describe("TenantService (q260/q261)", () => {
  it("refuses every method to a tenant admin holding config.manage, and to an actor without the flag", async () => {
    const { service } = setup();
    const t = await service.create(superAdmin, { name: "Client A" }, "REQ-0");
    for (const actor of [tenantAdmin, { ...superAdmin, isSuperAdmin: undefined }]) {
      await expect(service.list(actor)).rejects.toThrow(ForbiddenError);
      await expect(service.get(actor, t.id)).rejects.toThrow(ForbiddenError);
      await expect(service.create(actor, { name: "X" }, "REQ-1")).rejects.toThrow(ForbiddenError);
      await expect(service.update(actor, t.id, { name: "Y" }, "REQ-1")).rejects.toThrow(ForbiddenError);
      await expect(service.deactivate(actor, t.id, "motif", "REQ-1")).rejects.toThrow(ForbiddenError);
      await expect(service.reactivate(actor, t.id, "motif", "REQ-1")).rejects.toThrow(ForbiddenError);
    }
  });

  it("requires a name, bounded, and refuses a duplicate (case/space-insensitive)", async () => {
    const { service } = setup();
    await expect(service.create(superAdmin, { name: "   " }, "REQ-1")).rejects.toThrow(ValidationError);
    await expect(service.create(superAdmin, { name: "x".repeat(121) }, "REQ-1")).rejects.toThrow(ValidationError);
    await service.create(superAdmin, { name: "Djamo Sénégal" }, "REQ-1");
    await expect(service.create(superAdmin, { name: "  djamo   sénégal " }, "REQ-2")).rejects.toThrow(ConflictError);
  });

  it("creates distinct tenants and audits in the actor's tenant and in the new tenant", async () => {
    const { service, audit } = setup();
    const first = await service.create(superAdmin, { name: "Djamo CI" }, "REQ-1");
    const second = await service.create(superAdmin, { name: "Djamo SN" }, "REQ-2");
    expect(first.id).not.toBe(second.id);
    expect((await service.list(superAdmin)).map((t) => t.id).sort()).toEqual([first.id, second.id].sort());
    expect(audit.events.filter((e) => e.entityId === first.id).map((e) => e.tenantId).sort()).toEqual([first.id, "tenant-1"].sort());
  });

  it("update changes name/mode only: `active` is refused (SEC-F8-02) and a clash on rename is a 409", async () => {
    const { service } = setup();
    const a = await service.create(superAdmin, { name: "A" }, "REQ-1");
    await service.create(superAdmin, { name: "B" }, "REQ-2");
    await expect(service.update(superAdmin, a.id, { active: false } as never, "REQ-3")).rejects.toThrow(ValidationError);
    await expect(service.update(superAdmin, a.id, { name: "b" }, "REQ-3")).rejects.toThrow(ConflictError);
    expect((await service.update(superAdmin, a.id, { name: "A2" }, "REQ-4")).name).toBe("A2");
    await expect(service.update(superAdmin, "does-not-exist", { name: "Z" }, "REQ-5")).rejects.toThrow(NotFoundError);
  });

  it("deactivate: reason mandatory, not one's own client, audited STATUS_CHANGE with the reason in both tenants", async () => {
    const { service, audit } = setup();
    const a = await service.create(superAdmin, { name: "A" }, "REQ-1");
    await expect(service.deactivate(superAdmin, a.id, "  ", "REQ-2")).rejects.toThrow(ValidationError);
    await expect(service.deactivate(superAdmin, "tenant-1", "motif", "REQ-2")).rejects.toThrow(ValidationError);
    const after = await service.deactivate(superAdmin, a.id, "Fin de contrat", "REQ-3");
    expect(after.active).toBe(false);
    const changes = audit.events.filter((e) => e.action === "STATUS_CHANGE");
    expect(changes.map((e) => e.tenantId).sort()).toEqual([a.id, "tenant-1"].sort());
    expect(changes.every((e) => e.reason === "Fin de contrat" && e.userId === "user-1")).toBe(true);
    await expect(service.deactivate(superAdmin, a.id, "encore", "REQ-4")).rejects.toThrow(ConflictError);
  });

  it("reactivate: reason mandatory and a DIFFERENT super-administrator than the one who deactivated", async () => {
    const { service } = setup();
    const a = await service.create(superAdmin, { name: "A" }, "REQ-1");
    await service.deactivate(superAdmin, a.id, "Fin de contrat", "REQ-2");
    await expect(service.reactivate(superAdmin, a.id, "Erreur", "REQ-3")).rejects.toThrow(ValidationError);
    await expect(service.reactivate(otherSuperAdmin, a.id, "", "REQ-3")).rejects.toThrow(ValidationError);
    const back = await service.reactivate(otherSuperAdmin, a.id, "Contrat renouvelé", "REQ-4");
    expect(back.active).toBe(true);
    await expect(service.reactivate(otherSuperAdmin, a.id, "encore", "REQ-5")).rejects.toThrow(ConflictError);
  });
});
