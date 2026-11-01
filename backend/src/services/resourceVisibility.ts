import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type {
  ResourceAccessRepository,
  ResourceVisibilityState,
  RestrictableResource,
  VisibilityChangeResult,
} from "../domain/repositories/ResourceAccessRepository.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import { readerScope, type Visibility } from "../domain/visibility.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";
import type { NotificationResourceType } from "../domain/entities/Notification.js";
import { writeAudited } from "./auditedWrite.js";

/** A root resource as the visibility rules see it (lot V2, spec §1 and §5). */
export interface VisibilityTarget {
  type: RestrictableResource;
  /** Audit entity type ("Control", "Anomaly", "ActionPlan", "Kpi"). */
  entity: string;
  id: string;
  visibility: Visibility;
  /** The account that stands for the owner (plan responsible, anomaly declarer); null for a control or a KPI (I-4). */
  ownerId: string | null;
  /** Set when the resource follows its parent (risk, control, KRI): its own level does not apply. */
  inheritsFrom: string | null;
}

const WIDENED_EVENT: Partial<Record<RestrictableResource, { resourceType: NotificationResourceType; eventType: string; message: string }>> = {
  ACTION_PLAN: { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_WIDENED", message: "Le responsable d'un plan d'action a élargi sa visibilité." },
  ANOMALY: { resourceType: "ANOMALY", eventType: "ANOMALY_VISIBILITY_WIDENED", message: "Le déclarant d'une anomalie a élargi sa visibilité." },
};

export function sameUserId(a: string, b: string): boolean {
  const normalise = (id: string) => id.toLowerCase().replace(/[{}-]/g, "");
  return normalise(a) === normalise(b);
}

function checkedReason(raw: string | undefined, what: string): string {
  const reason = raw?.trim() ?? "";
  if (!reason || reason.length > 500 || !isAcceptableReason(reason)) {
    throw new ValidationError(`A reason (1 to 500 characters) is required to ${what}`);
  }
  return reason;
}

/**
 * Lot V2 (DECISION-100/102/103/105): level and named-people list of a control, anomaly, action plan or KPI, on the exact
 * model of `RiskService.setVisibility` (lot V1). Changed by a holder of `resourcevisibility.set` (Risk Manager group) or
 * the owner account, with a mandatory reason and the audit row in the same transaction. Nobody adds themselves. The Risk
 * Manager group is notified whenever the owner widens (q204 A). A resource that follows its parent has no own level.
 */
export class ResourceVisibilityManager {
  constructor(
    private readonly access: ResourceAccessRepository,
    private readonly audit: AuditRepository,
    private readonly users?: UserRepository,
    private readonly notifications?: Pick<NotificationRepository, "create">,
  ) {}

  async get(actor: AuthenticatedUser, target: VisibilityTarget): Promise<ResourceVisibilityState> {
    const accessUserIds = await this.access.listAccess(actor.tenantId, target.type, target.id);
    return this.withNames(actor.tenantId, { visibility: target.visibility, accessUserIds });
  }

  async set(
    actor: AuthenticatedUser,
    target: VisibilityTarget,
    input: { visibility: Visibility; addUserIds?: string[]; revokeUserIds?: string[]; reason: string },
    requestId: string,
  ): Promise<ResourceVisibilityState> {
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    const isOwner = target.ownerId !== null && sameUserId(target.ownerId, actor.userId);
    if (!holdsRight && !isOwner) {
      throw new ForbiddenError("Only the Risk Manager group or the owner can change the visibility of this resource");
    }
    if (target.inheritsFrom) {
      throw new ValidationError(`This resource follows the visibility of its ${target.inheritsFrom.toLowerCase()}: change it there`);
    }
    const reason = checkedReason(input.reason, "change the visibility of this resource");
    const current = await this.access.listAccess(actor.tenantId, target.type, target.id);
    const addUserIds = input.visibility === "CLIENT" ? [] : [...new Set(input.addUserIds ?? [])];
    const revokeUserIds = input.visibility === "CLIENT" ? current : [...new Set(input.revokeUserIds ?? [])];
    if (addUserIds.some((u) => sameUserId(u, actor.userId))) {
      throw new ValidationError("You cannot add yourself to an access list");
    }
    for (const userId of addUserIds) await this.assertActiveUser(actor.tenantId, userId);
    const change = { visibility: input.visibility, addUserIds, revokeUserIds, reason, changedBy: actor.userId };
    const access = this.access;
    const result = await writeAudited<VisibilityChangeResult>(
      access.auditsInTransaction,
      this.audit,
      (audit) => access.changeVisibility(actor.tenantId, target.type, target.id, change, audit),
      ({ before, after, widening }) => [{
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: target.entity,
        entityId: target.id,
        action: "PERMISSION_CHANGE",
        oldValue: before,
        newValue: { ...after, widening },
        reason,
        requestId,
      }],
    );
    if (!holdsRight && result.widening) await this.notifyWidened(actor, target, requestId);
    return this.withNames(actor.tenantId, result.after);
  }

  /**
   * At creation (spec §5): a restricted level is refused when the creator would not read the resource themselves, unless
   * they see everything. `perimeter` = department / process known at creation; `isOwner` = the creator is the owner
   * account (plan responsible, anomaly declarer). A resource that follows its parent cannot carry its own level.
   */
  async assertCreation(
    actor: AuthenticatedUser,
    target: { visibility: Visibility; inheritsFrom: string | null; isOwner: boolean; departmentId: string | null; processId: string | null },
    seesEverything: boolean,
  ): Promise<void> {
    if (target.visibility === "CLIENT") return;
    if (target.inheritsFrom) {
      throw new ValidationError(`This resource follows the visibility of its ${target.inheritsFrom.toLowerCase()}: it cannot have its own level`);
    }
    if (seesEverything || target.isOwner) return;
    if (target.visibility === "PERIMETRE"
      && (await this.access.inPerimeter(actor.tenantId, actor.userId, target.departmentId, target.processId))) return;
    throw new ValidationError("You would not see this resource yourself with this visibility: choose a level that includes you");
  }

  /**
   * SEC V1-02 extended to lot V2: on a restricted resource, the department / process decide who reads it. Changing them is
   * a visibility change (Risk Manager group or owner, mandatory reason). Returns null when nothing is at stake.
   */
  guardPerimeterChange(
    actor: AuthenticatedUser,
    target: VisibilityTarget,
    changed: boolean,
    rawReason: string | undefined,
  ): { reason: string; holdsRight: boolean } | null {
    if (!changed || target.inheritsFrom || target.visibility === "CLIENT") return null;
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    if (!holdsRight && !(target.ownerId !== null && sameUserId(target.ownerId, actor.userId))) {
      throw new ForbiddenError("Only the Risk Manager group or the owner can change the department or process of a restricted resource");
    }
    return { reason: checkedReason(rawReason, "change the department or process of a restricted resource"), holdsRight };
  }

  /** Effective readers now (SQL `<root>_visible_to`): measured before and after a perimeter change. */
  readers(actor: AuthenticatedUser, type: RestrictableResource, id: string): Promise<string[]> {
    return this.access.readers(actor.tenantId, type, id);
  }

  /** After a perimeter change: the PERMISSION_CHANGE row (with `widening` from the effective sets) and the notification. */
  async recordPerimeterChange(
    actor: AuthenticatedUser,
    target: VisibilityTarget,
    guard: { reason: string; holdsRight: boolean },
    readersBefore: string[],
    values: { before: Record<string, unknown>; after: Record<string, unknown> },
    requestId: string,
  ): Promise<void> {
    const readersAfter = await this.access.readers(actor.tenantId, target.type, target.id);
    const widening = readersAfter.some((u) => !readersBefore.includes(u));
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: target.entity,
      entityId: target.id,
      action: "PERMISSION_CHANGE",
      oldValue: { visibility: target.visibility, ...values.before },
      newValue: { visibility: target.visibility, ...values.after, widening },
      reason: guard.reason,
      requestId,
    });
    if (widening && !guard.holdsRight) await this.notifyWidened(actor, target, requestId);
  }

  /** Among `ids`, those the actor may NOT read (one query). */
  async hidden(actor: AuthenticatedUser, type: RestrictableResource, ids: Array<string | null | undefined>): Promise<Set<string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Set();
    return new Set(await this.access.hiddenIds(actor.tenantId, type, unique, readerScope(actor)));
  }

  /** A row of a hidden resource answers exactly like a missing one (404, no existence oracle). */
  async assertReadable(actor: AuthenticatedUser, type: RestrictableResource, id: string | null | undefined, entity: string, shownId: string): Promise<void> {
    if ((await this.hidden(actor, type, [id])).size > 0) throw new NotFoundError(entity, shownId);
  }

  private async withNames(tenantId: string, state: ResourceVisibilityState): Promise<ResourceVisibilityState> {
    if (!this.users) return state;
    const users = this.users;
    const accessUsers = await Promise.all(state.accessUserIds.map(async (id) => ({ id, displayName: (await users.getById(tenantId, id))?.displayName ?? null })));
    return { ...state, accessUsers };
  }

  private async assertActiveUser(tenantId: string, userId: string): Promise<void> {
    if (!this.users) throw new ValidationError("Access lists are not available");
    const user = await this.users.getById(tenantId, userId);
    if (!user) throw new ValidationError(`User ${userId} does not exist in this tenant`);
    if (user.deletedAt) throw new ValidationError(`User ${userId} is suspended and cannot be given access`);
  }

  /** q199/q204: best-effort, never undoes the change, never names the content. */
  private async notifyWidened(actor: AuthenticatedUser, target: VisibilityTarget, requestId: string): Promise<void> {
    const event = WIDENED_EVENT[target.type];
    if (!event || !this.notifications || !this.users?.listWithPermission) return;
    try {
      const managers = await this.users.listWithPermission(actor.tenantId, "resourcevisibility.set", actor.userId);
      for (const m of managers) {
        await this.notifications.create({
          tenantId: actor.tenantId,
          recipientUserId: m.id,
          resourceType: event.resourceType,
          resourceId: target.id,
          eventType: event.eventType,
          message: event.message,
        });
      }
    } catch (err) {
      console.error(`${event.eventType} ${target.id}: managers could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
    }
  }
}
