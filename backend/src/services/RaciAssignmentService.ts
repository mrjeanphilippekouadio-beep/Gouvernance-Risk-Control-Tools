import type { RaciAssignmentRepository } from "../domain/repositories/RaciAssignmentRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ActionPlanRepository } from "../domain/repositories/ActionPlanRepository.js";
import type { RaciAssignment, RaciEntityType, RaciRole } from "../domain/entities/RaciAssignment.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const ENTITY_TYPES: RaciEntityType[] = ["Risk", "Control", "ActionPlan"];
const ROLES: RaciRole[] = ["R", "A", "C", "I"];

/**
 * Lot 1 (RACI minimal, GRC_Migration_Plan.md Lot A). IAM ≠ RACI
 * (distinction 3, GRC_Target_Domain_Model.md §0.1): this service only
 * records business responsibility, never a technical permission.
 *
 * Security guard-rail (posed by Security during the CDC consultation,
 * applied here from the start rather than retrofitted): a user must
 * never be able to self-designate as Accountable on an object where
 * they already hold the Responsible role, i.e. the one actually doing
 * the work — that combination lets the same person execute *and*
 * approve/own the same item with no second look, the exact shape
 * `assertIsEvaluator` (RiskEvaluationService) blocks for scoring
 * validation. `assertNoSelfAccountableConflict` below is the
 * RACI-scoped analogue: it fires in `assign()`, before the row is ever
 * written, not after the fact.
 */
export class RaciAssignmentService {
  constructor(
    private readonly raci: RaciAssignmentRepository,
    private readonly audit: AuditRepository,
    /**
     * Optional so existing callers/tests keep compiling — but server.ts
     * MUST wire the real repositories, otherwise entityId stays
     * unvalidated and a cross-tenant or nonexistent reference could be
     * stored (same pattern as ActionPlanService's risks/controls/kris).
     */
    private readonly risks?: RiskRepository,
    private readonly controls?: ControlRepository,
    private readonly actionPlans?: ActionPlanRepository,
  ) {}

  async assign(
    actor: AuthenticatedUser,
    entityType: RaciEntityType,
    entityId: string,
    userId: string,
    role: RaciRole,
    requestId: string,
  ): Promise<RaciAssignment> {
    requirePermission(actor, "raci.assign");

    if (!ENTITY_TYPES.includes(entityType)) {
      throw new ValidationError(`entityType must be one of: ${ENTITY_TYPES.join(", ")}`);
    }
    if (!entityId?.trim()) throw new ValidationError("entityId is required");
    if (!userId?.trim()) throw new ValidationError("userId is required");
    if (!ROLES.includes(role)) {
      throw new ValidationError(`role must be one of: ${ROLES.join(", ")}`);
    }

    await this.assertEntityExists(actor.tenantId, entityType, entityId);
    await this.assertNoSelfAccountableConflict(actor.tenantId, entityType, entityId, actor.userId, userId, role);

    const assignment = await this.raci.create({
      tenantId: actor.tenantId,
      entityType,
      entityId,
      userId,
      role,
      createdBy: actor.userId,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RaciAssignment",
      entityId: assignment.id,
      action: "CREATE",
      oldValue: null,
      newValue: assignment,
      reason: null,
      requestId,
    });

    return assignment;
  }

  async revoke(
    actor: AuthenticatedUser,
    entityType: RaciEntityType,
    entityId: string,
    assignmentId: string,
    requestId: string,
  ): Promise<RaciAssignment> {
    requirePermission(actor, "raci.revoke");

    const before = await this.raci.getById(actor.tenantId, assignmentId);
    if (!before) throw new NotFoundError("RaciAssignment", assignmentId);
    if (before.entityType !== entityType || before.entityId !== entityId) {
      throw new ValidationError("assignmentId does not belong to the given entityType/entityId");
    }

    const after = await this.raci.remove(actor.tenantId, assignmentId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "RaciAssignment",
      entityId: assignmentId,
      action: "DELETE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async list(actor: AuthenticatedUser, entityType: RaciEntityType, entityId: string): Promise<RaciAssignment[]> {
    requirePermission(actor, "raci.read");
    if (!ENTITY_TYPES.includes(entityType)) {
      throw new ValidationError(`entityType must be one of: ${ENTITY_TYPES.join(", ")}`);
    }
    return this.raci.listForEntity(actor.tenantId, entityType, entityId);
  }

  /** Never trust entityId blindly (EvidenceService pattern, CLAUDE.md) — resolve the target row in the actor's tenant before any write. */
  private async assertEntityExists(tenantId: string, entityType: RaciEntityType, entityId: string): Promise<void> {
    if (entityType === "Risk" && this.risks) {
      const risk = await this.risks.getById(tenantId, entityId);
      if (!risk) throw new ValidationError(`Risk ${entityId} does not exist in this tenant`);
    } else if (entityType === "Control" && this.controls) {
      const control = await this.controls.getById(tenantId, entityId);
      if (!control) throw new ValidationError(`Control ${entityId} does not exist in this tenant`);
    } else if (entityType === "ActionPlan" && this.actionPlans) {
      const action = await this.actionPlans.getById(tenantId, entityId);
      if (!action) throw new ValidationError(`ActionPlan ${entityId} does not exist in this tenant`);
    }
  }

  /**
   * Security guard-rail (see class doc): a user assigning themselves as
   * Accountable ("A") on an entity where they already hold Responsible
   * ("R") — i.e. they are already the one actually doing the work — is
   * rejected outright rather than allowed and validated later, since
   * RACI has no separate "validate" step of its own to gate. This is
   * deliberately narrower than a full "pending action" scan across
   * Risk/Control/ActionPlan (out of this lot's scope, see task brief) —
   * it blocks the one case this table can detect on its own: self-review
   * within the RACI record itself. A different actor may still assign
   * anyone (including a user who already holds "R") as Accountable —
   * only *self*-designation while already Responsible is blocked.
   */
  private async assertNoSelfAccountableConflict(
    tenantId: string,
    entityType: RaciEntityType,
    entityId: string,
    actingUserId: string,
    targetUserId: string,
    role: RaciRole,
  ): Promise<void> {
    if (role !== "A" || targetUserId !== actingUserId) return;

    const existing = await this.raci.listForEntity(tenantId, entityType, entityId);
    const alreadyResponsible = existing.some((a) => a.userId === actingUserId && a.role === "R");
    if (alreadyResponsible) {
      throw new ForbiddenError(
        "Cannot self-designate as Accountable while already Responsible on the same entity — a second person must make this assignment",
      );
    }
  }
}
