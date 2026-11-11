import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ProcessService } from "../src/services/ProcessService.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
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
        departmentId: input.departmentId ?? null,
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

// B-8 bis: departmentId is mandatory on creation, so the generic tests wire a permissive repository.
const anyDepartment = {
  async getById(_tenantId: string, id: string) {
    return { id } as never;
  },
} as unknown as DepartmentRepository;

describe("ProcessService department link (B-8)", () => {
  it("refuses to create a process without departmentId (B-8 bis, q46)", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    await expect(service.create(actor, { level: "PROCESS", name: "P1" }, "REQ-0")).rejects.toThrow("departmentId is required");
  });

  const departments = {
    async getById(_tenantId: string, id: string) {
      return id === "dept-1" ? ({ id } as never) : null;
    },
  } as unknown as DepartmentRepository;

  it("attaches a process to an existing department", async () => {
    const service = new ProcessService(
      inMemoryProcessRepository(),
      inMemoryAuditRepository(),
      undefined,
      undefined,
      undefined,
      departments,
    );
    const process = await service.create(actor, { level: "PROCESS", name: "P1", departmentId: "dept-1" }, "REQ-1");
    expect(process.departmentId).toBe("dept-1");
  });

  it("rejects an unknown department", async () => {
    const service = new ProcessService(
      inMemoryProcessRepository(),
      inMemoryAuditRepository(),
      undefined,
      undefined,
      undefined,
      departments,
    );
    await expect(
      service.create(actor, { level: "PROCESS", name: "P1", departmentId: "nope" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("fails closed when a departmentId is given without a DepartmentRepository", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository());
    await expect(
      service.create(actor, { level: "PROCESS", name: "P1", departmentId: "dept-1" }, "REQ-3"),
    ).rejects.toThrow("requires a DepartmentRepository");
  });
});

describe("ProcessService", () => {
  it("creates a root PROCESS with no parent", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    const process = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "Onboarding" }, "REQ-1");
    expect(process.parentId).toBeNull();
  });

  it("rejects a PROCESS-level item with a parent", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-2");
    await expect(
      service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P2", parentId: root.id }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a parent for SUBPROCESS/ACTIVITY", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    await expect(
      service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub" }, "REQ-4"),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts a SUBPROCESS whose parent is a PROCESS", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-5");
    const sub = await service.create(
      actor,
      { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub1", parentId: root.id },
      "REQ-6",
    );
    expect(sub.parentId).toBe(root.id);
  });

  it("rejects a SUBPROCESS whose parent is an ACTIVITY (wrong rank)", async () => {
    const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-7");
    const sub = await service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-8");
    const activity = await service.create(
      actor,
      { departmentId: "dept-1", level: "ACTIVITY", name: "Act1", parentId: sub.id },
      "REQ-9",
    );
    await expect(
      service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub2", parentId: activity.id }, "REQ-10"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a process being its own parent", async () => {
    const repo = inMemoryProcessRepository();
    const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
    const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-11");
    const sub = await service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-12");

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
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(
        actor,
        { departmentId: "dept-1", level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-14",
      );

      const mode = await service.resolveEvaluationMode(actor, root.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("inherits from the parent when the process itself is null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(
        actor,
        { departmentId: "dept-1", level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-15",
      );
      const sub = await service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-16");

      const mode = await service.resolveEvaluationMode(actor, sub.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("inherits from the grandparent (3-level chain) when both self and parent are null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(
        actor,
        { departmentId: "dept-1", level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
        "REQ-17",
      );
      const sub = await service.create(actor, { departmentId: "dept-1", level: "SUBPROCESS", name: "Sub1", parentId: root.id }, "REQ-18");
      const activity = await service.create(
        actor,
        { departmentId: "dept-1", level: "ACTIVITY", name: "Act1", parentId: sub.id },
        "REQ-19",
      );

      const mode = await service.resolveEvaluationMode(actor, activity.id, "CLASSIQUE");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("falls back to the tenant default when the whole chain is null", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-20");

      const mode = await service.resolveEvaluationMode(actor, root.id, "PARTICIPATIF");
      expect(mode).toBe("PARTICIPATIF");
    });

    it("throws for an unknown processId", async () => {
      const service = new ProcessService(inMemoryProcessRepository(), inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      await expect(service.resolveEvaluationMode(actor, randomUUID(), "CLASSIQUE")).rejects.toThrow();
    });
  });

  describe("setEvaluationMode (DECISION-006 governance finding, SEC-017)", () => {
    it("sets evaluationMode when the actor holds process.evaluationmode.set", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-21");

      const riskManager: AuthenticatedUser = {
        ...actor,
        roles: ["process.read", "process.evaluationmode.set"],
      };
      const updated = await service.setEvaluationMode(riskManager, root.id, "PARTICIPATIF", "REQ-22");

      expect(updated.evaluationMode).toBe("PARTICIPATIF");
    });

    it("rejects an actor holding only process.update (not process.evaluationmode.set)", async () => {
      const repo = inMemoryProcessRepository();
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(actor, { departmentId: "dept-1", level: "PROCESS", name: "P1" }, "REQ-23");

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
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);
      const root = await service.create(
        actor,
        { departmentId: "dept-1", level: "PROCESS", name: "P1", evaluationMode: "PARTICIPATIF" },
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
      const process = await new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment).create(
        actor,
        { level: "PROCESS", name: "P1", departmentId: "dept-1" },
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
      const process = await new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment).create(
        actor,
        { level: "PROCESS", name: "P1", departmentId: "dept-1" },
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
      const process = await new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment).create(
        actor,
        { level: "PROCESS", name: "P1", departmentId: "dept-1" },
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
      const process = await new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment).create(
        actor,
        { level: "PROCESS", name: "P1", departmentId: "dept-1" },
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
      const process = await new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment).create(
        actor,
        { level: "PROCESS", name: "P1", departmentId: "dept-1" },
        "REQ-35",
      );
      const service = new ProcessService(repo, inMemoryAuditRepository(), undefined, undefined, undefined, anyDepartment);

      await service.archive(actor, process.id, "obsolète", "REQ-36");

      const gone = await repo.getById(actor.tenantId, process.id);
      expect(gone).toBeNull();
    });
  });
});

// q257 (DECISION-121, QA-B6C-02): re-parenting a sub-process to another Dispositif stays free, with a motive, a journal and a notice.
describe("ProcessService move of a sub-process to another Dispositif (q257)", () => {
  type Notif = { recipientUserId: string; eventType: string };
  async function world() {
    const repo = inMemoryProcessRepository();
    const events: Array<Record<string, unknown>> = [];
    const audit = { async record(e: Record<string, unknown>) { events.push(e); }, async listForEntity() { return []; } } as unknown as AuditRepository;
    const created: Notif[] = [];
    const base = { tenantId: actor.tenantId, description: null, documentType: null, documentReference: null, owner: null, departmentId: null };
    const pDefault = await repo.create({ ...base, level: "PROCESS", name: "D", parentId: null });
    const pB = await repo.create({ ...base, level: "PROCESS", name: "B", parentId: null });
    const pB2 = await repo.create({ ...base, level: "PROCESS", name: "B2", parentId: null });
    const sub = await repo.create({ ...base, level: "SUBPROCESS", name: "S", parentId: pDefault.id });
    const frameworks = {
      async hasPendingAssignment() { return false; },
      async getDefaultFramework() { return { id: "fw-default" } as never; },
      async getProcessFrameworkId(_t: string, id: string) { return id === pB.id || id === pB2.id ? "fw-b" : null; },
    };
    const users = { async listActiveInSystemGroup() { return [{ id: "rm1", displayName: "RM" }]; } };
    const service = new ProcessService(repo, audit, undefined, undefined, undefined, anyDepartment, users as never, undefined, undefined, frameworks as never,
      { async create(n: Notif) { created.push(n); return n as never; } } as never);
    return { service, sub, pB, pB2, events, created };
  }

  it("a move that changes the Dispositif without a motive is refused (400), nothing written", async () => {
    const w = await world();
    await expect(w.service.update(actor, w.sub.id, { parentId: w.pB.id }, "r1")).rejects.toThrow(ValidationError);
    await expect(w.service.update(actor, w.sub.id, { parentId: w.pB.id }, "r1", "  ")).rejects.toThrow(ValidationError);
    expect(w.events).toHaveLength(0);
  });

  it("with a motive: moved, audit carries the old and the new Dispositif and the motive, the Risk Manager group is told", async () => {
    const w = await world();
    const out = await w.service.update(actor, w.sub.id, { parentId: w.pB.id }, "r1", "Rattacher à la méthode B");
    expect(out.parentId).toBe(w.pB.id);
    expect(w.events[0]).toMatchObject({ entityType: "Process", action: "UPDATE", reason: "Rattacher à la méthode B" });
    expect(w.events[0]!["oldValue"]).toMatchObject({ riskFrameworkId: "fw-default" });
    expect(w.events[0]!["newValue"]).toMatchObject({ riskFrameworkId: "fw-b", frameworkChanged: true });
    expect(w.created).toEqual([expect.objectContaining({ recipientUserId: "rm1", eventType: "OBJECT_FRAMEWORK_CHANGED" })]);
  });

  it("a move inside the same Dispositif is free: no motive needed, no notice, journal says unchanged", async () => {
    const w = await world();
    await w.service.update(actor, w.sub.id, { parentId: w.pB.id }, "r1", "motif");
    w.events.length = 0;
    w.created.length = 0;
    await w.service.update(actor, w.sub.id, { parentId: w.pB2.id }, "r2");
    expect(w.events[0]!["newValue"]).toMatchObject({ frameworkChanged: false });
    expect(w.events[0]!["reason"]).toBeNull();
    expect(w.created).toHaveLength(0);
  });

  it("an update that does not move the sub-process leaves the journal without Dispositif fields", async () => {
    const w = await world();
    await w.service.update(actor, w.sub.id, { name: "Renommé" }, "r1");
    expect(w.events[0]!["newValue"]).not.toHaveProperty("frameworkChanged");
  });
});
