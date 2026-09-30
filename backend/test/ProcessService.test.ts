import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ProcessService } from "../src/services/ProcessService.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ProcessEvaluationModeRequestRepository } from "../src/domain/repositories/ProcessEvaluationModeRequestRepository.js";
import { resolveInheritedEvaluationMode, type Process } from "../src/domain/entities/Process.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { ProcessEvaluationModeRequest } from "../src/domain/entities/ProcessEvaluationModeRequest.js";
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

function inMemoryRiskRepository(risks: Risk[]): RiskRepository {
  return {
    async getById(tenantId, id) {
      return risks.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
    },
    async listByIds(tenantId, ids) {
      return risks.filter((r) => r.tenantId === tenantId && ids.includes(r.id));
    },
    async list(tenantId, options) {
      return risks.filter((r) => r.tenantId === tenantId && (options?.includeArchived || r.status !== "ARCHIVED"));
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async assignOwner() {
      throw new Error("not implemented");
    },
    async assignSuperiorOwner() {
      throw new Error("not implemented");
    },
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryControlRepository(controls: Control[]): ControlRepository {
  return {
    async getById(tenantId, id) {
      return controls.find((c) => c.tenantId === tenantId && c.id === id) ?? null;
    },
    async list(tenantId, options) {
      return controls.filter(
        (c) => c.tenantId === tenantId && (options?.includeArchived || c.status !== "ARCHIVED"),
      );
    },
    async listCoveringRisk() {
      throw new Error("not implemented");
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryProcessEvaluationModeRequestRepository(
  requests: ProcessEvaluationModeRequest[],
): ProcessEvaluationModeRequestRepository {
  return {
    async getById(tenantId, id) {
      return requests.find((r) => r.tenantId === tenantId && r.id === id) ?? null;
    },
    async list(tenantId, options) {
      return requests.filter(
        (r) =>
          r.tenantId === tenantId &&
          (options?.processId === undefined || r.processId === options.processId) &&
          (options?.status === undefined || r.status === options.status),
      );
    },
    async create() {
      throw new Error("not implemented");
    },
    async validate() {
      throw new Error("not implemented");
    },
    async reject() {
      throw new Error("not implemented");
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

  describe("archive (referential guard, architect audit 2026-09-30)", () => {
    function buildRisk(overrides: Partial<Risk> = {}): Risk {
      return {
        id: randomUUID(),
        tenantId: actor.tenantId,
        process: "Paiements",
        processId: null,
        description: "Risque test",
        ownerDepartmentId: null,
        ownerId: null,
        superiorOwnerId: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        ...overrides,
      };
    }

    function buildControl(overrides: Partial<Control> = {}): Control {
      return {
        id: randomUUID(),
        tenantId: actor.tenantId,
        label: "Contrôle test",
        objective: null,
        coveredRiskIds: [],
        process: "Paiements",
        processId: null,
        departmentId: null,
        procedureDescription: null,
        controlType: "PREVENTIVE",
        nature: null,
        defenseLine: null,
        frequency: "Mensuelle",
        executor: "Analyste",
        validator: null,
        expectedEvidence: null,
        complianceCriteria: "Critère",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        ...overrides,
      };
    }

    function buildRequest(overrides: Partial<ProcessEvaluationModeRequest> = {}): ProcessEvaluationModeRequest {
      return {
        id: randomUUID(),
        tenantId: actor.tenantId,
        processId: "process-x",
        requestedMode: "PARTICIPATIF",
        status: "PENDING_VALIDATION",
        requestedBy: actor.userId,
        requestedAt: new Date(),
        validatedBy: null,
        validatedAt: null,
        rejectionReason: null,
        ...overrides,
      };
    }

    it("refuses to archive a process still referenced by an active risk's processId", async () => {
      const repo = inMemoryProcessRepository();
      const process = await new ProcessService(repo, inMemoryAuditRepository()).create(
        actor,
        { level: "PROCESS", name: "P1" },
        "REQ-27",
      );
      const referencingRisk = buildRisk({ processId: process.id });
      const service = new ProcessService(
        repo,
        inMemoryAuditRepository(),
        inMemoryRiskRepository([referencingRisk]),
      );

      await expect(service.archive(actor, process.id, "obsolète", "REQ-28")).rejects.toThrow(ValidationError);

      const stillThere = await repo.getById(actor.tenantId, process.id);
      expect(stillThere).not.toBeNull();
    });

    it("refuses to archive a process still referenced by an active control's processId", async () => {
      const repo = inMemoryProcessRepository();
      const process = await new ProcessService(repo, inMemoryAuditRepository()).create(
        actor,
        { level: "PROCESS", name: "P1" },
        "REQ-29",
      );
      const referencingControl = buildControl({ processId: process.id });
      const service = new ProcessService(
        repo,
        inMemoryAuditRepository(),
        inMemoryRiskRepository([]),
        inMemoryControlRepository([referencingControl]),
      );

      await expect(service.archive(actor, process.id, "obsolète", "REQ-30")).rejects.toThrow(ValidationError);
    });

    it("refuses to archive a process with a pending evaluation-mode request", async () => {
      const repo = inMemoryProcessRepository();
      const process = await new ProcessService(repo, inMemoryAuditRepository()).create(
        actor,
        { level: "PROCESS", name: "P1" },
        "REQ-31",
      );
      const pending = buildRequest({ processId: process.id, status: "PENDING_VALIDATION" });
      const service = new ProcessService(
        repo,
        inMemoryAuditRepository(),
        inMemoryRiskRepository([]),
        inMemoryControlRepository([]),
        inMemoryProcessEvaluationModeRequestRepository([pending]),
      );

      await expect(service.archive(actor, process.id, "obsolète", "REQ-32")).rejects.toThrow(ValidationError);
    });

    it("allows archiving once no active risk/control/pending request references the process", async () => {
      const repo = inMemoryProcessRepository();
      const process = await new ProcessService(repo, inMemoryAuditRepository()).create(
        actor,
        { level: "PROCESS", name: "P1" },
        "REQ-33",
      );
      // An ARCHIVED risk still carries processId, but list() excludes it by default — must not block the archive.
      const archivedRisk = buildRisk({ processId: process.id, status: "ARCHIVED" });
      const validatedRequest = buildRequest({ processId: process.id, status: "VALIDATED" });
      const service = new ProcessService(
        repo,
        inMemoryAuditRepository(),
        inMemoryRiskRepository([archivedRisk]),
        inMemoryControlRepository([]),
        inMemoryProcessEvaluationModeRequestRepository([validatedRequest]),
      );

      await service.archive(actor, process.id, "obsolète", "REQ-34");

      const gone = await repo.getById(actor.tenantId, process.id);
      expect(gone).toBeNull();
    });

    it("still allows archiving when risks/controls/requests repositories are not wired (degrade, matches SEC-012's accepted structural risk)", async () => {
      const repo = inMemoryProcessRepository();
      const process = await new ProcessService(repo, inMemoryAuditRepository()).create(
        actor,
        { level: "PROCESS", name: "P1" },
        "REQ-35",
      );
      const service = new ProcessService(repo, inMemoryAuditRepository());

      await service.archive(actor, process.id, "obsolète", "REQ-36");

      const gone = await repo.getById(actor.tenantId, process.id);
      expect(gone).toBeNull();
    });
  });
});
