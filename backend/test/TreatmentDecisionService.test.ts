import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { TreatmentDecisionService } from "../src/services/TreatmentDecisionService.js";
import type { TreatmentDecisionRepository } from "../src/domain/repositories/TreatmentDecisionRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ConfigRepository } from "../src/domain/repositories/ConfigRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { TreatmentDecision } from "../src/domain/entities/TreatmentDecision.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------------------------------------------------------------------
// In-memory test doubles
// ---------------------------------------------------------------------

function inMemoryTreatmentDecisionRepository(): TreatmentDecisionRepository {
  const store = new Map<string, TreatmentDecision>();
  return {
    async getById(tenantId, id) {
      const d = store.get(id);
      return d && d.tenantId === tenantId ? d : null;
    },
    async getForEvaluation(tenantId, riskEvaluationId) {
      return (
        [...store.values()]
          .filter((d) => d.tenantId === tenantId && d.riskEvaluationId === riskEvaluationId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    },
    async listForRisk(tenantId, riskId, options) {
      return [...store.values()]
        .filter((d) => d.tenantId === tenantId && d.riskId === riskId)
        .filter((d) => !options?.status || d.status === options.status)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    async create(input) {
      const decision: TreatmentDecision = {
        id: randomUUID(),
        tenantId: input.tenantId,
        riskEvaluationId: input.riskEvaluationId,
        riskId: input.riskId,
        option: input.option,
        justification: input.justification,
        status: "PROPOSEE",
        validatorId: input.validatorId,
        decidedBy: input.decidedBy,
        validatedBy: null,
        validatedAt: null,
        comment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(decision.id, decision);
      return decision;
    },
    async recordConfirmation(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: TreatmentDecision = { ...existing, status: "CONFIRMEE", validatedBy, validatedAt: new Date(), comment, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async recordInvalidation(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: TreatmentDecision = { ...existing, status: "INVALIDEE", validatedBy, validatedAt: new Date(), comment, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async recordCommitteeValidation(tenantId, id, validatedBy, comment) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: TreatmentDecision = { ...existing, status: "VALIDEE_COMITE", validatedBy, validatedAt: new Date(), comment, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
  };
}

function inMemoryRiskEvaluationRepository(evaluations: RiskEvaluation[]): RiskEvaluationRepository {
  return {
    async getById(tenantId, id) {
      return evaluations.find((e) => e.tenantId === tenantId && e.id === id) ?? null;
    },
    async listForRisk() {
      return [];
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

function inMemoryConfigRepository(config: Config | null): ConfigRepository {
  return {
    async getByTenant(tenantId) {
      return config && config.tenantId === tenantId ? config : null;
    },
    async upsert() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryAuditRepository(): AuditRepository & { events: Omit<AuditEvent, "id" | "timestamp">[] } {
  const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
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
const OTHER_TENANT = "tenant-2";

function buildRisk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "risk-1",
    tenantId: TENANT,
    process: "Payments",
    processId: null,
    description: "Fraud on instant transfers",
    ownerDepartmentId: null,
    ownerId: "user-evaluator",
    superiorOwnerId: "user-superior",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function buildEvaluation(overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  return {
    id: "eval-1",
    tenantId: TENANT,
    riskId: "risk-1",
    evaluationType: "ANNUELLE",
    status: "VALIDATED",
    evaluatorId: "user-evaluator",
    subCategory: "Fraud",
    entity: null,
    evaluationMode: "CLASSIQUE",
    ratingScaleId: "scale-1",
    ratingScaleVersion: "2026.1",
    inherentProbability: 5,
    inherentImpacts: null,
    inherentImpactRetained: 5,
    inherentScore: 25,
    masteryLines: null,
    masteryGlobal: 2,
    residualProbability: 4,
    residualImpacts: null,
    residualImpactRetained: 5,
    residualScore: 20,
    residualJustification: "justification",
    appetiteThresholdSuggested: null,
    appetiteThresholdOverride: null,
    appetiteThresholdApplied: null,
    appetiteExceeded: true,
    validatedBy: "user-validator",
    validatedAt: new Date(),
    comment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildConfig(overrides: Partial<Config> = {}): Config {
  return {
    id: "config-1",
    tenantId: TENANT,
    scoreFormula: "P_X_I",
    levelThresholds: [],
    impactRetenuRule: "MAX",
    appetiteMode: "AUTO_AVEC_SURCHARGE_MANUELLE",
    evaluationMode: "CLASSIQUE",
    committeeEvaluationMinScore: 15,
    committeeTreatmentMinScore: null,
    committeeEvaluationEnforced: true,
    version: 1,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const evaluatorActor: AuthenticatedUser = {
  userId: "user-evaluator",
  tenantId: TENANT,
  email: "evaluator@djamo.example",
  displayName: "Evaluator",
  roles: ["treatmentdecision.read", "treatmentdecision.create", "treatmentdecision.validate", "treatmentdecision.validate.committee"],
};

const superiorActor: AuthenticatedUser = { ...evaluatorActor, userId: "user-superior" };

const otherUserActor: AuthenticatedUser = { ...evaluatorActor, userId: "user-other" };

function newService(options?: {
  risks?: Risk[];
  evaluations?: RiskEvaluation[];
  config?: Config | null;
  withConfigRepository?: boolean;
}) {
  const audit = inMemoryAuditRepository();
  const treatmentDecisions = inMemoryTreatmentDecisionRepository();
  return {
    audit,
    treatmentDecisions,
    service: new TreatmentDecisionService(
      treatmentDecisions,
      inMemoryRiskEvaluationRepository(options?.evaluations ?? [buildEvaluation()]),
      inMemoryRiskRepository(options?.risks ?? [buildRisk()]),
      audit,
      options?.withConfigRepository === false ? undefined : inMemoryConfigRepository(options?.config ?? null),
    ),
  };
}

const REQUEST_ID = "req-1";

describe("TreatmentDecisionService.create", () => {
  it("creates a decision when every gate passes (G1-G4), snapshotting validatorId/decidedBy server-side", async () => {
    const { service, audit } = newService();
    const decision = await service.create(
      evaluatorActor,
      { riskEvaluationId: "eval-1", option: "REDUIRE", justification: "Plan de réduction" },
      REQUEST_ID,
    );

    expect(decision.status).toBe("PROPOSEE");
    expect(decision.decidedBy).toBe("user-evaluator");
    expect(decision.validatorId).toBe("user-superior");
    expect(audit.events.at(-1)?.action).toBe("CREATE");
  });

  it("ignores client-supplied decidedBy/validatorId — always forces actor.userId / Risk.superiorOwnerId", async () => {
    const { service } = newService();
    const decision = await service.create(
      evaluatorActor,
      // @ts-expect-error — decidedBy/validatorId are not part of CreateTreatmentDecisionRequest; simulate a malicious client payload anyway.
      { riskEvaluationId: "eval-1", option: "REDUIRE", justification: "Plan", decidedBy: "attacker", validatorId: "attacker" },
      REQUEST_ID,
    );

    expect(decision.decidedBy).toBe("user-evaluator");
    expect(decision.validatorId).toBe("user-superior");
  });

  it("G1: rejects proposal when the parent evaluation is not in an authoritative status", async () => {
    const { service } = newService({ evaluations: [buildEvaluation({ status: "BROUILLON" })] });
    await expect(
      service.create(evaluatorActor, { riskEvaluationId: "eval-1", option: "ACCEPTER", justification: "x" }, REQUEST_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("G2: rejects proposal from someone other than the parent evaluation's evaluator", async () => {
    const { service } = newService();
    await expect(
      service.create(otherUserActor, { riskEvaluationId: "eval-1", option: "ACCEPTER", justification: "x" }, REQUEST_ID),
    ).rejects.toThrow(ForbiddenError);
  });

  it("G3: fails closed when the risk has no superior owner assigned", async () => {
    const { service } = newService({ risks: [buildRisk({ superiorOwnerId: null })] });
    await expect(
      service.create(evaluatorActor, { riskEvaluationId: "eval-1", option: "ACCEPTER", justification: "x" }, REQUEST_ID),
    ).rejects.toThrow(ValidationError);
  });

  it("G4: rejects proposal when the proposer is also the risk's superior owner", async () => {
    const { service } = newService({ risks: [buildRisk({ superiorOwnerId: "user-evaluator" })] });
    await expect(
      service.create(evaluatorActor, { riskEvaluationId: "eval-1", option: "ACCEPTER", justification: "x" }, REQUEST_ID),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an unknown option", async () => {
    const { service } = newService();
    await expect(
      service.create(
        evaluatorActor,
        // @ts-expect-error — exercising runtime validation of an invalid option value.
        { riskEvaluationId: "eval-1", option: "INVENTE", justification: "x" },
        REQUEST_ID,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

describe("TreatmentDecisionService.confirm / invalidate", () => {
  async function propose(service: TreatmentDecisionService) {
    return service.create(evaluatorActor, { riskEvaluationId: "eval-1", option: "SURVEILLER", justification: "x" }, REQUEST_ID);
  }

  it("confirms when the actor is the snapshotted validator (G5) and the decision is still PROPOSEE (G6)", async () => {
    const { service, audit } = newService();
    const decision = await propose(service);
    const after = await service.confirm(superiorActor, decision.id, "OK", REQUEST_ID);

    expect(after.status).toBe("CONFIRMEE");
    expect(after.validatedBy).toBe("user-superior");
    expect(audit.events.at(-1)?.action).toBe("VALIDATE");
  });

  it("G5: rejects confirmation from anyone other than the snapshotted validator, even with the permission", async () => {
    const { service } = newService();
    const decision = await propose(service);
    await expect(service.confirm(otherUserActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ForbiddenError);
  });

  it("the proposer can never confirm/invalidate their own proposal, even holding the permission", async () => {
    const { service } = newService();
    const decision = await propose(service);
    await expect(service.confirm(evaluatorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ForbiddenError);
    await expect(service.invalidate(evaluatorActor, decision.id, "non", REQUEST_ID)).rejects.toThrow(ForbiddenError);
  });

  it("invalidates with a mandatory comment (G7)", async () => {
    const { service, audit } = newService();
    const decision = await propose(service);
    const after = await service.invalidate(superiorActor, decision.id, "Pas suffisant", REQUEST_ID);

    expect(after.status).toBe("INVALIDEE");
    expect(audit.events.at(-1)?.action).toBe("REJECT");
  });

  it("G7: rejects invalidation without a comment", async () => {
    const { service } = newService();
    const decision = await propose(service);
    await expect(service.invalidate(superiorActor, decision.id, "   ", REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it("a confirmed decision is immutable — re-confirming or invalidating is rejected (G6)", async () => {
    const { service } = newService();
    const decision = await propose(service);
    await service.confirm(superiorActor, decision.id, null, REQUEST_ID);

    await expect(service.confirm(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
    await expect(service.invalidate(superiorActor, decision.id, "x", REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it("an invalidated decision is immutable — a retry is a brand-new row, never a re-transition (G6, OD-3)", async () => {
    const { service } = newService();
    const decision = await propose(service);
    await service.invalidate(superiorActor, decision.id, "non", REQUEST_ID);

    await expect(service.confirm(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);

    const retry = await propose(service);
    expect(retry.id).not.toBe(decision.id);
    expect(retry.status).toBe("PROPOSEE");
  });
});

describe("TreatmentDecisionService.validateByCommittee", () => {
  async function propose(service: TreatmentDecisionService) {
    return service.create(evaluatorActor, { riskEvaluationId: "eval-1", option: "TRANSFERER", justification: "x" }, REQUEST_ID);
  }

  it("G8: fails closed when no committee threshold is configured for treatment decisions", async () => {
    const { service } = newService({ config: buildConfig({ committeeTreatmentMinScore: null }) });
    const decision = await propose(service);
    await expect(service.validateByCommittee(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it("G8: fails closed when no ConfigRepository is wired at all", async () => {
    const { service } = newService({ withConfigRepository: false });
    const decision = await propose(service);
    await expect(service.validateByCommittee(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it("G9: rejects when the parent evaluation's residual score is below the configured threshold", async () => {
    const { service } = newService({
      config: buildConfig({ committeeTreatmentMinScore: 25 }),
      evaluations: [buildEvaluation({ residualScore: 20 })],
    });
    const decision = await propose(service);
    await expect(service.validateByCommittee(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
  });

  it("G4-bis (E-11): the proposer cannot validate their own decision through the committee path either, even holding the permission", async () => {
    const { service } = newService({
      config: buildConfig({ committeeTreatmentMinScore: 15 }),
      evaluations: [buildEvaluation({ residualScore: 20 })],
    });
    const decision = await propose(service);
    await expect(service.validateByCommittee(evaluatorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ForbiddenError);
  });

  it("validates via committee when the threshold is configured and the residual score clears it", async () => {
    const { service, audit } = newService({
      config: buildConfig({ committeeTreatmentMinScore: 15 }),
      evaluations: [buildEvaluation({ residualScore: 20 })],
    });
    const decision = await propose(service);
    const after = await service.validateByCommittee(superiorActor, decision.id, "Comité OK", REQUEST_ID);

    expect(after.status).toBe("VALIDEE_COMITE");
    expect(audit.events.at(-1)?.action).toBe("VALIDATE");
  });

  it("G6: a decision already validated by committee cannot be re-validated or confirmed", async () => {
    const { service } = newService({
      config: buildConfig({ committeeTreatmentMinScore: 15 }),
      evaluations: [buildEvaluation({ residualScore: 20 })],
    });
    const decision = await propose(service);
    await service.validateByCommittee(superiorActor, decision.id, null, REQUEST_ID);

    await expect(service.validateByCommittee(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
    await expect(service.confirm(superiorActor, decision.id, null, REQUEST_ID)).rejects.toThrow(ValidationError);
  });
});

describe("TreatmentDecisionService tenant scoping", () => {
  it("never returns a decision created in another tenant", async () => {
    const { service } = newService();
    const decision = await service.create(
      evaluatorActor,
      { riskEvaluationId: "eval-1", option: "EVITER", justification: "x" },
      REQUEST_ID,
    );

    const crossTenantActor: AuthenticatedUser = { ...evaluatorActor, tenantId: OTHER_TENANT };
    await expect(service.get(crossTenantActor, decision.id)).rejects.toThrow(NotFoundError);
  });
});
