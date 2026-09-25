import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AnomalyService } from "../src/services/AnomalyService.js";
import type { AnomalyRepository } from "../src/domain/repositories/AnomalyRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Anomaly } from "../src/domain/entities/Anomaly.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryAnomalyRepository(): AnomalyRepository {
  const store = new Map<string, Anomaly>();
  return {
    async getById(tenantId, id) {
      const a = store.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (a) => a.tenantId === tenantId && (!options?.status || a.status === options.status),
      );
    },
    async create(input) {
      const anomaly: Anomaly = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlId: input.controlId ?? null,
        controlExecutionId: input.controlExecutionId ?? null,
        riskId: input.riskId ?? null,
        observedAt: new Date(),
        description: input.description,
        severity: input.severity,
        origin: input.origin ?? null,
        detectedBy: input.detectedBy,
        status: "NEW",
        associatedActions: null,
        closedAt: null,
        closureComment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(anomaly.id, anomaly);
      return anomaly;
    },
    async updateStatus(tenantId, id, newStatus, note) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const isClosing = newStatus === "CLOSED";
      const updated: Anomaly = {
        ...existing,
        status: newStatus,
        updatedAt: new Date(),
        closedAt: isClosing ? new Date() : existing.closedAt,
        closureComment: isClosing ? note : existing.closureComment,
        associatedActions:
          !isClosing && note ? `${existing.associatedActions ?? ""}\n[${newStatus}] ${note}` : existing.associatedActions,
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
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["anomaly.read", "anomaly.create", "anomaly.update"],
};

describe("AnomalyService", () => {
  it("creates an anomaly in NEW status, attributed to the actor", async () => {
    const service = new AnomalyService(inMemoryAnomalyRepository(), inMemoryAuditRepository());
    const anomaly = await service.create(actor, { description: "Segregation of duties breach", severity: "HIGH" }, "REQ-1");
    expect(anomaly.status).toBe("NEW");
    expect(anomaly.detectedBy).toBe("user-1");
  });

  it("rejects an empty description", async () => {
    const service = new AnomalyService(inMemoryAnomalyRepository(), inMemoryAuditRepository());
    await expect(service.create(actor, { description: "  ", severity: "LOW" }, "REQ-2")).rejects.toThrow(
      ValidationError,
    );
  });

  it("allows NEW -> UNDER_ANALYSIS -> CLOSED but rejects NEW -> CLOSED directly", async () => {
    const repo = inMemoryAnomalyRepository();
    const service = new AnomalyService(repo, inMemoryAuditRepository());
    const anomaly = await service.create(actor, { description: "D", severity: "LOW" }, "REQ-3");

    await expect(service.updateStatus(actor, anomaly.id, "CLOSED", "done", "REQ-4")).rejects.toThrow(
      ValidationError,
    );

    const analyzing = await service.updateStatus(actor, anomaly.id, "UNDER_ANALYSIS", null, "REQ-5");
    expect(analyzing.status).toBe("UNDER_ANALYSIS");

    const closed = await service.updateStatus(actor, anomaly.id, "CLOSED", "Remediated", "REQ-6");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closureComment).toBe("Remediated");
  });

  it("requires a comment to close an anomaly", async () => {
    const repo = inMemoryAnomalyRepository();
    const service = new AnomalyService(repo, inMemoryAuditRepository());
    const anomaly = await service.create(actor, { description: "D", severity: "LOW" }, "REQ-7");
    await service.updateStatus(actor, anomaly.id, "ACTION_IN_PROGRESS", null, "REQ-8");

    await expect(service.updateStatus(actor, anomaly.id, "CLOSED", null, "REQ-9")).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects any transition out of CLOSED", async () => {
    const repo = inMemoryAnomalyRepository();
    const service = new AnomalyService(repo, inMemoryAuditRepository());
    const anomaly = await service.create(actor, { description: "D", severity: "LOW" }, "REQ-10");
    await service.updateStatus(actor, anomaly.id, "ACTION_IN_PROGRESS", null, "REQ-10b");
    await service.updateStatus(actor, anomaly.id, "CLOSED", "Done", "REQ-11");

    await expect(
      service.updateStatus(actor, anomaly.id, "UNDER_ANALYSIS", null, "REQ-12"),
    ).rejects.toThrow(ValidationError);
  });
});
