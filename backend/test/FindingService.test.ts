import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { FindingService } from "../src/services/FindingService.js";
import type { FindingRepository } from "../src/domain/repositories/FindingRepository.js";
import type { AuditMissionRepository } from "../src/domain/repositories/AuditMissionRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { Finding } from "../src/domain/entities/Finding.js";
import type { AuditMission } from "../src/domain/entities/AuditMission.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryFindingRepository(): FindingRepository {
  const store = new Map<string, Finding>();
  return {
    async getById(tenantId, id) {
      const f = store.get(id);
      return f && f.tenantId === tenantId ? f : null;
    },
    async list(tenantId, filters) {
      return [...store.values()].filter((f) => {
        if (f.tenantId !== tenantId) return false;
        if (filters?.auditMissionId && f.auditMissionId !== filters.auditMissionId) return false;
        if (filters?.status && f.status !== filters.status) return false;
        if (filters?.severity && f.severity !== filters.severity) return false;
        return true;
      });
    },
    async create(input) {
      const finding: Finding = {
        id: randomUUID(),
        tenantId: input.tenantId,
        auditMissionId: input.auditMissionId,
        title: input.title,
        description: input.description,
        severity: input.severity,
        recommendation: input.recommendation ?? null,
        relatedObjectType: input.relatedObjectType ?? null,
        relatedObjectId: input.relatedObjectId ?? null,
        status: "OUVERT",
        raisedBy: input.raisedBy,
        closedBy: null,
        closedAt: null,
        closureComment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(finding.id, finding);
      return finding;
    },
    async updateStatus(tenantId, id, status) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      if (existing.status !== "OUVERT") {
        throw new ValidationError("Finding status must be OUVERT to start treatment");
      }
      const updated: Finding = { ...existing, status, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async close(tenantId, id, closedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      if (existing.status !== "EN_TRAITEMENT") {
        throw new ValidationError("Finding status must be EN_TRAITEMENT to close");
      }
      const updated: Finding = {
        ...existing,
        status: "CLOS",
        closedBy,
        closedAt: new Date(),
        closureComment: comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
  };
}

function fakeAuditMissionRepository(missions: AuditMission[]): AuditMissionRepository {
  return {
    async getById(tenantId, id) {
      return missions.find((m) => m.id === id && m.tenantId === tenantId) ?? null;
    },
    async list() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async start() {
      throw new Error("not used in this test");
    },
    async close() {
      throw new Error("not used in this test");
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
  } as RiskRepository;
}

function mission(overrides: Partial<AuditMission> = {}): AuditMission {
  return {
    id: "mission-1",
    tenantId: "tenant-1",
    reference: "AUD-2026-001",
    title: "Audit KYC",
    scope: "Processus d'entrée en relation",
    status: "EN_COURS",
    leadAuditorId: "lead-1",
    auditorIds: [],
    plannedStartDate: new Date(),
    plannedEndDate: new Date(),
    actualStartDate: new Date(),
    actualEndDate: null,
    closureComment: null,
    createdBy: "lead-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const auditor1: AuthenticatedUser = {
  userId: "auditor-1",
  tenantId: "tenant-1",
  email: "auditor1@example.com",
  displayName: "Auditor 1",
  roles: ["audit.finding.read", "audit.finding.create", "audit.finding.update", "audit.finding.close"],
};

const auditor2: AuthenticatedUser = { ...auditor1, userId: "auditor-2", displayName: "Auditor 2" };

function buildService(overrides: {
  findings?: FindingRepository;
  missions?: AuditMissionRepository;
  risks?: RiskRepository;
} = {}) {
  return new FindingService(
    overrides.findings ?? inMemoryFindingRepository(),
    overrides.missions ?? fakeAuditMissionRepository([mission()]),
    inMemoryAuditRepository(),
    overrides.risks ?? fakeRiskRepository([]),
  );
}

describe("FindingService", () => {
  it("raises a Finding in OUVERT status against an EN_COURS mission, attributed to the actor", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "Absence de séparation des tâches", description: "D", severity: "HIGH" },
      "REQ-1",
    );
    expect(finding.status).toBe("OUVERT");
    expect(finding.raisedBy).toBe("auditor-1");
  });

  it("rejects raising a Finding against a mission that is not EN_COURS", async () => {
    const service = buildService({ missions: fakeAuditMissionRepository([mission({ status: "PLANIFIEE" })]) });
    await expect(
      service.create(auditor1, { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown auditMissionId", async () => {
    const service = buildService({ missions: fakeAuditMissionRepository([]) });
    await expect(
      service.create(auditor1, { auditMissionId: "ghost", title: "T", description: "D", severity: "LOW" }, "REQ-3"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires relatedObjectType and relatedObjectId to be both set or both omitted", async () => {
    const service = buildService();
    await expect(
      service.create(
        auditor1,
        { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW", relatedObjectType: "RISK" },
        "REQ-4",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("validates relatedObjectId exists in-tenant when relatedObjectType is RISK", async () => {
    const risk = { id: "risk-1", tenantId: "tenant-1" } as Risk;
    const service = buildService({ risks: fakeRiskRepository([risk]) });

    await expect(
      service.create(
        auditor1,
        { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW", relatedObjectType: "RISK", relatedObjectId: "missing" },
        "REQ-5",
      ),
    ).rejects.toThrow(ValidationError);

    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW", relatedObjectType: "RISK", relatedObjectId: "risk-1" },
      "REQ-6",
    );
    expect(finding.relatedObjectType).toBe("RISK");
    expect(finding.relatedObjectId).toBe("risk-1");
  });

  it("carries the recommendation as a plain text field, not a separate entity", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      {
        auditMissionId: "mission-1",
        title: "T",
        description: "D",
        severity: "MODERATE",
        recommendation: "Mettre en place un contrôle de second niveau",
      },
      "REQ-7",
    );
    expect(finding.recommendation).toBe("Mettre en place un contrôle de second niveau");
  });

  it("allows OUVERT -> EN_TRAITEMENT via startTreatment()", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW" },
      "REQ-8",
    );
    const inTreatment = await service.startTreatment(auditor1, finding.id, "REQ-9");
    expect(inTreatment.status).toBe("EN_TRAITEMENT");
  });

  it("rejects closing a Finding that is still OUVERT", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW" },
      "REQ-9A",
    );

    await expect(
      service.close(auditor2, finding.id, "Correction vérifiée", "REQ-9B"),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a closure comment, and forbids the raiser from closing their own Finding (maker-checker)", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW" },
      "REQ-10",
    );

    await service.startTreatment(auditor1, finding.id, "REQ-10A");
    await expect(service.close(auditor2, finding.id, "", "REQ-11")).rejects.toThrow(ValidationError);
    await expect(service.close(auditor1, finding.id, "J'ai corrigé moi-même", "REQ-12")).rejects.toThrow(ForbiddenError);

    const closed = await service.close(auditor2, finding.id, "Remédiation vérifiée", "REQ-13");
    expect(closed.status).toBe("CLOS");
    expect(closed.closedBy).toBe("auditor-2");
    expect(closed.closureComment).toBe("Remédiation vérifiée");
  });

  it("rejects closing a Finding that is already CLOS", async () => {
    const service = buildService();
    const finding = await service.create(
      auditor1,
      { auditMissionId: "mission-1", title: "T", description: "D", severity: "LOW" },
      "REQ-14",
    );
    await service.startTreatment(auditor1, finding.id, "REQ-14A");
    await service.close(auditor2, finding.id, "Remédié", "REQ-15");
    await expect(service.close(auditor2, finding.id, "Encore", "REQ-16")).rejects.toThrow(ValidationError);
  });
});
