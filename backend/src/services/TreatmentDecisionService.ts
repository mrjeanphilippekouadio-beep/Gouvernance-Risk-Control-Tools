import type { TreatmentDecisionRepository } from "../domain/repositories/TreatmentDecisionRepository.js";
import type { RiskEvaluationRepository } from "../domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ConfigRepository } from "../domain/repositories/ConfigRepository.js";
import { AUTHORITATIVE_EVALUATION_STATUSES } from "../domain/entities/RiskEvaluation.js";
import { TREATMENT_OPTIONS, type ListTreatmentDecisionsOptions, type TreatmentDecision, type TreatmentOption } from "../domain/entities/TreatmentDecision.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface CreateTreatmentDecisionRequest {
  riskEvaluationId: string;
  option: TreatmentOption;
  justification: string;
}

/**
 * RISK_MANAGEMENT_V1_FINAL_DECISIONS.md §8/§12 (Lot B). See
 * TreatmentDecision.ts for the data-model rationale (OD-1/OD-2/OD-3).
 * Gates below are numbered G1-G9 to match the lot's mandate exactly —
 * see that document if a gate's rationale isn't obvious from its guard.
 */
export class TreatmentDecisionService {
  constructor(
    private readonly treatmentDecisions: TreatmentDecisionRepository,
    private readonly evaluations: RiskEvaluationRepository,
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
    /** OD-5: optional only to keep the constructor pattern consistent with RiskEvaluationService — if absent, validateByCommittee always fails closed (no threshold found). server.ts must wire the real repository for Committee validation to ever succeed. */
    private readonly configs?: ConfigRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: CreateTreatmentDecisionRequest, requestId: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.create");

    if (!input.riskEvaluationId?.trim()) throw new ValidationError("riskEvaluationId is required");
    if (!TREATMENT_OPTIONS.includes(input.option)) {
      throw new ValidationError(`option must be one of: ${TREATMENT_OPTIONS.join(", ")}`);
    }
    if (!input.justification?.trim()) throw new ValidationError("justification is required");

    const evaluation = await this.evaluations.getById(actor.tenantId, input.riskEvaluationId);
    if (!evaluation) throw new NotFoundError("RiskEvaluation", input.riskEvaluationId);

    // G1
    if (!AUTHORITATIVE_EVALUATION_STATUSES.includes(evaluation.status)) {
      throw new ValidationError(
        `A treatment decision can only be proposed against an evaluation in an authoritative status (${AUTHORITATIVE_EVALUATION_STATUSES.join(", ")}) — this evaluation is ${evaluation.status}`,
      );
    }
    // G2
    if (actor.userId !== evaluation.evaluatorId) {
      throw new ForbiddenError("Only the designated evaluator of the parent evaluation can propose a treatment decision");
    }

    const risk = await this.risks.getById(actor.tenantId, evaluation.riskId);
    if (!risk) throw new ValidationError(`Risk ${evaluation.riskId} does not exist in this tenant`);

    // G3 — fail-closed, mirrors RiskService.escalate.
    if (!risk.superiorOwnerId) {
      throw new ValidationError("This risk has no superior owner assigned — use assignSuperiorOwner first");
    }
    // G4 — the proposer can never be their own validator.
    if (risk.superiorOwnerId === actor.userId) {
      throw new ForbiddenError("The proposing evaluator cannot also be the superior owner validating this treatment decision");
    }

    const decision = await this.treatmentDecisions.create({
      tenantId: actor.tenantId,
      riskEvaluationId: evaluation.id,
      riskId: risk.id,
      option: input.option,
      justification: input.justification.trim(),
      // Snapshot (OD-2) — never re-derived from Risk after this point.
      validatorId: risk.superiorOwnerId,
      // Never client-supplied.
      decidedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "TreatmentDecision",
      entityId: decision.id,
      action: "CREATE",
      oldValue: null,
      newValue: decision,
      reason: null,
      requestId,
    });

    return decision;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.read");
    return this.getOrThrow(actor.tenantId, id);
  }

  async getForEvaluation(actor: AuthenticatedUser, riskEvaluationId: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.read");
    const decision = await this.treatmentDecisions.getForEvaluation(actor.tenantId, riskEvaluationId);
    if (!decision) throw new NotFoundError("TreatmentDecision", riskEvaluationId);
    return decision;
  }

  async listForRisk(actor: AuthenticatedUser, riskId: string, options?: ListTreatmentDecisionsOptions): Promise<TreatmentDecision[]> {
    requirePermission(actor, "treatmentdecision.read");
    return this.treatmentDecisions.listForRisk(actor.tenantId, riskId, options);
  }

  /** Ordinary maker-checker outcome: the snapshotted validator confirms the proposed option. Terminal. */
  async confirm(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.validate");
    const before = await this.getOrThrow(actor.tenantId, id);
    this.assertIsValidator(actor, before);
    this.assertProposed(before);

    const after = await this.treatmentDecisions.recordConfirmation(actor.tenantId, id, actor.userId, comment);
    await this.recordAudit(actor, id, before, after, "VALIDATE", comment, requestId);
    return after;
  }

  /** Ordinary maker-checker outcome: the snapshotted validator rejects the proposed option. Terminal, mandatory comment (G7). */
  async invalidate(actor: AuthenticatedUser, id: string, comment: string, requestId: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.validate");
    const before = await this.getOrThrow(actor.tenantId, id);
    this.assertIsValidator(actor, before);
    this.assertProposed(before);
    if (!comment?.trim()) throw new ValidationError("A comment is required to invalidate a treatment decision");

    const after = await this.treatmentDecisions.recordInvalidation(actor.tenantId, id, actor.userId, comment);
    await this.recordAudit(actor, id, before, after, "REJECT", comment, requestId);
    return after;
  }

  /**
   * ACT/RISK_MANAGEMENT_V1 §8 (Lot B): Comité pass-through for the
   * Treatment Decision, gated by its own permission
   * (treatmentdecision.validate.committee — never treatmentdecision.validate).
   * OD-5: fail-closed if no committee threshold is configured yet.
   */
  async validateByCommittee(actor: AuthenticatedUser, id: string, comment: string | null, requestId: string): Promise<TreatmentDecision> {
    requirePermission(actor, "treatmentdecision.validate.committee");
    const before = await this.getOrThrow(actor.tenantId, id);
    this.assertProposed(before);
    // G4-bis (E-11): the proposer can never validate their own decision
    // through the committee path either — same maker-checker invariant
    // as G4 on the ordinary path, closed after dev-backend flagged the
    // asymmetry rather than silently deciding either way.
    if (actor.userId === before.decidedBy) {
      throw new ForbiddenError("The proposer of a treatment decision cannot validate it through the committee path either");
    }

    const minScore = await this.resolveCommitteeTreatmentMinScore(actor.tenantId);
    if (minScore === null) {
      throw new ValidationError("No committee threshold is configured for treatment decisions yet — set Config.committeeTreatmentMinScore first");
    }

    const evaluation = await this.evaluations.getById(actor.tenantId, before.riskEvaluationId);
    if (!evaluation || evaluation.residualScore === null) {
      throw new ValidationError("The parent risk evaluation has no residual score recorded");
    }
    if (evaluation.residualScore < minScore) {
      throw new ValidationError(
        `Committee validation only applies to treatment decisions whose parent evaluation scored at or above the committee threshold (${minScore}) (this evaluation scored ${evaluation.residualScore})`,
      );
    }

    const after = await this.treatmentDecisions.recordCommitteeValidation(actor.tenantId, id, actor.userId, comment);
    await this.recordAudit(actor, id, before, after, "VALIDATE", comment, requestId);
    return after;
  }

  private async getOrThrow(tenantId: string, id: string): Promise<TreatmentDecision> {
    const decision = await this.treatmentDecisions.getById(tenantId, id);
    if (!decision) throw new NotFoundError("TreatmentDecision", id);
    return decision;
  }

  // G5 — the validator is always the snapshot (decision.validatorId), never a re-derived Risk.superiorOwnerId.
  private assertIsValidator(actor: AuthenticatedUser, decision: TreatmentDecision): void {
    if (actor.userId !== decision.validatorId) {
      throw new ForbiddenError("Only the designated validator (snapshotted superior owner) can validate this treatment decision");
    }
  }

  // G6 — a single terminal transition, once.
  private assertProposed(decision: TreatmentDecision): void {
    if (decision.status !== "PROPOSEE") {
      throw new ValidationError(`This treatment decision has already been finalized (${decision.status})`);
    }
  }

  // G8 — OD-5 fail-closed: null means "not configured", never a permissive numeric default.
  private async resolveCommitteeTreatmentMinScore(tenantId: string): Promise<number | null> {
    if (!this.configs) return null;
    const config = await this.configs.getByTenant(tenantId);
    return config?.committeeTreatmentMinScore ?? null;
  }

  private async recordAudit(
    actor: AuthenticatedUser,
    id: string,
    before: TreatmentDecision,
    after: TreatmentDecision,
    action: "VALIDATE" | "REJECT",
    reason: string | null,
    requestId: string,
  ): Promise<void> {
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "TreatmentDecision",
      entityId: id,
      action,
      oldValue: before,
      newValue: after,
      reason,
      requestId,
    });
  }
}
