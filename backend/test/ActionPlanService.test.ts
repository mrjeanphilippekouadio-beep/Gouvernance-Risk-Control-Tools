import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { AnomalyRepository } from "../src/domain/repositories/AnomalyRepository.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { ActionLink, ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../src/infrastructure/notifications/Notifier.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryActionPlanRepository(): ActionPlanRepository {
  const store = new Map<string, ActionPlan>();
  const links = new Map<string, ActionLink[]>();
  return {
    async getById(tenantId, id) {
      const a = store.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async list(tenantId, filters) {
      return [...store.values()].filter((a) => {
        if (a.tenantId !== tenantId) return false;
        if (filters?.status && a.status !== filters.status) return false;
        if (filters?.sourceType && a.sourceType !== filters.sourceType) return false;
        if (filters?.responsibleUserId && a.responsibleUserId !== filters.responsibleUserId) return false;
        if (filters?.departmentIds && filters.departmentIds.length > 0 && (!a.departmentId || !filters.departmentIds.includes(a.departmentId))) return false;
        if (filters?.dueFrom && a.dueDate.getTime() < filters.dueFrom.getTime()) return false;
        if (filters?.dueTo && a.dueDate.getTime() > filters.dueTo.getTime()) return false;
        return true;
      });
    },
    async create(input) {
      const action: ActionPlan = {
        id: randomUUID(),
        tenantId: input.tenantId,
        title: input.title,
        description: input.description ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        responsibleUserId: input.responsibleUserId,
        departmentId: input.departmentId ?? null,
        dueDate: input.dueDate,
        status: "PLANIFIEE",
        progressPercent: 0,
        progressComment: null,
        evidenceId: null,
        createdBy: input.createdBy,
        closedBy: null,
        closedAt: null,
        closureComment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(action.id, action);
      return action;
    },
    async updateProgress(tenantId, id, progressPercent, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: ActionPlan = { ...existing, progressPercent, progressComment: comment, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async start(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.status !== "PLANIFIEE") throw new Error("not found");
      const updated: ActionPlan = { ...existing, status: "EN_COURS", updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async close(tenantId, id, closedBy, evidenceId, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId || existing.status === "TERMINEE") throw new Error("not found");
      const updated: ActionPlan = {
        ...existing,
        status: "TERMINEE",
        progressPercent: 100,
        evidenceId,
        closedBy,
        closedAt: new Date(),
        closureComment: comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async listLinks(_tenantId, actionId) {
      return links.get(actionId) ?? [];
    },
    async replaceLinks(_tenantId, actionId, newLinks) {
      links.set(actionId, newLinks);
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

function fakeRiskRepository(risks: Risk[]): RiskRepository {
  return {
    async getById(tenantId, id) {
      return risks.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
    },
    async listByIds() {
      return [];
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

// QA-BATCH-1-3: previously always returned null regardless of args, so
// ActionPlanService's CONTROL/KRI branches of assertSourceExists /
// assertLinkTargetExists were never exercised by any test in this file
// (only sourceType: "RISK" was) — parameterized the same way as
// fakeRiskRepository so those branches can actually be reached.
function fakeControlRepository(controls: Control[] = []): ControlRepository {
  return {
    async getById(tenantId, id) {
      return controls.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
    },
    async list() {
      return [];
    },
    async listCoveringRisk() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

function fakeKriRepository(kris: Kri[] = []): KriRepository {
  return {
    async getById(tenantId, id) {
      return kris.find((k) => k.id === id && k.tenantId === tenantId) ?? null;
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
    async listCoveredRiskIds() {
      return [];
    },
    async replaceCoveredRisks() {
      // not used in this test
    },
  };
}

function fakeAnomalyRepository(): AnomalyRepository {
  return {
    async getById() {
      return null;
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async updateStatus() {
      throw new Error("not used in this test");
    },
  };
}

function fakeEvidenceRepository(evidences: Evidence[]): EvidenceRepository {
  return {
    async getById(tenantId, id) {
      return evidences.find((e) => e.id === id && e.tenantId === tenantId) ?? null;
    },
    async listForControlExecution() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async markDeleted() {
      // not used in this test
    },
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

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "risk-1",
    tenantId: "tenant-1",
    process: "Paiements",
    description: "Fraude interne",
    ownerDepartmentId: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function control(overrides: Partial<Control> = {}): Control {
  return {
    id: "control-1",
    tenantId: "tenant-1",
    label: "Contrôle 4 yeux",
    objective: null,
    coveredRiskIds: [],
    process: null,
    departmentId: null,
    procedureDescription: null,
    controlType: "PREVENTIVE",
    nature: null,
    defenseLine: null,
    frequency: "Mensuel",
    executor: "IT",
    validator: null,
    expectedEvidence: null,
    complianceCriteria: "criteria",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function kri(overrides: Partial<Kri> = {}): Kri {
  return {
    id: "kri-1",
    tenantId: "tenant-1",
    label: "Taux de fraude",
    formula: "fraudes / transactions",
    thresholdGreen: 1,
    thresholdOrange: 5,
    thresholdRed: 10,
    frequency: "MONTHLY",
    riskId: "risk-1",
    entity: null,
    methodologyVersion: null,
    description: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "evidence-1",
    tenantId: "tenant-1",
    controlExecutionId: null,
    fileName: "preuve.pdf",
    driveFileId: "drive-1",
    driveUrl: "https://drive.example/1",
    documentType: "PDF",
    uploadedBy: "user-2",
    uploadedAt: new Date(),
    version: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

const creator: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "creator@example.com",
  displayName: "Creator",
  roles: ["actionplan.read", "actionplan.create", "actionplan.update", "actionplan.validate"],
};

const otherUser: AuthenticatedUser = { ...creator, userId: "user-2", displayName: "Other" };
const readOnlyActor: AuthenticatedUser = { ...creator, userId: "user-3", roles: ["actionplan.read"] };

function buildService(overrides: {
  actions?: ActionPlanRepository;
  risks?: RiskRepository;
  controls?: ControlRepository;
  kris?: KriRepository;
  evidences?: EvidenceRepository;
  notifier?: Notifier;
} = {}) {
  return new ActionPlanService(
    overrides.actions ?? inMemoryActionPlanRepository(),
    inMemoryAuditRepository(),
    overrides.risks ?? fakeRiskRepository([risk()]),
    overrides.controls ?? fakeControlRepository([control()]),
    overrides.kris ?? fakeKriRepository([kri()]),
    fakeAnomalyRepository(),
    overrides.evidences ?? fakeEvidenceRepository([evidence()]),
    overrides.notifier,
  );
}

function futureDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

function pastDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

describe("ActionPlanService.create (ACT-190) — polymorphic source validation", () => {
  it("creates an action in PLANIFIEE status attributed to the actor", async () => {
    const service = buildService();
    const action = await service.create(
      creator,
      { title: "Corriger la ségrégation des tâches", sourceType: "RISK", sourceId: "risk-1", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-1",
    );
    expect(action.status).toBe("PLANIFIEE");
    expect(action.createdBy).toBe("user-1");
    expect(action.progressPercent).toBe(0);
  });

  it("rejects an empty title", async () => {
    const service = buildService();
    await expect(
      service.create(creator, { title: "  ", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires sourceId when sourceType is RISK/CONTROL/KRI", async () => {
    const service = buildService();
    await expect(
      service.create(creator, { title: "T", sourceType: "RISK", responsibleUserId: "user-2", dueDate: futureDate() }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a sourceId that does not exist in this tenant", async () => {
    const service = buildService({ risks: fakeRiskRepository([]) });
    await expect(
      service.create(
        creator,
        { title: "T", sourceType: "RISK", sourceId: "missing-risk", responsibleUserId: "user-2", dueDate: futureDate() },
        "REQ-4",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a sourceId supplied for AUDIT/INCIDENT/MANAGEMENT sources", async () => {
    const service = buildService();
    await expect(
      service.create(
        creator,
        { title: "T", sourceType: "INCIDENT", sourceId: "some-id", responsibleUserId: "user-2", dueDate: futureDate() },
        "REQ-5",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("allows AUDIT/INCIDENT/MANAGEMENT sources without a sourceId", async () => {
    const service = buildService();
    const action = await service.create(
      creator,
      { title: "Suivi audit externe", sourceType: "AUDIT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-6",
    );
    expect(action.sourceId).toBeNull();
  });

  it("rejects a caller without actionplan.create", async () => {
    const service = buildService();
    await expect(
      service.create(readOnlyActor, { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() }, "REQ-7"),
    ).rejects.toThrow(ForbiddenError);
  });

  // QA-BATCH-1-3: only sourceType "RISK" was ever exercised above (both the
  // happy path and the "does not exist" rejection) — CONTROL and KRI share
  // the exact same assertSourceExists branch shape but were never called at
  // all, so a wiring bug (e.g. swapping the controls/kris constructor
  // arguments in server.ts) would have gone undetected.
  it("accepts an existing CONTROL sourceId", async () => {
    const service = buildService();
    const action = await service.create(
      creator,
      { title: "T", sourceType: "CONTROL", sourceId: "control-1", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-53",
    );
    expect(action.sourceId).toBe("control-1");
  });

  it("rejects a CONTROL sourceId that does not exist in this tenant", async () => {
    const service = buildService({ controls: fakeControlRepository([]) });
    await expect(
      service.create(
        creator,
        { title: "T", sourceType: "CONTROL", sourceId: "missing-control", responsibleUserId: "user-2", dueDate: futureDate() },
        "REQ-54",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("accepts an existing KRI sourceId", async () => {
    const service = buildService();
    const action = await service.create(
      creator,
      { title: "T", sourceType: "KRI", sourceId: "kri-1", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-55",
    );
    expect(action.sourceId).toBe("kri-1");
  });

  it("rejects a KRI sourceId that does not exist in this tenant", async () => {
    const service = buildService({ kris: fakeKriRepository([]) });
    await expect(
      service.create(
        creator,
        { title: "T", sourceType: "KRI", sourceId: "missing-kri", responsibleUserId: "user-2", dueDate: futureDate() },
        "REQ-56",
      ),
    ).rejects.toThrow(ValidationError);
  });
});

describe("ActionPlanService — computed EN_RETARD status (ACT-192/193), never stored", () => {
  it("reports PLANIFIEE as EN_RETARD once the due date has passed, without changing the stored status", async () => {
    const repo = inMemoryActionPlanRepository();
    const service = buildService({ actions: repo });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: pastDate() },
      "REQ-8",
    );
    expect(created.computedStatus).toBe("EN_RETARD");
    expect(created.priority).toBe("HIGH");

    const stored = await repo.getById("tenant-1", created.id);
    expect(stored?.status).toBe("PLANIFIEE");
  });

  it("reports NORMAL priority and the stored status when the due date is in the future", async () => {
    const service = buildService();
    const action = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-9",
    );
    expect(action.computedStatus).toBe("PLANIFIEE");
    expect(action.priority).toBe("NORMAL");
  });

  it("never reports EN_RETARD for a closed (TERMINEE) action, even with a past due date", async () => {
    const repo = inMemoryActionPlanRepository();
    const service = buildService({ actions: repo });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: pastDate() },
      "REQ-10",
    );
    const closed = await service.close(otherUser, created.id, "evidence-1", "Fait", "REQ-11");
    expect(closed.status).toBe("TERMINEE");
    expect(closed.computedStatus).toBe("TERMINEE");
    expect(closed.priority).toBe("NORMAL");
  });
});

describe("ActionPlanService.updateProgress (ACT-191)", () => {
  it("updates progressPercent and comment", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-12",
    );
    const updated = await service.updateProgress(creator, created.id, 40, "Moitié faite", "REQ-13");
    expect(updated.progressPercent).toBe(40);
    expect(updated.progressComment).toBe("Moitié faite");
  });

  it("rejects an out-of-range progressPercent", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-14",
    );
    await expect(service.updateProgress(creator, created.id, 150, null, "REQ-15")).rejects.toThrow(ValidationError);
  });

  it("rejects updating progress on an already-closed action", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-16",
    );
    await service.close(otherUser, created.id, "evidence-1", "Fait", "REQ-17");
    await expect(service.updateProgress(creator, created.id, 50, null, "REQ-18")).rejects.toThrow(ValidationError);
  });
});

describe("ActionPlanService.start (ACT-192) — narrow non-terminal transition", () => {
  it("moves PLANIFIEE to EN_COURS", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-19",
    );
    const started = await service.start(creator, created.id, "REQ-20");
    expect(started.status).toBe("EN_COURS");
  });

  it("rejects starting an action that is not PLANIFIEE", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-21",
    );
    await service.start(creator, created.id, "REQ-22");
    await expect(service.start(creator, created.id, "REQ-23")).rejects.toThrow(ValidationError);
  });

  it("best-effort notifies when an already-overdue action is started", async () => {
    const notifier = spyNotifier();
    const service = buildService({ notifier });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: pastDate() },
      "REQ-24",
    );
    await service.start(creator, created.id, "REQ-25");
    expect(notifier.messages).toHaveLength(1);
    expect(notifier.messages[0]).toContain("retard");
  });

  it("does not notify when starting an action that is on time", async () => {
    const notifier = spyNotifier();
    const service = buildService({ notifier });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-26",
    );
    await service.start(creator, created.id, "REQ-27");
    expect(notifier.messages).toHaveLength(0);
  });
});

describe("ActionPlanService.escalateIfOverdue (ACT-193)", () => {
  it("does not escalate an action that isn't overdue", async () => {
    const notifier = spyNotifier();
    const service = buildService({ notifier });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-28",
    );
    const result = await service.escalateIfOverdue(creator, created.id, "REQ-29");
    expect(result.escalated).toBe(false);
    expect(notifier.messages).toHaveLength(0);
  });

  it("best-effort notifies and flags escalated=true for an overdue action, without changing the stored status", async () => {
    const notifier = spyNotifier();
    const repo = inMemoryActionPlanRepository();
    const service = buildService({ actions: repo, notifier });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: pastDate() },
      "REQ-30",
    );
    const result = await service.escalateIfOverdue(creator, created.id, "REQ-31");
    expect(result.escalated).toBe(true);
    expect(notifier.messages).toHaveLength(1);
    const stored = await repo.getById("tenant-1", created.id);
    expect(stored?.status).toBe("PLANIFIEE");
  });
});

describe("ActionPlanService.close (ACT-195) — mandatory evidence + maker-checker", () => {
  it("closes an action with valid evidence when the closer is not the creator", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-32",
    );
    const closed = await service.close(otherUser, created.id, "evidence-1", "Documenté", "REQ-33");
    expect(closed.status).toBe("TERMINEE");
    expect(closed.evidenceId).toBe("evidence-1");
    expect(closed.closedBy).toBe("user-2");
  });

  it("rejects closing without an evidenceId", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-34",
    );
    await expect(service.close(otherUser, created.id, "", null, "REQ-35")).rejects.toThrow(ValidationError);
  });

  it("rejects an evidenceId that does not exist in this tenant", async () => {
    const service = buildService({ evidences: fakeEvidenceRepository([]) });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-36",
    );
    await expect(service.close(otherUser, created.id, "missing-evidence", null, "REQ-37")).rejects.toThrow(ValidationError);
  });

  it("maker-checker: rejects the creator closing their own action", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-38",
    );
    await expect(service.close(creator, created.id, "evidence-1", "Documenté", "REQ-39")).rejects.toThrow(ForbiddenError);
  });

  it("rejects closing an already-closed action", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-40",
    );
    await service.close(otherUser, created.id, "evidence-1", "Fait", "REQ-41");
    await expect(service.close(otherUser, created.id, "evidence-1", "Encore", "REQ-42")).rejects.toThrow(ValidationError);
  });

  it("rejects a closer without actionplan.validate", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-43",
    );
    const readOnlyOther = { ...otherUser, roles: ["actionplan.read", "actionplan.update"] };
    await expect(service.close(readOnlyOther, created.id, "evidence-1", "Fait", "REQ-44")).rejects.toThrow(ForbiddenError);
  });
});

describe("ActionPlanService.setLinks (ACT-194)", () => {
  it("rejects a link resourceId that does not exist in this tenant", async () => {
    const service = buildService({ risks: fakeRiskRepository([]) });
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-45",
    );
    await expect(
      service.setLinks(creator, created.id, [{ resourceType: "RISK", resourceId: "missing-risk" }], "REQ-46"),
    ).rejects.toThrow(ValidationError);
  });

  it("links to an existing in-tenant resource and can be read back", async () => {
    const service = buildService();
    const created = await service.create(
      creator,
      { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-47",
    );
    await service.setLinks(creator, created.id, [{ resourceType: "RISK", resourceId: "risk-1" }], "REQ-48");
    const links = await service.listLinks(creator, created.id);
    expect(links).toEqual([{ resourceType: "RISK", resourceId: "risk-1" }]);
  });
});

describe("ActionPlanService.dashboard (ACT-196)", () => {
  it("filters by computed EN_RETARD even though it is never a stored status", async () => {
    const service = buildService();
    const overdue = await service.create(
      creator,
      { title: "Overdue", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: pastDate() },
      "REQ-49",
    );
    await service.create(
      creator,
      { title: "On time", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-50",
    );

    const overdueOnly = await service.dashboard(creator, { status: "EN_RETARD" });
    expect(overdueOnly).toHaveLength(1);
    expect(overdueOnly[0]?.id).toBe(overdue.id);
  });

  it("filters by responsibleUserId", async () => {
    const service = buildService();
    await service.create(
      creator,
      { title: "For user-2", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-51",
    );
    await service.create(
      creator,
      { title: "For user-3", sourceType: "MANAGEMENT", responsibleUserId: "user-3", dueDate: futureDate() },
      "REQ-52",
    );

    const forUser2 = await service.dashboard(creator, { responsibleUserId: "user-2" });
    expect(forUser2).toHaveLength(1);
    expect(forUser2[0]?.responsibleUserId).toBe("user-2");
  });

  it("rejects a caller without actionplan.read", async () => {
    const service = buildService();
    const noPerms = { ...creator, roles: [] };
    await expect(service.dashboard(noPerms, {})).rejects.toThrow(ForbiddenError);
  });

  // QA-BATCH-1-3: every other test in this file uses a single tenant —
  // this is the only one that actually seeds two tenants' action plans
  // into the same shared repository instance and asserts the leak-free
  // read, rather than relying on two disjoint in-memory stores.
  it("never leaks another tenant's action plans into the dashboard", async () => {
    const repo = inMemoryActionPlanRepository();
    const service = buildService({ actions: repo });
    await service.create(
      creator,
      { title: "Tenant 1 action", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-57",
    );
    const otherTenantCreator: AuthenticatedUser = { ...creator, tenantId: "tenant-2" };
    await service.create(
      otherTenantCreator,
      { title: "Tenant 2 action", sourceType: "MANAGEMENT", responsibleUserId: "user-2", dueDate: futureDate() },
      "REQ-58",
    );

    const tenant1Rows = await service.dashboard(creator, {});
    expect(tenant1Rows.map((r) => r.title)).toEqual(["Tenant 1 action"]);
  });
});
