import { randomUUID } from "node:crypto";
import type { RiskRepository } from "../domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { DepartmentRepository } from "../domain/repositories/DepartmentRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type { RiskEscalationRepository } from "../domain/repositories/RiskEscalationRepository.js";
import type { ProcessRepository } from "../domain/repositories/ProcessRepository.js";
import type { CreateRiskInput, Risk, UpdateRiskInput } from "../domain/entities/Risk.js";
import type { RiskEscalation } from "../domain/entities/RiskEscalation.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { Notifier } from "../infrastructure/notifications/Notifier.js";

/**
 * All business rules and transitions for Risk live here — never in the
 * frontend, never in the repository. This is the layer the ADR-001
 * "Backend décide" example maps to.
 */
export class RiskService {
  constructor(
    private readonly risks: RiskRepository,
    private readonly audit: AuditRepository,
    /** SEC-004: optional so existing tests keep compiling — server.ts must wire the real repository. */
    private readonly departments?: DepartmentRepository,
    /**
     * ACT-120/122: optional so existing callers/tests built before this
     * existed don't need to change — but server.ts MUST wire the real
     * repository, otherwise ownerId/superiorOwnerId stay unvalidated and
     * anyone can be pointed at as a risk owner, tenant or not, active or not.
     */
    private readonly users?: UserRepository,
    /** ACT-121/125: optional, same pattern as KriMeasureService's notifier — best-effort broadcast, never blocks the write it's attached to. */
    private readonly notifier?: Notifier,
    /** ACT-125: optional so existing tests keep compiling — server.ts must wire the real repository for escalate() to work in production. */
    private readonly escalations?: RiskEscalationRepository,
    /**
     * DIV-05: optional so existing tests keep compiling, but if a caller
     * actually supplies `processId`, `assertProcessExists` throws rather
     * than silently skipping validation when this is unwired — the
     * SEC-012 lesson (never `if (!this.x) return;` on a dependency the
     * current call is actually trying to use). server.ts must wire the
     * real repository for `processId` to ever be accepted.
     */
    private readonly processes?: ProcessRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: Omit<CreateRiskInput, "tenantId">, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.create");
    if (!input.process.trim()) throw new ValidationError("process is required");
    if (!input.description.trim()) throw new ValidationError("description is required");
    await this.assertDepartmentExists(actor.tenantId, input.ownerDepartmentId);
    await this.assertProcessExists(actor.tenantId, input.processId);

    const risk = await this.risks.create({ ...input, tenantId: actor.tenantId });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: risk.id,
      action: "CREATE",
      oldValue: null,
      newValue: risk,
      reason: null,
      requestId,
    });

    return risk;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<Risk> {
    requirePermission(actor, "risk.read");
    const risk = await this.risks.getById(actor.tenantId, id);
    if (!risk) throw new NotFoundError("Risk", id);
    return risk;
  }

  /** ACT-124: `ownerId` (resolved by the route layer — "me" -> actor.userId) filters to that owner's risks. */
  async list(actor: AuthenticatedUser, includeArchived = false, ownerId?: string): Promise<Risk[]> {
    requirePermission(actor, "risk.read");
    return this.risks.list(actor.tenantId, { includeArchived, ownerId });
  }

  async update(actor: AuthenticatedUser, id: string, input: UpdateRiskInput, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.update");
    const before = await this.get(actor, id);

    if (input.status) {
      if (input.status === "ARCHIVED") {
        throw new ValidationError("Use the archive endpoint to archive a risk (requires a reason)");
      }
      if (!isValidTransition(before.status, input.status)) {
        throw new ValidationError(`Cannot transition risk from ${before.status} to ${input.status}`);
      }
    }
    await this.assertDepartmentExists(actor.tenantId, input.ownerDepartmentId);
    await this.assertProcessExists(actor.tenantId, input.processId);

    const after = await this.risks.update(actor.tenantId, id, input);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
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
    requirePermission(actor, "risk.delete");
    if (!reason.trim()) throw new ValidationError("A reason is required to archive a risk");
    const before = await this.get(actor, id);

    await this.risks.softDelete(actor.tenantId, id, actor.userId, reason);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "DELETE",
      oldValue: before,
      newValue: null,
      reason,
      requestId,
    });
  }

  /**
   * ACT-120/121: designate or reassign the individual Risk Owner. Not
   * folded into the generic `update()` — this is a distinct, audited
   * action (like archive()), not a routine field edit, and `Risk.ownerId`
   * has no place in UpdateRiskInput for exactly that reason.
   *
   * `ownerId: null` clears the owner. A non-null value must resolve to
   * an active user in the caller's tenant (SEC-004: never trust a
   * client-supplied id that could point at another tenant's user, or a
   * suspended one).
   */
  async assignOwner(actor: AuthenticatedUser, id: string, ownerId: string | null, requestId: string): Promise<Risk> {
    requirePermission(actor, "risk.update");
    const before = await this.get(actor, id);

    if (ownerId) {
      await this.assertActiveUser(actor.tenantId, ownerId, "owner");
      if (before.superiorOwnerId && before.superiorOwnerId === ownerId) {
        throw new ValidationError("The risk owner cannot be the same person as the superior owner (N+1)");
      }
    }

    const after = await this.risks.assignOwner(actor.tenantId, id, ownerId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    // ACT-121: best-effort broadcast on reassignment — never blocks the write.
    if (this.notifier && before.ownerId !== after.ownerId) {
      this.notifier
        .notify(
          `Risk ${id} owner changed from ${before.ownerId ?? "(none)"} to ${after.ownerId ?? "(none)"}`,
        )
        .catch(() => {
          // Best-effort — a broken notification channel must never fail the actual ownership change.
        });
    }

    return after;
  }

  /**
   * ACT-122: designate the owner's N+1 (superior owner), used by
   * escalate() (ACT-125) as the escalation target. `regles_critiques`
   * "hiérarchie owner < superior_owner" is enforced as: the two can never
   * be the same person — checked here and (bidirectionally) in
   * assignOwner. Automatic threshold-based escalation is explicitly out
   * of scope here — see escalate() below, which is the one and only
   * escalation mechanism this module builds.
   */
  async assignSuperiorOwner(
    actor: AuthenticatedUser,
    id: string,
    superiorOwnerId: string | null,
    requestId: string,
  ): Promise<Risk> {
    requirePermission(actor, "risk.update");
    const before = await this.get(actor, id);

    if (superiorOwnerId) {
      await this.assertActiveUser(actor.tenantId, superiorOwnerId, "superior owner");
      if (before.ownerId && before.ownerId === superiorOwnerId) {
        throw new ValidationError("The superior owner (N+1) cannot be the same person as the risk owner");
      }
    }

    const after = await this.risks.assignSuperiorOwner(actor.tenantId, id, superiorOwnerId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ASSIGN",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * ACT-125: escalate a risk to its superior owner. Requires a
   * superiorOwnerId to already be assigned (assignSuperiorOwner must run
   * first) and a mandatory reason — mirrors Anomaly's "on ne referme pas
   * un constat sans dire ce qui a été fait" for the same reason: an
   * escalation with no stated cause is not useful history.
   *
   * Writes an append-only RiskEscalation row (queryable history) in
   * addition to the standard audit event, then best-effort notifies via
   * Notifier — see RiskEscalation.ts for why a table exists here and not
   * just a Notifier call.
   */
  async escalate(actor: AuthenticatedUser, id: string, reason: string, requestId: string): Promise<RiskEscalation> {
    requirePermission(actor, "risk.escalate");
    if (!reason.trim()) throw new ValidationError("A reason is required to escalate a risk");
    if (!this.escalations) {
      throw new ValidationError("Risk escalation is not available: RiskEscalationRepository is not configured");
    }

    const risk = await this.get(actor, id);
    if (!risk.superiorOwnerId) {
      throw new ValidationError("This risk has no superior owner assigned — use assignSuperiorOwner first");
    }

    const escalation = await this.escalations.create({
      tenantId: actor.tenantId,
      riskId: id,
      escalatedBy: actor.userId,
      superiorOwnerId: risk.superiorOwnerId,
      reason,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Risk",
      entityId: id,
      action: "ESCALATE",
      oldValue: null,
      newValue: escalation,
      reason,
      requestId,
    });

    this.notifier
      ?.notify(`Risk ${id} escalated to superior owner ${risk.superiorOwnerId}: ${reason}`)
      .catch(() => {
        // Best-effort — a broken notification channel must never fail the actual escalation record.
      });

    return escalation;
  }

  /** ACT-120/122: an owner/superiorOwner, if validation is wired, must be an active user in the caller's tenant. */
  private async assertActiveUser(tenantId: string, userId: string, role: "owner" | "superior owner"): Promise<void> {
    if (!this.users) return;
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be a risk ${role}`);
  }

  /** SEC-004: an ownerDepartmentId, if given, must belong to the caller's tenant. */
  private async assertDepartmentExists(tenantId: string, ownerDepartmentId: string | null | undefined): Promise<void> {
    if (!ownerDepartmentId || !this.departments) return;
    const department = await this.departments.getById(tenantId, ownerDepartmentId);
    if (!department) throw new ValidationError(`Department ${ownerDepartmentId} does not exist in this tenant`);
  }

  /**
   * DIV-05: a processId, if given, must belong to the caller's tenant.
   * Unlike assertDepartmentExists, a missing repository here does NOT
   * silently skip validation when a processId was actually supplied —
   * that would reintroduce the SEC-012 class of bug (a field accepted
   * and stored with no validation ever having run). It's only safe to
   * no-op when the caller didn't ask to set processId at all.
   */
  private async assertProcessExists(tenantId: string, processId: string | null | undefined): Promise<void> {
    if (processId === undefined || processId === null) return;
    if (!this.processes) {
      throw new ValidationError("Risk process validation is not available: ProcessRepository is not configured");
    }
    const process = await this.processes.getById(tenantId, processId);
    if (!process) throw new ValidationError(`Process ${processId} does not exist in this tenant`);
  }
}

const VALID_TRANSITIONS: Record<Risk["status"], Risk["status"][]> = {
  DRAFT: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};

function isValidTransition(from: Risk["status"], to: Risk["status"]): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export function newRequestId(): string {
  return `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
}
