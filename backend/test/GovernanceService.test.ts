import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { GovernanceService } from "../src/services/GovernanceService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import type { ReviewCycleRepository } from "../src/domain/repositories/ReviewCycleRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { ReviewCycle } from "../src/domain/entities/ReviewCycle.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../src/infrastructure/notifications/Notifier.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

function inMemoryReviewCycleRepository(): ReviewCycleRepository {
  const store = new Map<string, ReviewCycle>();
  return {
    async getById(tenantId, id) {
      const c = store.get(id);
      return c && c.tenantId === tenantId ? c : null;
    },
    async list(tenantId, options) {
      return [...store.values()]
        .filter((c) => c.tenantId === tenantId)
        .filter((c) => !options?.status || c.status === options.status)
        .filter((c) => !options?.type || c.type === options.type)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async create(input) {
      const cycle: ReviewCycle = {
        id: randomUUID(),
        tenantId: input.tenantId,
        type: input.type,
        title: input.title,
        scope: input.scope,
        reason: input.reason,
        status: "OUVERT",
        createdBy: input.createdBy,
        proposedClosureBy: null,
        proposedClosureAt: null,
        proposedClosureComment: null,
        closedBy: null,
        closedAt: null,
        closureComment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(cycle.id, cycle);
      return cycle;
    },
    async proposeClosure(tenantId, id, proposedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: ReviewCycle = {
        ...existing,
        status: "CLOTURE_PROPOSEE",
        proposedClosureBy: proposedBy,
        proposedClosureAt: new Date(),
        proposedClosureComment: comment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async close(tenantId, id, closedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: ReviewCycle = {
        ...existing,
        status: "CLOTUREE",
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

function fakeNotifier(): Notifier & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    async notify(message) {
      messages.push(message);
    },
  };
}

// ---------------------------------------------------------------------
// Fixtures — Governance
// ---------------------------------------------------------------------

const TENANT = "tenant-1";
const OTHER_TENANT = "tenant-2";

const riskManagerActor: AuthenticatedUser = {
  userId: "user-riskmanager",
  tenantId: TENANT,
  email: "riskmanager@djamo.example",
  displayName: "Risk Manager",
  roles: ["governance.read", "governance.create"],
};

const directionActor: AuthenticatedUser = {
  ...riskManagerActor,
  userId: "user-direction",
  roles: ["governance.read", "governance.validate"],
};

const readOnlyActor: AuthenticatedUser = { ...riskManagerActor, userId: "user-readonly", roles: ["governance.read"] };

function newGovernanceService(notifier?: Notifier) {
  return new GovernanceService(inMemoryReviewCycleRepository(), inMemoryAuditRepository(), notifier);
}

describe("GovernanceService — create (ACT-250/251)", () => {
  it("creates an ANNUELLE review cycle in OUVERT status", async () => {
    const service = newGovernanceService();
    const cycle = await service.create(riskManagerActor, { type: "ANNUELLE", title: "Revue annuelle 2026" }, "REQ-1");
    expect(cycle.status).toBe("OUVERT");
    expect(cycle.type).toBe("ANNUELLE");
    expect(cycle.reason).toBeNull();
  });

  it("requires governance.create permission", async () => {
    const service = newGovernanceService();
    await expect(
      service.create(readOnlyActor, { type: "ANNUELLE", title: "Revue annuelle 2026" }, "REQ-2"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("notifies best-effort via the injected Notifier at creation", async () => {
    const notifier = fakeNotifier();
    const service = newGovernanceService(notifier);
    await service.create(riskManagerActor, { type: "ANNUELLE", title: "Revue annuelle 2026" }, "REQ-3");
    // Best-effort notify is fire-and-forget (not awaited) — flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notifier.messages).toHaveLength(1);
  });

  it("creation never fails even if the Notifier throws (best-effort)", async () => {
    const brokenNotifier: Notifier = { async notify() { throw new Error("channel down"); } };
    const service = newGovernanceService(brokenNotifier);
    await expect(service.create(riskManagerActor, { type: "ANNUELLE", title: "Revue annuelle 2026" }, "REQ-4")).resolves.toBeTruthy();
  });

  it("requires a mandatory reason for ANTICIPEE (ACT-251)", async () => {
    const service = newGovernanceService();
    await expect(
      service.create(riskManagerActor, { type: "ANTICIPEE", title: "Revue suite incident" }, "REQ-5"),
    ).rejects.toThrow(ValidationError);
  });

  it("creates an ANTICIPEE review cycle when a reason is provided", async () => {
    const service = newGovernanceService();
    const cycle = await service.create(
      riskManagerActor,
      { type: "ANTICIPEE", title: "Revue suite incident", reason: "Incident majeur sur les paiements" },
      "REQ-6",
    );
    expect(cycle.type).toBe("ANTICIPEE");
    expect(cycle.reason).toBe("Incident majeur sur les paiements");
  });

  it("rejects an unknown type", async () => {
    const service = newGovernanceService();
    await expect(
      // @ts-expect-error deliberately invalid for the test
      service.create(riskManagerActor, { type: "MENSUELLE", title: "x" }, "REQ-7"),
    ).rejects.toThrow(ValidationError);
  });
});

describe("GovernanceService — closure maker-checker (ACT-252)", () => {
  async function openCycle(service: GovernanceService) {
    return service.create(riskManagerActor, { type: "ANNUELLE", title: "Revue annuelle 2026" }, "REQ-A");
  }

  it("Risk Manager proposes closure, moving status to CLOTURE_PROPOSEE", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    const proposed = await service.proposeClosure(riskManagerActor, cycle.id, "Toutes les revues sont faites", "REQ-B");
    expect(proposed.status).toBe("CLOTURE_PROPOSEE");
    expect(proposed.proposedClosureBy).toBe(riskManagerActor.userId);
  });

  it("Direction validates and closes, moving status to CLOTUREE", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-C");
    const closed = await service.close(directionActor, cycle.id, "Validé", "REQ-D");
    expect(closed.status).toBe("CLOTUREE");
    expect(closed.closedBy).toBe(directionActor.userId);
  });

  it("rejects closing a cycle with no pending closure proposal", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await expect(service.close(directionActor, cycle.id, null, "REQ-E")).rejects.toThrow(ValidationError);
  });

  it("rejects proposing closure twice / on an already-proposed cycle", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-F");
    await expect(service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-G")).rejects.toThrow(ValidationError);
  });

  it("maker-checker: the proposer cannot also be the closer", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-H");

    const riskManagerWithValidatePerm: AuthenticatedUser = { ...riskManagerActor, roles: [...riskManagerActor.roles, "governance.validate"] };
    await expect(service.close(riskManagerWithValidatePerm, cycle.id, null, "REQ-I")).rejects.toThrow(ForbiddenError);
  });

  it("requires governance.validate permission to close", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-J");
    await expect(service.close(readOnlyActor, cycle.id, null, "REQ-K")).rejects.toThrow(ForbiddenError);
  });

  it("is terminal: cannot close an already-closed cycle again", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    await service.proposeClosure(riskManagerActor, cycle.id, null, "REQ-L");
    await service.close(directionActor, cycle.id, null, "REQ-M");
    await expect(service.close(directionActor, cycle.id, null, "REQ-N")).rejects.toThrow(ValidationError);
  });

  it("scopes review cycles by tenant", async () => {
    const service = newGovernanceService();
    const cycle = await openCycle(service);
    const otherTenantActor: AuthenticatedUser = { ...riskManagerActor, tenantId: OTHER_TENANT };
    await expect(service.get(otherTenantActor, cycle.id)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------
// ACT-253: RiskEvaluationService.validateByCommittee (additive)
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
      const updated: RiskEvaluation = { ...existing, masteryLines: input.lines, masteryGlobal: input.masteryGlobal, updatedAt: new Date() };
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
      const updated: RiskEvaluation = { ...existing, status: "VALIDATED", validatedBy, validatedAt: new Date(), comment, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async recordRejection(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: RiskEvaluation = { ...existing, status: "REJECTED", validatedBy, validatedAt: new Date(), comment, updatedAt: new Date() };
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
    async existsForRatingScale(tenantId, ratingScaleId) {
      return [...store.values()].some((e) => e.tenantId === tenantId && e.ratingScaleId === ratingScaleId);
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

const risk: Risk = {
  id: "risk-1",
  tenantId: TENANT,
  process: "Payments",
  description: "Fraud on instant transfers",
  ownerDepartmentId: null,
  ownerId: null,
  superiorOwnerId: null,
  status: "ACTIVE",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  deletedBy: null,
  deletionReason: null,
};

function buildActiveRatingScale(): RatingScale {
  return {
    id: "scale-1",
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
      axes: [{ code: "FINANCIAL", label: "Financier", order: 1 }],
      retainedImpactRule: "MAX",
    },
    velocityLevels: null,
    persistenceLevels: null,
    masteryScale: {
      levels: [{ level: 1, label: "Inadéquat" }, { level: 2, label: "Adéquat" }],
      defenseLines: ["L1"],
      aggregation: "MIN",
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

const committeeActor: AuthenticatedUser = {
  ...evaluatorActor,
  userId: "user-committee",
  roles: ["riskevaluation.read", "riskevaluation.validate.committee"],
};

function newRiskEvaluationService() {
  return new RiskEvaluationService(
    inMemoryRiskEvaluationRepository(),
    inMemoryAuditRepository(),
    inMemoryRiskRepository([risk]),
    inMemoryRatingScaleRepository([buildActiveRatingScale()]),
  );
}

async function scoreToLevel(service: RiskEvaluationService, probability: number, impactValue: number) {
  const draft = await service.create(evaluatorActor, { riskId: risk.id, evaluationType: "AD_HOC", subCategory: "Fraude" }, "REQ-X");
  await service.recordInherentScoring(evaluatorActor, draft.id, { probability, impacts: [{ code: "FINANCIAL", value: impactValue }] }, "REQ-Y");
  await service.recordMasteryAssessment(evaluatorActor, draft.id, { lines: [{ line: "L1", adequacy: 2, execution: 2, effectiveness: 2 }] }, "REQ-Z");
  return service.recordResidualScoring(
    evaluatorActor,
    draft.id,
    { probability, impacts: [{ code: "FINANCIAL", value: impactValue }], justification: "Post-maîtrise" },
    "REQ-W",
  );
}

describe("RiskEvaluationService.validateByCommittee (ACT-253, additive)", () => {
  it("validates a Majeur-band evaluation (score 15-19) via committee", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4); // 16 — Majeur
    expect(scored.residualScore).toBe(16);
    const validated = await service.validateByCommittee(committeeActor, scored.id, "Approuvé en comité", "REQ-1");
    expect(validated.status).toBe("VALIDE_COMITE");
    expect(validated.validatedBy).toBe(committeeActor.userId);
  });

  it("validates a Critique-band evaluation (score 20-25) via committee", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 5, 5); // 25 — Critique
    const validated = await service.validateByCommittee(committeeActor, scored.id, null, "REQ-2");
    expect(validated.status).toBe("VALIDE_COMITE");
  });

  it("rejects committee validation for a score below 15", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 2, 2); // 4 — well below Majeur
    await expect(service.validateByCommittee(committeeActor, scored.id, null, "REQ-3")).rejects.toThrow(ValidationError);
  });

  it("requires the distinct riskevaluation.validate.committee permission — riskevaluation.validate alone is not enough", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4);
    const validatorOnly: AuthenticatedUser = { ...evaluatorActor, userId: "user-validator", roles: ["riskevaluation.read", "riskevaluation.validate"] };
    await expect(service.validateByCommittee(validatorOnly, scored.id, null, "REQ-4")).rejects.toThrow(ForbiddenError);
  });

  it("rejects self-validation: the evaluator cannot committee-validate their own evaluation", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4);
    const evaluatorWithCommitteePerm: AuthenticatedUser = { ...evaluatorActor, roles: [...evaluatorActor.roles, "riskevaluation.validate.committee"] };
    await expect(service.validateByCommittee(evaluatorWithCommitteePerm, scored.id, null, "REQ-5")).rejects.toThrow(ForbiddenError);
  });

  it("is immutable afterwards: a further setter call throws, same as VALIDATED", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4);
    await service.validateByCommittee(committeeActor, scored.id, null, "REQ-6");
    await expect(
      service.recordResidualScoring(evaluatorActor, scored.id, { probability: 1, impacts: [{ code: "FINANCIAL", value: 1 }], justification: "sneak" }, "REQ-7"),
    ).rejects.toThrow(ValidationError);
  });

  it("cannot committee-validate an evaluation that is already finalized", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4);
    await service.validateByCommittee(committeeActor, scored.id, null, "REQ-8");
    await expect(service.validateByCommittee(committeeActor, scored.id, null, "REQ-9")).rejects.toThrow(ValidationError);
  });

  it("does not affect the existing validate()/reject() methods or their permission — plain VALIDATED still works", async () => {
    const service = newRiskEvaluationService();
    const scored = await scoreToLevel(service, 4, 4);
    const validatorOnly: AuthenticatedUser = { ...evaluatorActor, userId: "user-validator", roles: ["riskevaluation.read", "riskevaluation.validate"] };
    const validated = await service.validate(validatorOnly, scored.id, "OK", "REQ-10");
    expect(validated.status).toBe("VALIDATED");
  });
});
