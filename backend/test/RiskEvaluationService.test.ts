import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { RiskAppetiteRepository } from "../src/domain/repositories/RiskAppetiteRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { RiskAppetite } from "../src/domain/entities/RiskAppetite.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

function inMemoryRiskEvaluationRepository(): RiskEvaluationRepository {
  const store = new Map<string, RiskEvaluation>();
  return {
    async getById(tenantId, id) {
      const e = store.get(id);
      return e && e.tenantId === tenantId ? e : null;
    },
    async listForRisk(tenantId, riskId, options) {
      let results = [...store.values()]
        .filter((e) => e.tenantId === tenantId && e.riskId === riskId)
        .filter((e) => !options?.status || e.status === options.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 50;
      return results.slice(offset, offset + limit);
    },
    async create(input) {
      const evaluation: RiskEvaluation = {
        id: randomUUID(),
        tenantId: input.tenantId,
        riskId: input.riskId,
        evaluationType: input.evaluationType,
        status: "BROUILLON",
        evaluatorId: input.evaluatorId,
        subCategory: input.subCategory,
        entity: input.entity ?? null,
        ratingScaleId: null,
        ratingScaleVersion: null,
        inherentProbability: null,
        inherentImpacts: null,
        inherentImpactRetained: null,
        inherentScore: null,
        masteryLines: null,
        masteryGlobal: null,
        residualProbability: null,
        residualImpacts: null,
        residualImpactRetained: null,
        residualScore: null,
        residualJustification: null,
        appetiteThresholdSuggested: null,
        appetiteThresholdOverride: null,
        appetiteThresholdApplied: null,
        appetiteExceeded: null,
        validatedBy: null,
        validatedAt: null,
        comment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(evaluation.id, evaluation);
      return evaluation;
    },
    async recordInherentScoring(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        ratingScaleId: input.ratingScaleId,
        ratingScaleVersion: input.ratingScaleVersion,
        inherentProbability: input.probability,
        inherentImpacts: input.impacts,
        inherentImpactRetained: input.impactRetained,
        inherentScore: input.score,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async recordMasteryAssessment(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        masteryLines: input.lines,
        masteryGlobal: input.masteryGlobal,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async recordResidualScoring(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        residualProbability: input.probability,
        residualImpacts: input.impacts,
        residualImpactRetained: input.impactRetained,
        residualScore: input.score,
        residualJustification: input.justification,
        appetiteThresholdSuggested: input.appetiteThresholdSuggested,
        appetiteThresholdOverride: input.appetiteThresholdOverride,
        appetiteThresholdApplied: input.appetiteThresholdApplied,
        appetiteExceeded: input.appetiteExceeded,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async recordValidation(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        status: "VALIDATED",
        validatedBy,
        validatedAt: new Date(),
        comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async recordRejection(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        status: "REJECTED",
        validatedBy,
        validatedAt: new Date(),
        comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async recordCommitteeValidation(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = {
        ...existing,
        status: "VALIDE_COMITE",
        validatedBy,
        validatedAt: new Date(),
        comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
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
    async list(tenantId) {
      return risks.filter((r) => r.tenantId === tenantId);
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

function inMemoryRiskAppetiteRepository(appetites: RiskAppetite[]): RiskAppetiteRepository {
  return {
    async getById(tenantId, id) {
      return appetites.find((a) => a.tenantId === tenantId && a.id === id) ?? null;
    },
    async getBySubCategory(tenantId, subCategory, entity) {
      return (
        appetites.find(
          (a) => a.tenantId === tenantId && a.subCategory === subCategory && (a.entity ?? null) === (entity ?? null),
        ) ?? null
      );
    },
    async list(tenantId) {
      return appetites.filter((a) => a.tenantId === tenantId);
    },
    async upsert() {
      throw new Error("not implemented");
    },
    async softDelete() {
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
    async listRecent() {
      return [];
    },
  };
}

// ---------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

const risk: Risk = {
  id: "risk-1",
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
};

function buildActiveRatingScale(id = "scale-1"): RatingScale {
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
    criticalityThresholds: null,
    impactAxes: {
      axes: [
        { code: "FINANCIAL", label: "Financier", order: 1 },
        { code: "CUSTOMER", label: "Client", order: 2 },
        { code: "OPERATIONAL", label: "Opérationnel", order: 3 },
      ],
      retainedImpactRule: "MAX",
    },
    velocityLevels: null,
    persistenceLevels: null,
    masteryScale: {
      levels: [
        { level: 1, label: "Inadéquat" },
        { level: 2, label: "Partiellement adéquat" },
        { level: 3, label: "Adéquat" },
      ],
      defenseLines: ["L1", "L2", "L3"],
      aggregation: "AVERAGE",
      thresholds: null,
    },
    activatedAt: new Date(),
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  };
}

const evaluatorActor: AuthenticatedUser = {
  userId: "user-evaluator",
  tenantId: TENANT,
  email: "evaluator@djamo.example",
  displayName: "Evaluator",
  roles: ["riskevaluation.read", "riskevaluation.create", "riskevaluation.update"],
};

const validatorActor: AuthenticatedUser = {
  ...evaluatorActor,
  userId: "user-validator",
  roles: ["riskevaluation.read", "riskevaluation.validate"],
};

const readOnlyActor: AuthenticatedUser = { ...evaluatorActor, userId: "user-readonly", roles: ["riskevaluation.read"] };

const IMPACTS_LOW = [
  { code: "FINANCIAL", value: 1 },
  { code: "CUSTOMER", value: 2 },
  { code: "OPERATIONAL", value: 1 },
];

const MASTERY_LINES_GOOD = [
  { line: "L1", adequacy: 3, execution: 3, effectiveness: 3 },
  { line: "L2", adequacy: 2, execution: 2, effectiveness: 2 },
  { line: "L3", adequacy: 2, execution: 2, effectiveness: 3 },
];

function newService(options?: { appetites?: RiskAppetite[]; scales?: RatingScale[] }) {
  return {
    service: new RiskEvaluationService(
      inMemoryRiskEvaluationRepository(),
      inMemoryAuditRepository(),
      inMemoryRiskRepository([risk]),
      inMemoryRatingScaleRepository(options?.scales ?? [buildActiveRatingScale()]),
      inMemoryRiskAppetiteRepository(options?.appetites ?? []),
    ),
  };
}

async function createDraft(service: RiskEvaluationService) {
  return service.create(
    evaluatorActor,
    { riskId: risk.id, evaluationType: "AD_HOC", subCategory: "Fraude", entity: "CI" },
    "REQ-1",
  );
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

describe("RiskEvaluationService", () => {
  it("creates an evaluation in BROUILLON with the actor as evaluator (never client-supplied)", async () => {
    const { service } = newService();
    const evaluation = await createDraft(service);
    expect(evaluation.status).toBe("BROUILLON");
    expect(evaluation.evaluatorId).toBe(evaluatorActor.userId);
    expect(evaluation.riskId).toBe(risk.id);
  });

  it("rejects creation for a risk that does not exist in this tenant", async () => {
    const { service } = newService();
    await expect(
      service.create(evaluatorActor, { riskId: "nope", evaluationType: "AD_HOC", subCategory: "Fraude" }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects creation without riskevaluation.create permission", async () => {
    const { service } = newService();
    await expect(
      service.create(readOnlyActor, { riskId: risk.id, evaluationType: "AD_HOC", subCategory: "Fraude" }, "REQ-3"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("computes the inherent score server-side, ignoring any client-supplied score (ACT-151/ACT-154)", async () => {
    const { service } = newService();
    const draft = await createDraft(service);

    // The request type has no `score`/`impactRetained` field at all — this
    // asserts the computed values, proving the server derives them itself.
    const scored = await service.recordInherentScoring(
      evaluatorActor,
      draft.id,
      { probability: 3, impacts: IMPACTS_LOW },
      "REQ-4",
    );

    expect(scored.inherentImpactRetained).toBe(2); // MAX(1, 2, 1)
    expect(scored.inherentScore).toBe(6); // 3 x 2
    expect(scored.ratingScaleId).toBe("scale-1");
  });

  it("rejects an out-of-range probability", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await expect(
      service.recordInherentScoring(evaluatorActor, draft.id, { probability: 6, impacts: IMPACTS_LOW }, "REQ-5"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an inherent scoring with a missing/unknown impact axis", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await expect(
      service.recordInherentScoring(
        evaluatorActor,
        draft.id,
        { probability: 3, impacts: [{ code: "FINANCIAL", value: 1 }] },
        "REQ-6",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("requires inherent scoring before mastery assessment", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await expect(
      service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-7"),
    ).rejects.toThrow(ValidationError);
  });

  it("computes maîtrise globale as the average across all lines (ACT-152)", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-8");
    const scored = await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-9");

    // (3+3+3 + 2+2+2 + 2+2+3) / 9 = 22/9
    expect(scored.masteryGlobal).toBeCloseTo(22 / 9, 5);
  });

  it("rejects a mastery score outside the configured 1-3 bounds", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-10");
    await expect(
      service.recordMasteryAssessment(
        evaluatorActor,
        draft.id,
        { lines: [{ line: "L1", adequacy: 4, execution: 2, effectiveness: 2 }, ...MASTERY_LINES_GOOD.slice(1)] },
        "REQ-11",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("requires mastery assessment before residual scoring", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-12");
    await expect(
      service.recordResidualScoring(
        evaluatorActor,
        draft.id,
        { probability: 2, impacts: IMPACTS_LOW, justification: "Post-maîtrise" },
        "REQ-13",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("requires a justification for residual scoring", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-14");
    await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-15");
    await expect(
      service.recordResidualScoring(
        evaluatorActor,
        draft.id,
        { probability: 2, impacts: IMPACTS_LOW, justification: "  " },
        "REQ-16",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("computes the residual score server-side and auto-suggests the appetite threshold (ACT-153/154/155)", async () => {
    const appetite: RiskAppetite = {
      id: "appetite-1",
      tenantId: TENANT,
      subCategory: "Fraude",
      entity: "CI",
      threshold: 10,
      methodologyVersion: "2026.1",
      description: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deletedBy: null,
      deletionReason: null,
    };
    const { service } = newService({ appetites: [appetite] });
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-17");
    await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-18");

    const scored = await service.recordResidualScoring(
      evaluatorActor,
      draft.id,
      { probability: 2, impacts: IMPACTS_LOW, justification: "Post-maîtrise" },
      "REQ-19",
    );

    expect(scored.residualImpactRetained).toBe(2);
    expect(scored.residualScore).toBe(4); // 2 x 2
    expect(scored.appetiteThresholdSuggested).toBe(10);
    expect(scored.appetiteThresholdOverride).toBeNull();
    expect(scored.appetiteThresholdApplied).toBe(10);
    expect(scored.appetiteExceeded).toBe(false); // 4 <= 10

    const comparison = await service.compareToAppetite(evaluatorActor, draft.id);
    expect(comparison.source).toBe("AUTO");
    expect(comparison.exceeded).toBe(false);
  });

  it("stores an evaluator override of the suggested appetite threshold without blocking it (ACT-155)", async () => {
    const appetite: RiskAppetite = {
      id: "appetite-1",
      tenantId: TENANT,
      subCategory: "Fraude",
      entity: "CI",
      threshold: 3,
      methodologyVersion: "2026.1",
      description: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deletedBy: null,
      deletionReason: null,
    };
    const { service } = newService({ appetites: [appetite] });
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-20");
    await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-21");

    // Suggested threshold (3) would be exceeded by score 4, but the
    // evaluator overrides it to 20 — stored, not blocked.
    const scored = await service.recordResidualScoring(
      evaluatorActor,
      draft.id,
      { probability: 2, impacts: IMPACTS_LOW, justification: "Override justifié", appetiteOverride: 20 },
      "REQ-22",
    );

    expect(scored.appetiteThresholdSuggested).toBe(3);
    expect(scored.appetiteThresholdOverride).toBe(20);
    expect(scored.appetiteThresholdApplied).toBe(20);
    expect(scored.appetiteExceeded).toBe(false); // 4 <= 20, using the override
  });

  it("flags an appetite breach when the residual score exceeds the applicable threshold (ACT-160)", async () => {
    const appetite: RiskAppetite = {
      id: "appetite-1",
      tenantId: TENANT,
      subCategory: "Fraude",
      entity: "CI",
      threshold: 3,
      methodologyVersion: "2026.1",
      description: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      deletedBy: null,
      deletionReason: null,
    };
    const { service } = newService({ appetites: [appetite] });
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-23");
    await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-24");
    await service.recordResidualScoring(
      evaluatorActor,
      draft.id,
      { probability: 2, impacts: IMPACTS_LOW, justification: "Post-maîtrise" },
      "REQ-25",
    );

    const comparison = await service.compareToAppetite(evaluatorActor, draft.id);
    expect(comparison.exceeded).toBe(true); // 4 > 3
    expect(comparison.threshold).toBe(3);
  });

  it("refuses to compare vs-appetite before residual scoring is completed", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await expect(service.compareToAppetite(evaluatorActor, draft.id)).rejects.toThrow(ValidationError);
  });

  // -- Maker-checker / validate / reject -----------------------------

  async function fullyScoredDraft(service: RiskEvaluationService) {
    const draft = await createDraft(service);
    await service.recordInherentScoring(evaluatorActor, draft.id, { probability: 3, impacts: IMPACTS_LOW }, "REQ-A");
    await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: MASTERY_LINES_GOOD }, "REQ-B");
    return service.recordResidualScoring(
      evaluatorActor,
      draft.id,
      { probability: 2, impacts: IMPACTS_LOW, justification: "Post-maîtrise" },
      "REQ-C",
    );
  }

  it("rejects self-validation: the evaluator cannot validate their own evaluation (maker-checker)", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await expect(service.validate(evaluatorActor, scored.id, "OK", "REQ-D")).rejects.toThrow(ForbiddenError);
  });

  it("rejects self-rejection: the evaluator cannot reject their own evaluation either", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await expect(service.reject(evaluatorActor, scored.id, "Not good enough", "REQ-E")).rejects.toThrow(ForbiddenError);
  });

  it("validates an evaluation when the validator differs from the evaluator", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    const validated = await service.validate(validatorActor, scored.id, "Looks good", "REQ-F");
    expect(validated.status).toBe("VALIDATED");
    expect(validated.validatedBy).toBe(validatorActor.userId);
  });

  it("refuses to validate before residual scoring is completed", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    await expect(service.validate(validatorActor, draft.id, null, "REQ-G")).rejects.toThrow(ValidationError);
  });

  it("requires a mandatory comment to reject (ACT-157)", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await expect(service.reject(validatorActor, scored.id, "", "REQ-H")).rejects.toThrow(ValidationError);
  });

  it("rejects an evaluation with a comment, moving it to REJECTED", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    const rejected = await service.reject(validatorActor, scored.id, "Missing evidence", "REQ-I");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.comment).toBe("Missing evidence");
  });

  it("is immutable after validation: a further setter call throws", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await service.validate(validatorActor, scored.id, null, "REQ-J");

    await expect(
      service.recordResidualScoring(
        evaluatorActor,
        scored.id,
        { probability: 1, impacts: IMPACTS_LOW, justification: "trying to sneak an edit in" },
        "REQ-K",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("is immutable after rejection: a further setter call throws", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await service.reject(validatorActor, scored.id, "Redo it", "REQ-L");

    await expect(
      service.recordInherentScoring(evaluatorActor, scored.id, { probability: 1, impacts: IMPACTS_LOW }, "REQ-M"),
    ).rejects.toThrow(ValidationError);
  });

  it("cannot validate/reject an already-finalized evaluation a second time", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await service.validate(validatorActor, scored.id, null, "REQ-N");
    await expect(service.validate(validatorActor, scored.id, null, "REQ-O")).rejects.toThrow(ValidationError);
    await expect(service.reject(validatorActor, scored.id, "too late", "REQ-P")).rejects.toThrow(ValidationError);
  });

  // -- Tenant scoping --------------------------------------------------

  it("scopes evaluations by tenant: another tenant's actor cannot read it", async () => {
    const { service } = newService();
    const draft = await createDraft(service);
    const otherTenantActor: AuthenticatedUser = { ...evaluatorActor, tenantId: OTHER_TENANT };
    await expect(service.get(otherTenantActor, draft.id)).rejects.toThrow();
  });

  it("scopes listForRisk by tenant", async () => {
    const { service } = newService();
    await createDraft(service);
    const otherTenantActor: AuthenticatedUser = { ...evaluatorActor, tenantId: OTHER_TENANT };
    // Different tenant, same riskId string — must not leak tenant-1's rows,
    // and since the risk doesn't exist for tenant-2 either, it's rejected
    // before ever reaching the repository.
    await expect(service.listForRisk(otherTenantActor, risk.id)).rejects.toThrow(ValidationError);
  });

  it("lists the full evaluation history for a risk, most recent first (ACT-159)", async () => {
    const { service } = newService();
    await createDraft(service);
    await createDraft(service);
    const history = await service.listForRisk(evaluatorActor, risk.id);
    expect(history).toHaveLength(2);
  });

  it("filters evaluation history by status (ACT-159)", async () => {
    const { service } = newService();
    const scored = await fullyScoredDraft(service);
    await service.validate(validatorActor, scored.id, null, "REQ-Q");
    await createDraft(service); // a second, still-BROUILLON evaluation

    const validatedOnly = await service.listForRisk(evaluatorActor, risk.id, { status: "VALIDATED" });
    expect(validatedOnly).toHaveLength(1);
    expect(validatedOnly[0]?.status).toBe("VALIDATED");
  });
});
