import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskService } from "../src/services/RiskService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { RiskEscalationRepository } from "../src/domain/repositories/RiskEscalationRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RiskEscalation } from "../src/domain/entities/RiskEscalation.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../src/infrastructure/notifications/Notifier.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRiskRepository(): RiskRepository {
  const store = new Map<string, Risk>();
  return {
    async getById(tenantId, id) {
      const risk = store.get(id);
      return risk && risk.tenantId === tenantId && !risk.deletedAt ? risk : null;
    },
    async listByIds(tenantId, ids) {
      return ids
        .map((id) => store.get(id))
        .filter((r): r is Risk => !!r && r.tenantId === tenantId && !r.deletedAt);
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (r) =>
          r.tenantId === tenantId &&
          !r.deletedAt &&
          (options?.ownerId === undefined || r.ownerId === options.ownerId),
      );
    },
    async create(input) {
      const risk: Risk = {
        id: randomUUID(),
        tenantId: input.tenantId,
        process: input.process,
        processId: input.processId ?? null,
        description: input.description,
        ownerDepartmentId: input.ownerDepartmentId ?? null,
        ownerId: null,
        superiorOwnerId: null,
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
    async createIdempotent(input, idempotencyKey) {
      const existing = [...store.values()].find(
        (r) => r.tenantId === input.tenantId && (r as Risk & { idempotencyKey?: string }).idempotencyKey === idempotencyKey,
      );
      if (existing) return { risk: existing, created: false };
      const risk: Risk = {
        id: randomUUID(),
        tenantId: input.tenantId,
        process: input.process,
        processId: input.processId ?? null,
        description: input.description,
        ownerDepartmentId: input.ownerDepartmentId ?? null,
        ownerId: null,
        superiorOwnerId: null,
        status: "DRAFT",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(risk.id, risk);
      return { risk, created: true };
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async assignOwner(tenantId, id, ownerId) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ownerId, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async assignSuperiorOwner(tenantId, id, superiorOwnerId) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, superiorOwnerId, updatedAt: new Date() };
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

function inMemoryUserRepository(users: User[]): UserRepository {
  return {
    async getById(tenantId, id) {
      const u = users.find((x) => x.tenantId === tenantId && x.id === id);
      return u ?? null;
    },
    async getByEmail(tenantId, email) {
      const u = users.find((x) => x.tenantId === tenantId && x.email === email);
      return u ?? null;
    },
    async list(tenantId) {
      return users.filter((u) => u.tenantId === tenantId && !u.deletedAt);
    },
    async count(tenantId) {
      return users.filter((u) => u.tenantId === tenantId && !u.deletedAt).length;
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async suspend() {
      throw new Error("not implemented");
    },
    async reactivate() {
      throw new Error("not implemented");
    },
  };
}

function activeUser(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    email: "owner@example.com",
    displayName: "Owner",
    roles: [],
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function inMemoryRiskEscalationRepository(): RiskEscalationRepository & { events: RiskEscalation[] } {
  const events: RiskEscalation[] = [];
  return {
    events,
    async create(input) {
      const escalation: RiskEscalation = { id: randomUUID(), createdAt: new Date(), ...input };
      events.push(escalation);
      return escalation;
    },
    async listForRisk(tenantId, riskId) {
      return events.filter((e) => e.tenantId === tenantId && e.riskId === riskId);
    },
  };
}

function inMemoryProcessRepository(processes: Process[]): ProcessRepository {
  return {
    async getById(tenantId, id) {
      const p = processes.find((x) => x.tenantId === tenantId && x.id === id && !x.deletedAt);
      return p ?? null;
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
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function stubProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    parentId: null,
    level: "PROCESS",
    name: "Onboarding",
    description: null,
    documentType: null,
    documentReference: null,
    owner: null,
    active: true,
    evaluationMode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function spyNotifier(): Notifier & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    async notify(message: string) {
      messages.push(message);
    },
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["risk.read", "risk.create", "risk.update", "risk.delete"],
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

  it("rejects an empty description", async () => {  it("reuses the original risk and audit event for the same idempotency key", async () => {
    const repo = inMemoryRiskRepository();
    const audit = inMemoryAuditRepository();
    const service = new RiskService(repo, audit);

    const first = await service.create(
      actor,
      { process: "Onboarding", description: "KYC risk" },
      "REQ-IDEM-1",
      "idem-risk-1",
    );
    const retry = await service.create(
      actor,
      { process: "Onboarding", description: "KYC risk" },
      "REQ-IDEM-2",
      "idem-risk-1",
    );

    expect(retry.id).toBe(first.id);
    expect(audit.events).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());

    await service.create(actor, { process: "Onboarding", description: "KYC risk" }, "REQ-IDEM-3", "idem-risk-2");

    await expect(
      service.create(actor, { process: "Payments", description: "Fraud risk" }, "REQ-IDEM-4", "idem-risk-2"),
    ).rejects.toThrow(ValidationError);
  });


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

  it("rejects setting status to ARCHIVED via update (must use archive endpoint)", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
    const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-11");
    await expect(service.update(actor, risk.id, { status: "ARCHIVED" }, "REQ-12")).rejects.toThrow(
      ValidationError,
    );
  });

  it("requires a reason to archive", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
    const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-6");
    await expect(service.archive(actor, risk.id, "", "REQ-7")).rejects.toThrow(ValidationError);
  });

  it("rejects an actor without risk.create permission", async () => {
    const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
    const readOnlyActor = { ...actor, roles: ["risk.read"] };
    await expect(
      service.create(readOnlyActor, { process: "P", description: "D" }, "REQ-8"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an actor without risk.delete permission trying to archive", async () => {
    const repo = inMemoryRiskRepository();
    const service = new RiskService(repo, inMemoryAuditRepository());
    const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-9");

    const noDeleteActor = { ...actor, roles: ["risk.read", "risk.create", "risk.update"] };
    await expect(service.archive(noDeleteActor, risk.id, "reason", "REQ-10")).rejects.toThrow(
      ForbiddenError,
    );
  });

  describe("assignOwner (ACT-120/121)", () => {
    it("assigns an active user as owner and records an audit event", async () => {
      const repo = inMemoryRiskRepository();
      const audit = inMemoryAuditRepository();
      const owner = activeUser();
      const service = new RiskService(repo, audit, undefined, inMemoryUserRepository([owner]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-20");

      const updated = await service.assignOwner(actor, risk.id, owner.id, "REQ-21");

      expect(updated.ownerId).toBe(owner.id);
      expect(audit.events).toHaveLength(2); // CREATE + ASSIGN
    });

    it("rejects an ownerId that does not resolve to a user in the tenant", async () => {
      const repo = inMemoryRiskRepository();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-22");

      await expect(service.assignOwner(actor, risk.id, randomUUID(), "REQ-23")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects an ownerId belonging to a suspended (deleted) user", async () => {
      const repo = inMemoryRiskRepository();
      const suspended = activeUser({ deletedAt: new Date() });
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([suspended]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-24");

      await expect(service.assignOwner(actor, risk.id, suspended.id, "REQ-25")).rejects.toThrow(
        ValidationError,
      );
    });

    it("reassigning an owner notifies via the injected Notifier", async () => {
      const repo = inMemoryRiskRepository();
      const ownerA = activeUser({ email: "a@example.com" });
      const ownerB = activeUser({ email: "b@example.com" });
      const notifier = spyNotifier();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        inMemoryUserRepository([ownerA, ownerB]),
        notifier,
      );
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-26");

      await service.assignOwner(actor, risk.id, ownerA.id, "REQ-27");
      expect(notifier.messages).toHaveLength(1);

      await service.assignOwner(actor, risk.id, ownerB.id, "REQ-28");
      expect(notifier.messages).toHaveLength(2);
      expect(notifier.messages[1]).toContain(ownerA.id);
      expect(notifier.messages[1]).toContain(ownerB.id);
    });

    it("still assigns an owner without a notifier configured (optional dependency)", async () => {
      const repo = inMemoryRiskRepository();
      const owner = activeUser();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([owner]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-29");

      const updated = await service.assignOwner(actor, risk.id, owner.id, "REQ-30");
      expect(updated.ownerId).toBe(owner.id);
    });

    it("rejects an actor without risk.update permission", async () => {
      const repo = inMemoryRiskRepository();
      const owner = activeUser();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([owner]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-31");

      const readOnlyActor = { ...actor, roles: ["risk.read"] };
      await expect(service.assignOwner(readOnlyActor, risk.id, owner.id, "REQ-32")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("assignSuperiorOwner (ACT-122)", () => {
    it("assigns an active user as superior owner and records an audit event", async () => {
      const repo = inMemoryRiskRepository();
      const audit = inMemoryAuditRepository();
      const superior = activeUser();
      const service = new RiskService(repo, audit, undefined, inMemoryUserRepository([superior]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-33");

      const updated = await service.assignSuperiorOwner(actor, risk.id, superior.id, "REQ-34");

      expect(updated.superiorOwnerId).toBe(superior.id);
      expect(audit.events).toHaveLength(2); // CREATE + ASSIGN
    });

    it("rejects a superiorOwnerId that is the same person as the current owner", async () => {
      const repo = inMemoryRiskRepository();
      const person = activeUser();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([person]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-35");
      await service.assignOwner(actor, risk.id, person.id, "REQ-36");

      await expect(service.assignSuperiorOwner(actor, risk.id, person.id, "REQ-37")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects an ownerId that is the same person as the current superior owner (bidirectional check)", async () => {
      const repo = inMemoryRiskRepository();
      const person = activeUser();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([person]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-38");
      await service.assignSuperiorOwner(actor, risk.id, person.id, "REQ-39");

      await expect(service.assignOwner(actor, risk.id, person.id, "REQ-40")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects a superiorOwnerId that does not resolve to a user in the tenant", async () => {
      const repo = inMemoryRiskRepository();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([]));
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-41");

      await expect(service.assignSuperiorOwner(actor, risk.id, randomUUID(), "REQ-42")).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe("escalate (ACT-125)", () => {
    const escalateActor: AuthenticatedUser = { ...actor, roles: [...actor.roles, "risk.escalate"] };

    it("requires a reason", async () => {
      const repo = inMemoryRiskRepository();
      const superior = activeUser();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        inMemoryUserRepository([superior]),
        undefined,
        inMemoryRiskEscalationRepository(),
      );
      const risk = await service.create(escalateActor, { process: "P", description: "D" }, "REQ-43");
      await service.assignSuperiorOwner(escalateActor, risk.id, superior.id, "REQ-44");

      await expect(service.escalate(escalateActor, risk.id, "  ", "REQ-45")).rejects.toThrow(ValidationError);
    });

    it("rejects escalation when the risk has no superior owner assigned", async () => {
      const repo = inMemoryRiskRepository();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        inMemoryRiskEscalationRepository(),
      );
      const risk = await service.create(escalateActor, { process: "P", description: "D" }, "REQ-46");

      await expect(service.escalate(escalateActor, risk.id, "Seuil dépassé", "REQ-47")).rejects.toThrow(
        ValidationError,
      );
    });

    it("records an append-only escalation, audits it, and notifies", async () => {
      const repo = inMemoryRiskRepository();
      const audit = inMemoryAuditRepository();
      const escalations = inMemoryRiskEscalationRepository();
      const notifier = spyNotifier();
      const superior = activeUser();
      const service = new RiskService(
        repo,
        audit,
        undefined,
        inMemoryUserRepository([superior]),
        notifier,
        escalations,
      );
      const risk = await service.create(escalateActor, { process: "P", description: "D" }, "REQ-48");
      await service.assignSuperiorOwner(escalateActor, risk.id, superior.id, "REQ-49");

      const escalation = await service.escalate(escalateActor, risk.id, "Seuil dépassé", "REQ-50");

      expect(escalation.superiorOwnerId).toBe(superior.id);
      expect(escalations.events).toHaveLength(1);
      expect(audit.events.some((e) => (e as { action: string }).action === "ESCALATE")).toBe(true);
      expect(notifier.messages).toHaveLength(1);
      expect(notifier.messages[0]).toContain(superior.id);
    });

    it("rejects an actor without risk.escalate permission", async () => {
      const repo = inMemoryRiskRepository();
      const superior = activeUser();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        inMemoryUserRepository([superior]),
        undefined,
        inMemoryRiskEscalationRepository(),
      );
      const risk = await service.create(escalateActor, { process: "P", description: "D" }, "REQ-51");
      await service.assignSuperiorOwner(escalateActor, risk.id, superior.id, "REQ-52");

      await expect(service.escalate(actor, risk.id, "Seuil dépassé", "REQ-53")).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("list with ownerId filter (ACT-124)", () => {
    it("filters risks to only those owned by the given ownerId, tenant-scoped", async () => {
      const repo = inMemoryRiskRepository();
      const owner = activeUser();
      const service = new RiskService(repo, inMemoryAuditRepository(), undefined, inMemoryUserRepository([owner]));
      const mine = await service.create(actor, { process: "Mine", description: "D" }, "REQ-54");
      await service.create(actor, { process: "NotMine", description: "D" }, "REQ-55");
      await service.assignOwner(actor, mine.id, owner.id, "REQ-56");

      const results = await service.list(actor, false, owner.id);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(mine.id);
    });

    it("returns an empty list for an ownerId with no risks", async () => {
      const repo = inMemoryRiskRepository();
      const service = new RiskService(repo, inMemoryAuditRepository());
      await service.create(actor, { process: "P", description: "D" }, "REQ-57");

      const results = await service.list(actor, false, randomUUID());
      expect(results).toHaveLength(0);
    });
  });

  describe("processId (DIV-05)", () => {
    it("creates a risk with a valid processId when ProcessRepository is wired", async () => {
      const repo = inMemoryRiskRepository();
      const process = stubProcess();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        undefined,
        inMemoryProcessRepository([process]),
      );

      const risk = await service.create(actor, { process: "P", description: "D", processId: process.id }, "REQ-60");
      expect(risk.processId).toBe(process.id);
    });

    it("creates a risk with processId omitted (null), without needing ProcessRepository", async () => {
      const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());
      const risk = await service.create(actor, { process: "P", description: "D" }, "REQ-61");
      expect(risk.processId).toBeNull();
    });

    it("rejects a processId that does not resolve to a process in the tenant", async () => {
      const service = new RiskService(
        inMemoryRiskRepository(),
        inMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        undefined,
        inMemoryProcessRepository([]),
      );

      await expect(
        service.create(actor, { process: "P", description: "D", processId: randomUUID() }, "REQ-62"),
      ).rejects.toThrow(ValidationError);
    });

    it("throws (does not silently skip validation) when processId is supplied but ProcessRepository is not configured", async () => {
      const service = new RiskService(inMemoryRiskRepository(), inMemoryAuditRepository());

      await expect(
        service.create(actor, { process: "P", description: "D", processId: randomUUID() }, "REQ-63"),
      ).rejects.toThrow(ValidationError);
    });

    it("updates a risk's processId when valid", async () => {
      const repo = inMemoryRiskRepository();
      const processA = stubProcess();
      const processB = stubProcess();
      const service = new RiskService(
        repo,
        inMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        undefined,
        inMemoryProcessRepository([processA, processB]),
      );
      const risk = await service.create(actor, { process: "P", description: "D", processId: processA.id }, "REQ-64");

      const updated = await service.update(actor, risk.id, { processId: processB.id }, "REQ-65");
      expect(updated.processId).toBe(processB.id);
    });

    it("rejects a processId belonging to another tenant", async () => {
      const otherTenantProcess = stubProcess({ tenantId: "tenant-2" });
      const service = new RiskService(
        inMemoryRiskRepository(),
        inMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        undefined,
        inMemoryProcessRepository([otherTenantProcess]),
      );

      await expect(
        service.create(
          actor,
          { process: "P", description: "D", processId: otherTenantProcess.id },
          "REQ-66",
        ),
      ).rejects.toThrow(ValidationError);
    });
  });
});
