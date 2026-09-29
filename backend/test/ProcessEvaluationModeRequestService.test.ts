import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ProcessEvaluationModeRequestService } from "../src/services/ProcessEvaluationModeRequestService.js";
import type { ProcessEvaluationModeRequestRepository } from "../src/domain/repositories/ProcessEvaluationModeRequestRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { ProcessEvaluationModeRequest } from "../src/domain/entities/ProcessEvaluationModeRequest.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

function inMemoryProcessRepository(seed: Process[] = []): ProcessRepository {
  const store = new Map<string, Process>(seed.map((p) => [p.id, p]));
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

function inMemoryRiskRepository(seed: Risk[] = []): RiskRepository {
  const store = new Map<string, Risk>(seed.map((r) => [r.id, r]));
  return {
    async getById(tenantId, id) {
      const r = store.get(id);
      return r && r.tenantId === tenantId ? r : null;
    },
    async listByIds(tenantId, ids) {
      return [...store.values()].filter((r) => r.tenantId === tenantId && ids.includes(r.id));
    },
    async list(tenantId) {
      return [...store.values()].filter((r) => r.tenantId === tenantId);
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

function inMemoryRequestRepository(): ProcessEvaluationModeRequestRepository {
  const store = new Map<string, ProcessEvaluationModeRequest>();
  return {
    async getById(tenantId, id) {
      const r = store.get(id);
      return r && r.tenantId === tenantId ? r : null;
    },
    async list(tenantId, options) {
      return [...store.values()]
        .filter((r) => r.tenantId === tenantId)
        .filter((r) => !options?.processId || r.processId === options.processId)
        .filter((r) => !options?.status || r.status === options.status)
        .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
    },
    async create(input) {
      const existingPending = [...store.values()].some(
        (r) => r.tenantId === input.tenantId && r.processId === input.processId && r.status === "PENDING_VALIDATION",
      );
      if (existingPending) {
        throw new ValidationError(
          `A pending evaluation-mode request already exists for process ${input.processId} — it must be validated or rejected first`,
        );
      }
      const request: ProcessEvaluationModeRequest = {
        id: randomUUID(),
        tenantId: input.tenantId,
        processId: input.processId,
        requestedMode: input.requestedMode,
        status: "PENDING_VALIDATION",
        requestedBy: input.requestedBy,
        requestedAt: new Date(),
        validatedBy: null,
        validatedAt: null,
        rejectionReason: null,
      };
      store.set(request.id, request);
      return request;
    },
    async validate(tenantId, id, validatedBy) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.status !== "PENDING_VALIDATION") {
        throw new NotFoundError("ProcessEvaluationModeRequest", id);
      }
      const updated: ProcessEvaluationModeRequest = {
        ...existing,
        status: "VALIDATED",
        validatedBy,
        validatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async reject(tenantId, id, validatedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.status !== "PENDING_VALIDATION") {
        throw new NotFoundError("ProcessEvaluationModeRequest", id);
      }
      const updated: ProcessEvaluationModeRequest = {
        ...existing,
        status: "REJECTED",
        validatedBy,
        validatedAt: new Date(),
        rejectionReason: reason,
      };
      store.set(id, updated);
      return updated;
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
    async listRecent() {
      return [];
    },
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TENANT = "tenant-1";

const proposerActor: AuthenticatedUser = {
  userId: "user-proposer",
  tenantId: TENANT,
  email: "proposer@djamo.example",
  displayName: "Process Owner",
  roles: ["process.read", "process.evaluationmode.propose"],
};

const validatorActor: AuthenticatedUser = {
  ...proposerActor,
  userId: "user-validator",
  roles: ["process.read", "evaluationmode.validate"],
};

const riskManagerActor: AuthenticatedUser = {
  ...proposerActor,
  userId: "user-riskmanager",
  roles: ["process.read", "process.evaluationmode.propose", "evaluationmode.validate", "process.evaluationmode.set"],
};

const readOnlyActor: AuthenticatedUser = { ...proposerActor, userId: "user-readonly", roles: ["process.read"] };

function makeProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    parentId: null,
    level: "PROCESS",
    name: "Crédit",
    description: null,
    documentType: null,
    documentReference: null,
    owner: null,
    active: true,
    evaluationMode: "CLASSIQUE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function makeRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    process: "Crédit",
    processId: null,
    description: "Risque de fraude",
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

function newService(options?: { processes?: Process[]; risks?: Risk[] }) {
  const requests = inMemoryRequestRepository();
  const processes = inMemoryProcessRepository(options?.processes ?? []);
  const risks = inMemoryRiskRepository(options?.risks ?? []);
  const audit = inMemoryAuditRepository();
  const service = new ProcessEvaluationModeRequestService(requests, processes, risks, audit);
  return { service, requests, processes, risks, audit };
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("ProcessEvaluationModeRequestService", () => {
  describe("propose", () => {
    it("requires process.evaluationmode.propose", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      await expect(service.propose(readOnlyActor, process.id, "PARTICIPATIF", "REQ-1")).rejects.toThrow(ForbiddenError);
    });

    it("creates a PENDING_VALIDATION request without touching Process.evaluationMode", async () => {
      const process = makeProcess({ evaluationMode: "CLASSIQUE" });
      const { service, processes } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");

      expect(request.status).toBe("PENDING_VALIDATION");
      expect(request.requestedMode).toBe("PARTICIPATIF");
      expect(request.requestedBy).toBe(proposerActor.userId);

      const unchanged = await processes.getById(TENANT, process.id);
      expect(unchanged?.evaluationMode).toBe("CLASSIQUE");
    });

    it("rejects a second pending proposal for the same process (partial unique index)", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.propose(proposerActor, process.id, "CLASSIQUE", "REQ-2")).rejects.toThrow(ValidationError);
    });

    it("rejects a proposal for a SUBPROCESS/ACTIVITY (DECISION-006: PROCESS level only)", async () => {
      const subprocess = makeProcess({ level: "SUBPROCESS" });
      const { service } = newService({ processes: [subprocess] });
      await expect(service.propose(proposerActor, subprocess.id, "PARTICIPATIF", "REQ-1")).rejects.toThrow(ValidationError);
    });

    it("404s for an unknown process", async () => {
      const { service } = newService();
      await expect(service.propose(proposerActor, randomUUID(), "PARTICIPATIF", "REQ-1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("validate", () => {
    it("requires evaluationmode.validate", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.validate(readOnlyActor, request.id, "REQ-2")).rejects.toThrow(ForbiddenError);
    });

    it("applies the requested mode onto Process.evaluationMode and marks the request VALIDATED", async () => {
      const process = makeProcess({ evaluationMode: "CLASSIQUE" });
      const { service, processes, requests } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");

      const updatedProcess = await service.validate(validatorActor, request.id, "REQ-2");
      expect(updatedProcess.evaluationMode).toBe("PARTICIPATIF");

      const storedProcess = await processes.getById(TENANT, process.id);
      expect(storedProcess?.evaluationMode).toBe("PARTICIPATIF");

      const storedRequest = await requests.getById(TENANT, request.id);
      expect(storedRequest?.status).toBe("VALIDATED");
      expect(storedRequest?.validatedBy).toBe(validatorActor.userId);
    });

    it("blocks the proposer from validating their own request (maker-checker), even a Risk Manager", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(riskManagerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.validate(riskManagerActor, request.id, "REQ-2")).rejects.toThrow(ForbiddenError);
    });

    it("rejects validating an already-decided request", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await service.validate(validatorActor, request.id, "REQ-2");
      await expect(service.validate(validatorActor, request.id, "REQ-3")).rejects.toThrow(ValidationError);
    });

    it("surfaces risk owners of the process on get(), never as an authorization input", async () => {
      const process = makeProcess();
      const owner1 = "risk-owner-1";
      const risk = makeRisk({ processId: process.id, ownerId: owner1 });
      const unrelatedRisk = makeRisk({ processId: randomUUID(), ownerId: "risk-owner-2" });
      const { service } = newService({ processes: [process], risks: [risk, unrelatedRisk] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");

      const withOwners = await service.get(validatorActor, request.id);
      expect(withOwners.riskOwners).toEqual([{ riskId: risk.id, ownerId: owner1 }]);

      // A risk owner with no evaluationmode.validate permission still cannot validate —
      // ownership is visible/audited, never authoritative (DECISION-006).
      const riskOwnerActor: AuthenticatedUser = { ...proposerActor, userId: owner1, roles: ["process.read"] };
      await expect(service.validate(riskOwnerActor, request.id, "REQ-2")).rejects.toThrow(ForbiddenError);
    });

    it("audits the validation with the process's risk owners attached", async () => {
      const process = makeProcess();
      const owner1 = "risk-owner-1";
      const risk = makeRisk({ processId: process.id, ownerId: owner1 });
      const { service, audit } = newService({ processes: [process], risks: [risk] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await service.validate(validatorActor, request.id, "REQ-2");

      const validateEvent = audit.events.find(
        (e): e is { action: string; entityType: string; newValue: { riskOwners?: unknown } } =>
          typeof e === "object" && e !== null && (e as { action?: string }).action === "VALIDATE",
      );
      expect(validateEvent).toBeDefined();
      expect(validateEvent?.newValue?.riskOwners).toEqual([{ riskId: risk.id, ownerId: owner1 }]);
    });
  });

  describe("reject", () => {
    it("requires evaluationmode.validate", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.reject(readOnlyActor, request.id, "motif", "REQ-2")).rejects.toThrow(ForbiddenError);
    });

    it("requires a non-empty reason", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.reject(validatorActor, request.id, "  ", "REQ-2")).rejects.toThrow(ValidationError);
    });

    it("marks the request REJECTED without touching Process.evaluationMode", async () => {
      const process = makeProcess({ evaluationMode: "CLASSIQUE" });
      const { service, processes, requests } = newService({ processes: [process] });
      const request = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      const rejected = await service.reject(validatorActor, request.id, "Pas justifié", "REQ-2");

      expect(rejected.status).toBe("REJECTED");
      expect(rejected.rejectionReason).toBe("Pas justifié");

      const storedProcess = await processes.getById(TENANT, process.id);
      expect(storedProcess?.evaluationMode).toBe("CLASSIQUE");

      const storedRequest = await requests.getById(TENANT, request.id);
      expect(storedRequest?.status).toBe("REJECTED");
    });

    it("blocks the proposer from rejecting their own request", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const request = await service.propose(riskManagerActor, process.id, "PARTICIPATIF", "REQ-1");
      await expect(service.reject(riskManagerActor, request.id, "motif", "REQ-2")).rejects.toThrow(ForbiddenError);
    });

    it("allows a fresh proposal after a rejection (the pending slot is freed)", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      const first = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-1");
      await service.reject(validatorActor, first.id, "motif", "REQ-2");

      const second = await service.propose(proposerActor, process.id, "PARTICIPATIF", "REQ-3");
      expect(second.status).toBe("PENDING_VALIDATION");
    });
  });

  describe("setMode", () => {
    it("requires process.evaluationmode.set", async () => {
      const process = makeProcess();
      const { service } = newService({ processes: [process] });
      await expect(service.setMode(validatorActor, process.id, "PARTICIPATIF", "REQ-1")).rejects.toThrow(ForbiddenError);
    });

    it("applies the mode directly, bypassing the requests table entirely", async () => {
      const process = makeProcess({ evaluationMode: "CLASSIQUE" });
      const { service, processes, requests } = newService({ processes: [process] });
      const updated = await service.setMode(riskManagerActor, process.id, "PARTICIPATIF", "REQ-1");

      expect(updated.evaluationMode).toBe("PARTICIPATIF");
      const stored = await processes.getById(TENANT, process.id);
      expect(stored?.evaluationMode).toBe("PARTICIPATIF");
      expect(await requests.list(TENANT)).toHaveLength(0);
    });

    it("rejects setting the mode on a SUBPROCESS/ACTIVITY (DECISION-006: PROCESS level only)", async () => {
      const subprocess = makeProcess({ level: "ACTIVITY", parentId: randomUUID() });
      const { service } = newService({ processes: [subprocess] });
      await expect(service.setMode(riskManagerActor, subprocess.id, "PARTICIPATIF", "REQ-1")).rejects.toThrow(ValidationError);
    });
  });
});
