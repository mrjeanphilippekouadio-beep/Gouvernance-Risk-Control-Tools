import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { Control, ControlStatus, CreateControlInput, UpdateControlInput } from "../domain/entities/Control.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Rules ported from apps-script-legacy/11_Controles.gs (validateControle_):
 * a control must be linked to at least one risk — "un risque doit avoir
 * au moins un contrôle, la réciproque est vraie" — and every field the
 * legacy sheet made mandatory stays mandatory here.
 */
export class ControlService {
  constructor(
    private readonly controls: ControlRepository,
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
    /**
     * DIV-05: optional so existing tests keep compiling, but if a caller
     * actually supplies `processId`, `assertProcessExists` throws rather
     * than silently skipping validation when this is unwired — same
     * pattern as RiskService.processes (SEC-012 lesson: never
     * `if (!this.x) return;` on a dependency the current call is
     * actually trying to use). server.ts must wire the real repository
     * for `processId` to ever be accepted.
     */
    private readonly processes?: ProcessRepository,
  ) {}

  async create(
    actor: AuthenticatedUser,
    input: Omit<CreateControlInput, "tenantId">,
    requestId: string,
  ): Promise<Control> {
    requirePermission(actor, "control.create");
    await this.validate(actor.tenantId, input);
    await this.assertProcessExists(actor.tenantId, input.processId);

    const control = await this.controls.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Control",
      entityId: control.id,
      action: "CREATE",
      oldValue: null,
      newValue: control,
      reason: null,
      requestId,
    });

    return control;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Control> {
    requirePermission(actor, "control.read");
    const control = await this.controls.getById(actor.tenantId, id);
    if (!control) throw new NotFoundError("Control", id);
    return control;
  }

  async list(actor: AuthenticatedUser, includeArchived = false): Promise<Control[]> {
    requirePermission(actor, "control.read");
    return this.controls.list(actor.tenantId, { includeArchived });
  }

  async listCoveringRisk(actor: AuthenticatedUser, riskId: string): Promise<Control[]> {
    requirePermission(actor, "control.read");
    return this.controls.listCoveringRisk(actor.tenantId, riskId);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    input: UpdateControlInput,
    requestId: string,
  ): Promise<Control> {
    requirePermission(actor, "control.update");
    const before = await this.get(actor, id);

    if (input.status) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError("Use the archive endpoint to archive a control (requires a reason)");
      }
      if (!isValidTransition(before.status, input.status)) {
        throw new ValidationError(`Cannot transition control from ${before.status} to ${input.status}`);
      }
    }
    if (input.coveredRiskIds !== undefined) {
      if (input.coveredRiskIds.length === 0) {
        throw new ValidationError(
          "A control must cover at least one risk (a risk must have at least one control, and vice versa)",
        );
      }
      await this.assertRisksExist(actor.tenantId, input.coveredRiskIds);
    }
    await this.assertProcessExists(actor.tenantId, input.processId);

    const after = await this.controls.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Control",
      entityId: id,
      action: input.status ? "STATUS_CHANGE" : "UPDATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async archive(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<void> {
    requirePermission(actor, "control.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a control");
    const before = await this.get(actor, id);

    await this.controls.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Control",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  private async validate(tenantId: string, input: Omit<CreateControlInput, "tenantId">): Promise<void> {
    if (!input.label.trim()) throw new ValidationError("label is required");
    if (input.coveredRiskIds.length === 0) {
      throw new ValidationError(
        "A control must cover at least one risk (a risk must have at least one control, and vice versa)",
      );
    }
    if (!input.frequency.trim()) throw new ValidationError("frequency is required");
    if (!input.executor.trim()) throw new ValidationError("executor is required");
    if (!input.complianceCriteria.trim()) throw new ValidationError("complianceCriteria is required");

    await this.assertRisksExist(tenantId, input.coveredRiskIds);
  }

  private async assertRisksExist(tenantId: string, riskIds: string[]): Promise<void> {
    const found = await this.risks.listByIds(tenantId, riskIds);
    const foundIds = new Set(found.map((r) => r.id));
    const missing = riskIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`Risk(s) do not exist in this tenant: ${missing.join(", ")}`);
    }
  }

  /**
   * DIV-05: a processId, if given, must belong to the caller's tenant.
   * Unlike a missing DepartmentRepository elsewhere in this codebase, a
   * missing ProcessRepository here does NOT silently skip validation
   * when a processId was actually supplied — see RiskService's
   * assertProcessExists for the same reasoning.
   */
  private async assertProcessExists(tenantId: string, processId: string | null | undefined): Promise<void> {
    if (processId === undefined || processId === null) return;
    if (!this.processes) {
      throw new ValidationError("Control process validation is not available: ProcessRepository is not configured");
    }
    const process = await this.processes.getById(tenantId, processId);
    if (!process) throw new ValidationError(`Process ${processId} does not exist in this tenant`);
  }
}

const VALID_TRANSITIONS: Record<ControlStatus, ControlStatus[]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};

function isValidTransition(from: ControlStatus, to: ControlStatus): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}
