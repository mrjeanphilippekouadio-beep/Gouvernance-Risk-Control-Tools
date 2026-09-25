import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskService } from "../src/services/RiskService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRiskRepository(): RiskRepository {
  const store = new Map<string, Risk>();
  return {
    async getById(tenantId, id) {
      const risk = store.get(id);
      return risk && risk.tenantId === tenantId && !risk.deletedAt ? risk : null;
    },
    async list(tenantId) {
      return [...store.values()].filter((r) => r.tenantId === tenantId && !r.deletedAt);
    },
    async create(input) {
      const risk: Risk = {
        id: randomUUID(),
        tenantId: input.tenantId,
        process: input.process,
        description: input.description,
        ownerDepartmentId: input.ownerDepartmentId ?? null,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(risk.id, risk);
      return risk;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
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

function inMemoryAuditRepository(): AuditRepository & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
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
  roles: ["risk.create", "risk.update"],
};

describe("RiskService", () => {
  it("creates a risk in DRAFT status and records an audit event", async () => {
    const audit = inMemoryAuditRepository();
    const service = new RiskService(inMemoryRiskRepository(), audit);

    const risk = await service.create(actor, { process: "Onboarding", description: "KYC risk" }, "REQ-1");

    expect(risk.status).toBe("DRAFT");
    expect(risk.tenantId).toBe("tenant-1");
    expect(audit.events).toHaveLength(1);
  });

  it("rejects an empty description", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
    await expect(
      service.create(actor, { process: "Onboarding", description: "  " }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("allows DRAFT -> ACTIVE but rejects ACTIVE -> DRAFT", async () => {
    const repo = inMemoryRiskRepository();
    const service = new RiskService(repo, inMemoryAuditRepository());
    const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-3");

    const active = await service.update(actor, risk.id, { status: "ACTIVE" }, "REQ-4");
    expect(active.status).toBe("ACTIVE");

    await expect(service.update(actor, risk.id, { status: "DRAFT" }, "REQ-5")).rejects.toThrow(
      ValidationError,
    );
  });

  it("requires a reason to archive", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
    const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-6");
    await expect(service.archive(actor, risk.id, "", "REQ-7")).rejects.toThrow(ValidationError);
  });
});
