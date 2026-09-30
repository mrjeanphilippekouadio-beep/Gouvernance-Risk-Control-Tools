import type { RaciAssignmentRepository } from "../domain/repositories/RaciAssignmentRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../domain/repositories/ControlRepository.js";
import type { ActionPlanRepository } from "../domain/repositories/ActionPlanRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import { RACI_ENTITY_TYPES, type RaciAssignment, type RaciEntityType, type RaciRole } from "../domain/entities/RaciAssignment.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const ENTITY_TYPES: RaciEntityType[] = [...RACI_ENTITY_TYPES];
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
 * validation. `assertNoSelfRaConflict` below is the RACI-scoped
 * analogue: it fires in `assign()`, before the row is ever written, not
 * after the fact — and checks both R→A and A→R directions (SEC-016).
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
    private readonly users?: UserRepository,
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
    // Fail closed: only assign business responsibility to an active user in this tenant.
    if (!this.users) throw new ValidationError("RACI target-user validation is not configured");
    const targetUser = await this.users.getById(actor.tenantId, userId);
    if (!targetUser || targetUser.deletedAt !== null) {
      throw new ValidationError("Target user does not exist in this tenant or is suspended");
    }
    await this.assertNoSelfRaConflict(actor.tenantId, entityType, entityId, actor.userId, userId, role);

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
    if (entityType === "RISK" && this.risks) {
      const risk = await this.risks.getById(tenantId, entityId);
      if (!risk) throw new ValidationError(`Risk ${entityId} does not exist in this tenant`);
    } else if (entityType === "CONTROL" && this.controls) {
      const control = await this.controls.getById(tenantId, entityId);
      if (!control) throw new ValidationError(`Control ${entityId} does not exist in this tenant`);
    } else if (entityType === "ACTION_PLAN" && this.actionPlans) {
      const action = await this.actionPlans.getById(tenantId, entityId);
      if (!action) throw new ValidationError(`ActionPlan ${entityId} does not exist in this tenant`);
    }
  }

  /**
   * Security guard-rail (see class doc): a user must never hold both
   * Responsible ("R") and Accountable ("A") on the same entity — that
   * combination lets the same person execute *and* approve/own the same
   * item with no second look. Checked symmetrically (SEC-016 fix): it
   * fires for either incoming role ("R" or "A") and rejects if the actor
   * already self-holds the *other* one of the pair, regardless of which
   * order the two assignments happen in. "C"/"I" are unaffected — only
   * R+A by the same person is forbidden. A different actor may still
   * assign anyone (including a user who already holds "R") as
   * Accountable — only *self*-designation is blocked.
   */
  private async assertNoSelfRaConflict(
    tenantId: string,
    entityType: RaciEntityType,
    entityId: string,
    actingUserId: string,
    targetUserId: string,
    role: RaciRole,
  ): Promise<void> {
    if (targetUserId !== actingUserId) return;
    const otherRole = role === "A" ? "R" : role === "R" ? "A" : null;
    if (!otherRole) return;

    const existing = await this.raci.listForEntity(tenantId, entityType, entityId);
    const alreadyHolds = existing.some((a) => a.userId === actingUserId && a.role === otherRole);
    if (alreadyHolds) {
      throw new ForbiddenError(
        "Cannot self-designate as Responsible and Accountable on the same entity — a second person must make this assignment",
      );
    }
  }
}
