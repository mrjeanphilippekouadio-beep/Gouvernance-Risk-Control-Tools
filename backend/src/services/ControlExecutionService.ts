import type { ControlExecutionRepository } from "../domain/repositories/ControlExecutionRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ControlExecution, CreateControlExecutionInput } from "../domain/entities/ControlExecution.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import { checkSelfValidation, type SelfValidationGate } from "./SelfValidationGate.js";
import type { GovernanceConfirmation } from "../domain/governance/selfValidation.js";

/**
 * Rules ported from apps-script-legacy/12_Executions.gs: append-only
 * (a new row per occurrence, never an update to the control), a
 * non-DONE execution must carry a justification, and validation is
 * maker-checker — the person who executed a control can never validate
 * their own execution (validateMakerChecker_ in the legacy code).
 */
export class ControlExecutionService {
  constructor(
    private readonly executions: ControlExecutionRepository,
    private readonly controls: ControlRepository,
    private readonly audit: AuditRepository,
    /** DECISION-074 D4: optional; without it a self-validation is refused as before. Wired in server.ts. */
    private readonly selfValidation?: SelfValidationGate,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateControlExecutionInput, "tenantId" | "executedBy">,
    requestId: string,
  ): Promise<ControlExecution> {
    requirePermission(actor, "execution.create");

    const control = await this.controls.getById(actor.tenantId, input.controlId);
    if (!control) throw new ValidationError(`Control ${input.controlId} does not exist in this tenant`);

    if (input.status !== "DONE" && !input.justificationIfNotDone?.trim()) {
      throw new ValidationError(
        "A non-completed or not-applicable execution must be justified (justificationIfNotDone)",
      );
    }

    // SEC-001: executedBy must always be the actor, never client-supplied —
    // otherwise one user can attribute an execution to a colleague and then
    // validate it themselves, defeating maker-checker (before.executedBy ===
    // actor.userId in validate() would never fire).
    const execution = await this.executions.create({
      ...input,
      tenantId: actor.tenantId,
      executedBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ControlExecution",
      entityId: execution.id,
      action: "CREATE",
      oldValue: null,
      newValue: execution,
      reason: null,
      requestId,
    });

    return execution;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<ControlExecution> {
    requirePermission(actor, "execution.read");
    const execution = await this.executions.getById(actor.tenantId, id);
    if (!execution) throw new NotFoundError("ControlExecution", id);
    return execution;
  }

  async listForControl(actor: AuthenticatedUser, controlId: string): Promise<ControlExecution[]> {
    requirePermission(actor, "execution.read");
    return this.executions.listForControl(actor.tenantId, controlId);
  }

  async validate(
    actor: AuthenticatedUser,
    id: string,
    comment: string | null,
    requestId: string,
    confirmation?: GovernanceConfirmation,
  ): Promise<ControlExecution> {
    requirePermission(actor, "execution.validate");
    const before = await this.get(actor, id);

    if (before.validatedAt) {
      throw new ValidationError("This execution has already been validated");
    }

    const selfValidated = await checkSelfValidation(this.selfValidation, actor, {
      isSelf: before.executedBy === actor.userId,
      permission: "execution.validate",
      makerIds: [before.executedBy],
      refusal: "An executor cannot validate their own execution",
      confirmation,
    });

    const after = await this.executions.recordValidation(actor.tenantId, id, actor.userId, comment);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "ControlExecution",
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
