import type { ControlEffectivenessRepository } from "../domain/repositories/ControlEffectivenessRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type {
  ControlEffectivenessAssessment,
  CreateEffectivenessAssessmentInput,
} from "../domain/entities/ControlEffectivenessAssessment.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import { checkSelfValidation, type SelfValidationGate } from "./SelfValidationGate.js";
import type { GovernanceConfirmation } from "../domain/governance/selfValidation.js";

/**
 * Rules ported from apps-script-legacy/13_Efficacite.gs: append-only,
 * distinct from ControlExecution ("l'exécution dit si le contrôle a été
 * fait, cette feuille dit s'il est bien conçu et efficace"),
 * operationalEffectiveness + justification are mandatory ("exécuté ne
 * veut pas dire efficace"), and validation is the same maker-checker
 * circuit as ControlExecutionService.
 */
export class ControlEffectivenessService {
  constructor(
    private readonly assessments: ControlEffectivenessRepository,
    private readonly controls: ControlRepository,
    private readonly audit: AuditRepository,
    /** DECISION-074 D4: optional; without it a self-validation is refused as before. Wired in server.ts. */
    private readonly selfValidation?: SelfValidationGate,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateEffectivenessAssessmentInput, "tenantId" | "evaluatedBy">,
    requestId: string,
  ): Promise<ControlEffectivenessAssessment> {
    requirePermission(actor, "effectiveness.create");

    const control = await this.controls.getById(actor.tenantId, input.controlId);
    if (!control) throw new ValidationError(`Control ${input.controlId} does not exist in this tenant`);

    if (!input.justification.trim()) {
      throw new ValidationError("A justification is required for every effectiveness assessment");
    }

    const assessment = await this.assessments.create({
      ...input,
      tenantId: actor.tenantId,
      evaluatedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ControlEffectivenessAssessment",
      entityId: assessment.id,
      action: "CREATE",
      oldValue: null,
      newValue: assessment,
      reason: null,
      requestId,
    });

    return assessment;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ControlEffectivenessAssessment> {
    requirePermission(actor, "effectiveness.read");
    const assessment = await this.assessments.getById(actor.tenantId, id);
    if (!assessment) throw new NotFoundError("ControlEffectivenessAssessment", id);
    return assessment;
  }

  async listForControl(actor: AuthenticatedUser, controlId: string): Promise<ControlEffectivenessAssessment[]> {
    requirePermission(actor, "effectiveness.read");
    return this.assessments.listForControl(actor.tenantId, controlId);
  }

  async validate(
    actor: AuthenticatedUser,
    id: string,
    comment: string | null,
    requestId: string,
    confirmation?: GovernanceConfirmation,
  ): Promise<ControlEffectivenessAssessment> {
    requirePermission(actor, "effectiveness.validate");
    const before = await this.get(actor, id);

    const selfValidated = await checkSelfValidation(this.selfValidation, actor, {
      isSelf: before.evaluatedBy === actor.userId,
      permission: "effectiveness.validate",
      makerIds: [before.evaluatedBy],
      refusal: "An evaluator cannot validate their own assessment",
      confirmation,
    });
    if (before.validatedAt) {
      throw new ValidationError("This assessment has already been validated");
    }

    const after = await this.assessments.recordValidation(actor.tenantId, id, actor.userId, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ControlEffectivenessAssessment",
      entityId: id,
      action: "VALIDATE",
      oldValue: before,
      newValue: selfValidated ? { ...after, ...selfValidated.newValueExtra } : after,
      reason: comment,
      requestId,
      ...(selfValidated ? { governanceException: selfValidated.governanceException } : {}),
    });

    return after;
  }
}
