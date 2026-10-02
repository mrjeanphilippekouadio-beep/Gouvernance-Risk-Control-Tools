import type { AuditMissionRepository } from "../domain/repositories/AuditMissionRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type {
  AuditMission,
  AuditMissionListFilters,
  CreateAuditMissionInput,
} from "../domain/entities/AuditMission.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

export interface CreateAuditMissionRequest {
  reference: string;
  title: string;
  scope: string;
  leadAuditorId: string;
  auditorIds?: string[];
  plannedStartDate: Date;
  plannedEndDate: Date;
}

/**
 * Lot 4 (Audit module): AuditMission is the entry point of the
 * Finding->ActionPlan chain (GRC_Target_Domain_Model.md §9.1/§9.2) — a
 * Finding can only be raised against a mission that's actually in
 * progress (enforced here, not just at the Finding layer, so the rule
 * lives with the entity whose lifecycle it's about — see
 * FindingService.create for the corresponding check).
 *
 * Ticket-lifecycle pattern (same shape as AnomalyService/
 * ActionPlanService): PLANIFIEE -> EN_COURS -> CLOTUREE, one row,
 * updated in place. No maker-checker on close() — unlike Finding/
 * ActionPlan closure, a mission's own lead auditor signing off on their
 * own mission's closure is the normal, expected flow (the maker-checker
 * concern the task brief raises is about a *specific Finding's* closure,
 * where a second pair of eyes on "is this constat really resolved"
 * matters — not about the mission wrapper itself). Judgment call,
 * documented rather than silently assumed.
 */
export class AuditMissionService {
  constructor(
    private readonly missions: AuditMissionRepository,
    private readonly audit: AuditRepository,
    /**
     * Optional so tests built without it keep compiling — but server.ts
     * MUST wire the real repository, otherwise leadAuditorId/auditorIds
     * stay unvalidated (same shape as ActionPlanService's users?).
     */
    private readonly users?: UserRepository,
  ) {}

  async create(actor: AuthenticatedUser, input: CreateAuditMissionRequest, requestId: string): Promise<AuditMission> {
    requirePermission(actor, "audit.mission.create");

    if (!input.reference?.trim()) throw new ValidationError("reference is required");
    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (!input.scope?.trim()) throw new ValidationError("scope is required");
    if (!input.leadAuditorId?.trim()) throw new ValidationError("leadAuditorId is required");
    if (!(input.plannedStartDate instanceof Date) || Number.isNaN(input.plannedStartDate.getTime())) {
      throw new ValidationError("plannedStartDate must be a valid date");
    }
    if (!(input.plannedEndDate instanceof Date) || Number.isNaN(input.plannedEndDate.getTime())) {
      throw new ValidationError("plannedEndDate must be a valid date");
    }
    if (input.plannedEndDate.getTime() < input.plannedStartDate.getTime()) {
      throw new ValidationError("plannedEndDate cannot be before plannedStartDate");
    }

    await this.assertActiveUser(actor.tenantId, input.leadAuditorId);
    const auditorIds = [...new Set(input.auditorIds ?? [])];
    for (const auditorId of auditorIds) {
      await this.assertActiveUser(actor.tenantId, auditorId);
    }

    const createInput: CreateAuditMissionInput = {
      tenantId: actor.tenantId,
      reference: input.reference.trim(),
      title: input.title.trim(),
      scope: input.scope.trim(),
      leadAuditorId: input.leadAuditorId,
      auditorIds,
      plannedStartDate: input.plannedStartDate,
      plannedEndDate: input.plannedEndDate,
      createdBy: actor.userId,
    };

    const mission = await this.missions.create(createInput);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "AuditMission",
      entityId: mission.id,
      action: "CREATE",
      oldValue: null,
      newValue: mission,
      reason: null,
      requestId,
    });

    return mission;
  }

  async get(actor: AuthenticatedUser, id: string): Promise<AuditMission> {
    requirePermission(actor, "audit.mission.read");
    return this.getRaw(actor, id);
  }

  async list(actor: AuthenticatedUser, filters?: AuditMissionListFilters): Promise<AuditMission[]> {
    requirePermission(actor, "audit.mission.read");
    return this.missions.list(actor.tenantId, filters);
  }

  /** PLANIFIEE -> EN_COURS. Narrow, non-terminal transition — same permission as create (no dedicated gate needed, mirrors ActionPlanService.start using actionplan.update). */
  async start(actor: AuthenticatedUser, id: string, requestId: string): Promise<AuditMission> {
    requirePermission(actor, "audit.mission.update");
    const before = await this.getRaw(actor, id);

    if (before.status !== "PLANIFIEE") {
      throw new ValidationError(`Cannot start a mission that is not PLANIFIEE (current status: ${before.status})`);
    }

    const after = await this.missions.start(actor.tenantId, id);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "AuditMission",
      entityId: id,
      action: "STATUS_CHANGE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  /**
   * EN_COURS -> CLOTUREE. Terminal transition, dedicated permission
   * (audit.mission.close, never audit.mission.update — same "terminal
   * transition gets its own gate" convention as
   * execution.validate/actionplan.validate), mandatory closure comment.
   * Findings raised during the mission are NOT required to be CLOS
   * first: per the task brief's own description of the lifecycle
   * ("clôture de mission -> plans d'action qui en découlent"), remediation
   * (ActionPlans against still-open Findings) is expected to continue
   * after the mission itself closes — the mission's closure marks the
   * fieldwork/reporting as done, not that every constat is resolved.
   */
  async close(actor: AuthenticatedUser, id: string, comment: string, requestId: string): Promise<AuditMission> {
    requirePermission(actor, "audit.mission.close");
    const before = await this.getRaw(actor, id);

    if (before.status !== "EN_COURS") {
      throw new ValidationError(`Cannot close a mission that is not EN_COURS (current status: ${before.status})`);
    }
    if (!comment?.trim()) {
      throw new ValidationError("Closing a mission requires a closure comment");
    }

    const after = await this.missions.close(actor.tenantId, id, comment.trim());

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "AuditMission",
      entityId: id,
      action: "CLOSE",
      oldValue: before,
      newValue: after,
      reason: comment,
      requestId,
    });

    return after;
  }

  private async getRaw(actor: AuthenticatedUser, id: string): Promise<AuditMission> {
    const mission = await this.missions.getById(actor.tenantId, id);
    if (!mission) throw new NotFoundError("AuditMission", id);
    return mission;
  }

  private async assertActiveUser(tenantId: string, userId: string): Promise<void> {
    if (!this.users) return;
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be an auditor`);
  }
}
