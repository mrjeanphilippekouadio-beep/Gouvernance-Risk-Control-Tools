import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ProcessService } from "../src/services/ProcessService.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import { resolveInheritedEvaluationMode, type Process } from "../src/domain/entities/Process.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryProcessRepository(): ProcessRepository {
  const store = new Map<string, Process>();
  return {
    async getById(tenantId, id) {
      const p = store.get(id);
      return p && p.tenantId === tenantId && !p.deletedAt ? p : null;
    },
    async list(tenantId) {
      return [...store.values()].filter((p) => p.tenantId === tenantId && !p.deletedAt);
    },
    async create(input) {
      const process: Process = {
        id: randomUUID(),
        tenantId: input.tenantId,
        parentId: input.parentId ?? null,
        level: input.level,
        name: input.name,
        description: input.description ?? null,
        documentType: input.documentType ?? null,
        documentReference: input.documentReference ?? null,
        owner: input.owner ?? null,
        active: input.active ?? true,
        evaluationMode: input.evaluationMode ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(process.id, process);
      return process;
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
  roles: ["process.read", "process.create", "process.update", "process.delete"],
};

describe("ProcessService", () => {
  it("creates a root PROCESS with no parent", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    const process = await service.create(actor, { level: "PROCESS", name: "Onboarding" }, "REQ-1");
    expect(process.parentId).toBeNull();
  });

  it("rejects a PROCESS-level item with a parent", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-2");
    await expect(
      service.create(actor, { level: "PROCESS", name: "P2", parentId: root.id }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a parent for SUBPROCESS/ACTIVITY", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    await expect(
      service.create(actor, { level: "SUBPROCESS", name: "Sub" }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a SUBPROCESS whose parent is a PROCESS", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-5");
    const sub = await service.create(
      actor,
      { level: "SUBPROCESS", name: "Sub1", parentId: root.id },
      "REQ-6",
    );
    expect(sub.parentId).toBe(root.id);
  });

  it("rejects a SUBPROCESS whose parent is an ACTIVITY (wrong rank)", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-7");
    const sub = await service.create(actor, { level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-8");
    const activity = await service.create(
      actor,
      { level: "ACTIVITY", name: "Act1", parentId: sub.id },
      "REQ-9",
    );
    await expect(
      service.create(actor, { level: "SUBPROCESS", name: "Sub2", parentId: activity.id }, "REQ-10"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a process being its own parent", async () => {
    const repo = inMemoryProcessRepository();
    const service = new ProcessService(repo, inMemoryAuditRepository());
    const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-11");
    const sub = await service.create(actor, { level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-12");

    await expect(
      service.update(actor, sub.id, { parentId: sub.id }, "REQ-13"),
    ).rejects.toThrow(ValidationError);
  });

  describe("resolveInheritedEvaluationMode (pure, DIV-06)", () => {
    it("returns the tenant default when every level in the chain is null", () => {
      const mode = resolveInheritedEvaluationMode(
        [{ evaluationMode: null }, { evaluationMode: null }],
        "CLASSIQUE",
      );
      expect(mode).toBe("CLASSIQUE");
    });

    it("returns the closest non-null evaluationMode (self before ancestors)", () => {
      const mode = resolveInheritedEvaluationMode(
        [{ evaluationMode: "PARTICIPATIF" }, { evaluationMode: "CLASSIQUE" }],
        "CLASSIQUE",
      );
      expect(mode).toBe("PARTICIPATIF");
    });

    it("falls through a null self to a non-null ancestor", () => {
      const mode = resolveInheritedEvaluationMode(
        [{ evaluationMode: null }, { evaluationMode: "PARTICIPATIF" }],
        "CLASSIQUE",
      );
      expect(mode).toBe("PARTICIPATIF");
    });

    it("returns the tenant default for an empty chain", () => {
      expect(resolveInheritedEvaluationMode([], "PARTICIPATIF")).toBe("PARTICIPATIF");
    });
  });

  describe("resolveEvaluationMode (ProcessService, DIV-06)", () => {
    it("resolves to the process's own evaluationMode when set", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(
        actor,
        { level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-14",
      );

      const mode = await service.resolveEvaluationMode(actor, root.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("inherits from the parent when the process itself is null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(
        actor,
        { level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-15",
      );
      const sub = await service.create(actor, { level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-16");

      const mode = await service.resolveEvaluationMode(actor, sub.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("inherits from the grandparent (3-level chain) when both self and parent are null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(
        actor,
        { level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-17",
      );
      const sub = await service.create(actor, { level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-18");
      const activity = await service.create(
        actor,
        { level: "ACTIVITY", name: "Act1", parentId: sub.id },
        "REQ-19",
      );

      const mode = await service.resolveEvaluationMode(actor, activity.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("falls back to the tenant default when the whole chain is null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-20");

      const mode = await service.resolveEvaluationMode(actor, root.id, "PARTICIPATIF");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("throws for an unknown processId", async () => {
      const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
      await expect(service.resolveEvaluationMode(actor, randomUUID(), "CLASSIQUE")).rejects.toThrow();
    });
  });

  describe("setEvaluationMode (DECISION-006 governance finding, SEC-017)", () => {
    it("sets evaluationMode when the actor holds process.evaluationmode.set", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-21");

      const riskManager: AuthenticatedUser = {
        ...actor,
        roles: ["process.read", "process.evaluationmode.set"],
      };
      const updated = await service.setEvaluationMode(riskManager, root.id, "PARTICIPATIF", "REQ-22");

      expect(updated.evaluationMode).toBe("PARTICIPATIF");
    });

    it("rejects an actor holding only process.update (not process.evaluationmode.set)", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-23");

      const nonRiskManager: AuthenticatedUser = {
        ...actor,
        roles: ["process.read", "process.update"],
      };

      await expect(
        service.setEvaluationMode(nonRiskManager, root.id, "PARTICIPATIF", "REQ-24"),
      ).rejects.toThrow();

      const unchanged = await repo.getById(actor.tenantId, root.id);
      expect(unchanged?.evaluationMode).toBeNull();
    });

    it("allows resetting to null (inherit)", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository());
      const root = await service.create(
        actor,
        { level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-25",
      );

      const riskManager: AuthenticatedUser = {
        ...actor,
        roles: ["process.read", "process.evaluationmode.set"],
      };
      const updated = await service.setEvaluationMode(riskManager, root.id, null, "REQ-26");

      expect(updated.evaluationMode).toBeNull();
    });
  });
});
