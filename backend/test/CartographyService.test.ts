import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { CartographyService } from "../src/services/CartographyService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { ProcessRepository } from "../src/domain/repositories/ProcessRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RiskEvaluation, RiskEvaluationStatus } from "../src/domain/entities/RiskEvaluation.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

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
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryRiskEvaluationRepository(evaluations: RiskEvaluation[]): RiskEvaluationRepository {
  return {
    async getById(tenantId, id) {
      const e = evaluations.find((ev) => ev.tenantId === tenantId && ev.id === id);
      return e ?? null;
    },
    async listForRisk(tenantId, riskId, options) {
      const statuses = options?.status ? (Array.isArray(options.status) ? options.status : [options.status]) : null;
      let results = evaluations
        .filter((e) => e.tenantId === tenantId && e.riskId === riskId)
        .filter((e) => !statuses || statuses.includes(e.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return results.slice(offset, offset + limit);
    },
    async create() {
      throw new Error("not implemented");
    },
    async recordInherentScoring() {
      throw new Error("not implemented");
    },
    async recordMasteryAssessment() {
      throw new Error("not implemented");
    },
    async recordResidualScoring() {
      throw new Error("not implemented");
    },
    async recordValidation() {
      throw new Error("not implemented");
    },
    async recordRejection() {
      throw new Error("not implemented");
    },
    async recordCommitteeValidation() {
      throw new Error("not implemented");
    },
    async existsForRatingScale() {
      return false;
    },
  };
}

function inMemoryRatingScaleRepository(scales: RatingScale[]): RatingScaleRepository {
  return {
    async getById(tenantId, id) {
      return scales.find((s) => s.tenantId === tenantId && s.id === id) ?? null;
    },
    async list(tenantId, options) {
      return scales.filter((s) => s.tenantId === tenantId && (options?.includeArchived || s.status !== "ARCHIVED"));
    },
    async create() {
      throw new Error("not implemented");
    },
    async updateThresholds() {
      throw new Error("not implemented");
    },
    async updateImpactAxes() {
      throw new Error("not implemented");
    },
    async updateVelocity() {
      throw new Error("not implemented");
    },
    async updatePersistence() {
      throw new Error("not implemented");
    },
    async updateMastery() {
      throw new Error("not implemented");
    },
    async activateAndArchivePrevious() {
      throw new Error("not implemented");
    },
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryProcessRepository(processes: Process[]): ProcessRepository {
  return {
    async getById(tenantId, id) {
      return processes.find((p) => p.tenantId === tenantId && p.id === id) ?? null;
    },
    async list(tenantId) {
      return processes.filter((p) => p.tenantId === tenantId);
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

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TENANT = "tenant-1";

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: TENANT,
  email: "user@djamo.example",
  displayName: "User",
  roles: ["cartography.read"],
};

const forbiddenActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: [] };

function buildRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    process: "Payments",
    description: "Fraud on instant transfers",
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

function buildEvaluation(riskId: string, overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  const createdAt = overrides.createdAt ?? new Date();
  return {
    id: randomUUID(),
    tenantId: TENANT,
    riskId,
    evaluationType: "AD_HOC",
    status: "VALIDATED" as RiskEvaluationStatus,
    evaluatorId: "evaluator-1",
    subCategory: "Fraude",
    entity: "CI",
    ratingScaleId: null,
    ratingScaleVersion: null,
    inherentProbability: 3,
    inherentImpacts: [],
    inherentImpactRetained: 4,
    inherentScore: 12,
    masteryLines: null,
    masteryGlobal: 2,
    residualProbability: 2,
    residualImpacts: [],
    residualImpactRetained: 3,
    residualScore: 6,
    residualJustification: "Post-maîtrise",
    appetiteThresholdSuggested: null,
    appetiteThresholdOverride: null,
    appetiteThresholdApplied: null,
    appetiteExceeded: null,
    validatedBy: "validator-1",
    validatedAt: new Date(),
    comment: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function buildRatingScale(id: string, criticalityThresholds: RatingScale["criticalityThresholds"]): RatingScale {
  return {
    id,
    tenantId: TENANT,
    name: "Djamo Risk Scale",
    version: "2026.1",
    status: "ACTIVE",
    probabilityLevels: 5,
    probabilityLabels: null,
    impactLevels: 5,
    impactLabels: null,
    criticalityThresholds,
    impactAxes: null,
    velocityLevels: null,
    persistenceLevels: null,
    masteryScale: null,
    activatedAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  };
}

function buildProcess(overrides: Partial<Process> = {}): Process {
  return {
    id: "process-1",
    tenantId: TENANT,
    parentId: null,
    level: "PROCESS",
    name: "Paiements (FK)",
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

function newService(
  risks: Risk[],
  evaluations: RiskEvaluation[],
  scales: RatingScale[] = [],
  processes: Process[] = [],
) {
  return new CartographyService(
    inMemoryRiskRepository(risks),
    inMemoryRiskEvaluationRepository(evaluations),
    inMemoryRatingScaleRepository(scales),
    inMemoryProcessRepository(processes),
  );
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("CartographyService", () => {
  it("rejects a caller without cartography.read", async () => {
    const risk = buildRisk();
    const service = newService([risk], [buildEvaluation(risk.id)]);
    await expect(service.getCartography(forbiddenActor, "residual")).rejects.toThrow();
  });

  it("excludes a risk with no authoritative evaluation (a BROUILLON evaluation does not count)", async () => {
    const risk = buildRisk();
    const draft = buildEvaluation(risk.id, { status: "BROUILLON", residualScore: null, residualProbability: null, residualImpactRetained: null });
    const service = newService([risk], [draft]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(0);
  });

  it("excludes a risk with only a REJECTED evaluation", async () => {
    const risk = buildRisk();
    const rejected = buildEvaluation(risk.id, { status: "REJECTED" });
    const service = newService([risk], [rejected]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(0);
  });

  it("2026-09-30 audit fix: includes a risk whose only evaluation is VALIDE_COMITE (committee-validated), not just VALIDATED", async () => {
    const risk = buildRisk();
    const committeeValidated = buildEvaluation(risk.id, { status: "VALIDE_COMITE", residualScore: 25 });
    const service = newService([risk], [committeeValidated]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(1);
    expect(points[0]?.score).toBe(25);
    expect(points[0]?.evaluationStatus).toBe("VALIDE_COMITE");
  });

  it("prefers the most recent of a VALIDATED and a VALIDE_COMITE evaluation on the same risk, regardless of which status is newer", async () => {
    const risk = buildRisk();
    const olderValidated = buildEvaluation(risk.id, {
      createdAt: new Date("2026-01-01"),
      residualScore: 5,
      status: "VALIDATED",
    });
    const newerCommittee = buildEvaluation(risk.id, {
      createdAt: new Date("2026-03-01"),
      residualScore: 25,
      status: "VALIDE_COMITE",
    });
    const service = newService([risk], [olderValidated, newerCommittee]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(1);
    expect(points[0]?.score).toBe(25);
    expect(points[0]?.evaluationStatus).toBe("VALIDE_COMITE");
  });

  it("prefers a newer VALIDATED evaluation over an older VALIDE_COMITE one (most recent wins either way)", async () => {
    const risk = buildRisk();
    const olderCommittee = buildEvaluation(risk.id, {
      createdAt: new Date("2026-01-01"),
      residualScore: 25,
      status: "VALIDE_COMITE",
    });
    const newerValidated = buildEvaluation(risk.id, {
      createdAt: new Date("2026-03-01"),
      residualScore: 5,
      status: "VALIDATED",
    });
    const service = newService([risk], [olderCommittee, newerValidated]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(1);
    expect(points[0]?.score).toBe(5);
    expect(points[0]?.evaluationStatus).toBe("VALIDATED");
  });

  it("exposes evaluationStatus: VALIDATED for a plain maker-checker-validated evaluation", async () => {
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, { status: "VALIDATED" });
    const service = newService([risk], [evaluation]);

    const points = await service.getCartography(actor, "residual");
    expect(points[0]?.evaluationStatus).toBe("VALIDATED");
  });

  it("excludes a risk that has no evaluation at all", async () => {
    const risk = buildRisk();
    const service = newService([risk], []);
    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(0);
  });

  it("selects the most recent VALIDATED evaluation per risk, ignoring an older validated one and a newer rejected one", async () => {
    const risk = buildRisk();
    const older = buildEvaluation(risk.id, {
      createdAt: new Date("2026-01-01"),
      residualScore: 2,
      status: "VALIDATED",
    });
    const newerRejected = buildEvaluation(risk.id, {
      createdAt: new Date("2026-03-01"),
      residualScore: 99,
      status: "REJECTED",
    });
    const mostRecentValidated = buildEvaluation(risk.id, {
      createdAt: new Date("2026-02-01"),
      residualScore: 8,
      status: "VALIDATED",
    });
    const service = newService([risk], [older, newerRejected, mostRecentValidated]);

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(1);
    expect(points[0]?.score).toBe(8);
  });

  it("returns inherent fields when version=inherent and residual fields when version=residual", async () => {
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, {
      inherentProbability: 4,
      inherentImpactRetained: 5,
      inherentScore: 20,
      residualProbability: 1,
      residualImpactRetained: 2,
      residualScore: 2,
    });
    const service = newService([risk], [evaluation]);

    const inherentPoints = await service.getCartography(actor, "inherent");
    expect(inherentPoints[0]).toMatchObject({ probability: 4, impactRetained: 5, score: 20 });

    const residualPoints = await service.getCartography(actor, "residual");
    expect(residualPoints[0]).toMatchObject({ probability: 1, impactRetained: 2, score: 2 });
  });

  it("defaults to the residual version when none is specified", async () => {
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, { inherentScore: 20, residualScore: 5 });
    const service = newService([risk], [evaluation]);

    const points = await service.getCartography(actor);
    expect(points[0]?.score).toBe(5);
  });

  it("derives criticality from the rating scale's configured bands when available", async () => {
    const scale = buildRatingScale("scale-1", [
      { label: "Faible", min: 1, max: 5 },
      { label: "Critique", min: 6, max: 25 },
    ]);
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, { ratingScaleId: "scale-1", residualScore: 20 });
    const service = newService([risk], [evaluation], [scale]);

    const points = await service.getCartography(actor, "residual");
    expect(points[0]?.criticality).toBe("Critique");
  });

  it("falls back to fixed default score bands when no rating scale is configured", async () => {
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, { ratingScaleId: null, residualScore: 3 });
    const service = newService([risk], [evaluation]);

    const points = await service.getCartography(actor, "residual");
    expect(points[0]?.criticality).toBe("Faible");
  });

  it("combines entity and score-range filters (AND, not OR)", async () => {
    const riskA = buildRisk({ process: "Payments" });
    const riskB = buildRisk({ process: "Onboarding" });
    const evalA = buildEvaluation(riskA.id, { entity: "CI", residualScore: 8 });
    const evalB = buildEvaluation(riskB.id, { entity: "SN", residualScore: 8 });
    const evalAWrongScore = buildEvaluation(riskA.id, {
      entity: "CI",
      residualScore: 20,
      createdAt: new Date("2020-01-01"), // older, so evalA above still wins as "most recent"
    });
    const service = newService([riskA, riskB], [evalA, evalB, evalAWrongScore]);

    const points = await service.getCartography(actor, "residual", { entity: "CI", minScore: 5, maxScore: 10 });
    expect(points).toHaveLength(1);
    expect(points[0]?.riskId).toBe(riskA.id);
  });

  it("filters by department via Risk.ownerDepartmentId", async () => {
    const riskA = buildRisk({ ownerDepartmentId: "dept-1" });
    const riskB = buildRisk({ ownerDepartmentId: "dept-2" });
    const service = newService(
      [riskA, riskB],
      [buildEvaluation(riskA.id), buildEvaluation(riskB.id)],
    );

    const points = await service.getCartography(actor, "residual", { departmentId: "dept-1" });
    expect(points).toHaveLength(1);
    expect(points[0]?.riskId).toBe(riskA.id);
  });

  it("filters by subCategory (RiskEvaluation.subCategory)", async () => {
    const riskA = buildRisk();
    const riskB = buildRisk();
    const service = newService(
      [riskA, riskB],
      [buildEvaluation(riskA.id, { subCategory: "Fraude" }), buildEvaluation(riskB.id, { subCategory: "Conformité" })],
    );

    const points = await service.getCartography(actor, "residual", { subCategory: "Conformité" });
    expect(points).toHaveLength(1);
    expect(points[0]?.riskId).toBe(riskB.id);
  });

  it("rejects the ownerId filter explicitly rather than ignoring it or guessing at a shape (ACT-183, blocked pending RiskOwnership)", async () => {
    const risk = buildRisk();
    const service = newService([risk], [buildEvaluation(risk.id)]);

    await expect(service.getCartography(actor, "residual", { ownerId: "me" })).rejects.toThrow(ValidationError);
  });

  it("returns both inherent and residual points for the same filters via compare()", async () => {
    const risk = buildRisk();
    const evaluation = buildEvaluation(risk.id, { inherentScore: 20, residualScore: 5 });
    const service = newService([risk], [evaluation]);

    const result = await service.compare(actor);
    expect(result.inherent).toHaveLength(1);
    expect(result.residual).toHaveLength(1);
    expect(result.inherent[0]?.score).toBe(20);
    expect(result.residual[0]?.score).toBe(5);
  });

  it("rejects compare() for the ownerId filter too", async () => {
    const risk = buildRisk();
    const service = newService([risk], [buildEvaluation(risk.id)]);
    await expect(service.compare(actor, { ownerId: "me" })).rejects.toThrow(ValidationError);
  });

  describe("processId wiring (DIV-05)", () => {
    it("resolves the process label via Risk.processId -> Process.name when the FK is set and resolves", async () => {
      const process = buildProcess({ id: "process-1", name: "Paiements instantanés" });
      const risk = buildRisk({ process: "stale free text", processId: process.id });
      const service = newService([risk], [buildEvaluation(risk.id)], [], [process]);

      const points = await service.getCartography(actor, "residual");
      expect(points[0]?.process).toBe("Paiements instantanés");
      expect(points[0]?.processId).toBe(process.id);
      expect(points[0]?.resolvedVia).toBe("processId");
    });

    it("falls back to Risk.process free text, explicitly flagged, when processId is null", async () => {
      const risk = buildRisk({ process: "Payments", processId: null });
      const service = newService([risk], [buildEvaluation(risk.id)]);

      const points = await service.getCartography(actor, "residual");
      expect(points[0]?.process).toBe("Payments");
      expect(points[0]?.processId).toBeNull();
      expect(points[0]?.resolvedVia).toBe("processText");
    });

    it("falls back to free text, explicitly flagged, when processId points at a process that no longer resolves (stale FK)", async () => {
      const risk = buildRisk({ process: "Payments", processId: "deleted-process" });
      const service = newService([risk], [buildEvaluation(risk.id)], [], []);

      const points = await service.getCartography(actor, "residual");
      expect(points[0]?.process).toBe("Payments");
      expect(points[0]?.resolvedVia).toBe("processText");
    });

    it("falls back to free text, explicitly flagged, when no ProcessRepository is wired", async () => {
      const process = buildProcess({ id: "process-1", name: "Paiements instantanés" });
      const risk = buildRisk({ process: "Payments", processId: process.id });
      const service = new CartographyService(
        inMemoryRiskRepository([risk]),
        inMemoryRiskEvaluationRepository([buildEvaluation(risk.id)]),
        inMemoryRatingScaleRepository([]),
        // processes repository omitted entirely
      );

      const points = await service.getCartography(actor, "residual");
      expect(points[0]?.process).toBe("Payments");
      expect(points[0]?.resolvedVia).toBe("processText");
    });
  });

  it("scopes by tenant: a risk from another tenant never appears", async () => {
    const risk = buildRisk();
    const otherTenantRisk = buildRisk({ tenantId: "tenant-2" });
    const service = newService(
      [risk, otherTenantRisk],
      [buildEvaluation(risk.id), buildEvaluation(otherTenantRisk.id, { tenantId: "tenant-2" })],
    );

    const points = await service.getCartography(actor, "residual");
    expect(points).toHaveLength(1);
    expect(points[0]?.riskId).toBe(risk.id);
  });
});
