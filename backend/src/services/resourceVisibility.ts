import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type { NotificationRepository } from "../domain/repositories/NotificationRepository.js";
import type { UserRepository } from "../domain/repositories/UserRepository.js";
import type {
  RestrictedResourceRow,
  PerimeterChange,
  PerimeterChangeResult,
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

type OwnerEvent = { resourceType: NotificationResourceType; eventType: string; message: string };
/** q199/q204/q208: what the Risk Manager group receives when an owner changes a level (widening, or restricting). */
const OWNER_EVENTS: Partial<Record<RestrictableResource, { widened: OwnerEvent; restricted: OwnerEvent }>> = {
  ACTION_PLAN: {
    widened: { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_WIDENED", message: "Le responsable d'un plan d'action a élargi sa visibilité." },
    restricted: { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_RESTRICTED", message: "Le responsable d'un plan d'action a modifié ou restreint sa visibilité." },
  },
  ANOMALY: {
    widened: { resourceType: "ANOMALY", eventType: "ANOMALY_VISIBILITY_WIDENED", message: "Le déclarant d'une anomalie a élargi sa visibilité." },
    restricted: { resourceType: "ANOMALY", eventType: "ANOMALY_VISIBILITY_RESTRICTED", message: "Le déclarant d'une anomalie a modifié ou restreint sa visibilité." },
  },
};

/** q207: a RACI assignment that opened a restricted resource to someone (author outside the Risk Manager group). */
const RACI_WIDENED: Record<"RISK" | "CONTROL" | "ACTION_PLAN", OwnerEvent> = {
  RISK: { resourceType: "RISK", eventType: "RISK_VISIBILITY_WIDENED", message: "Une affectation RACI a ouvert la lecture d'un risque restreint." },
  CONTROL: { resourceType: "CONTROL", eventType: "CONTROL_VISIBILITY_WIDENED", message: "Une affectation RACI a ouvert la lecture d'un contrôle restreint." },
  ACTION_PLAN: { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_WIDENED", message: "Une affectation RACI a ouvert la lecture d'un plan d'action restreint." },
};

/** Same level and same named people (order ignored). */
export function sameVisibilityState(a: { visibility: string; accessUserIds: string[] }, b: { visibility: string; accessUserIds: string[] }): boolean {
  return a.visibility === b.visibility && a.accessUserIds.length === b.accessUserIds.length
    && a.accessUserIds.every((u) => b.accessUserIds.some((v) => sameUserId(u, v)));
}

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
    // q208 (DECISION-107): every change by the owner reaches the Risk Manager group, widening or restricting.
    // QA-V2B-02: a request that changes nothing (same level, same list) does not wake the group.
    if (!holdsRight && !sameVisibilityState(result.before, result.after)) await this.notifyOwnerChange(actor, target, result.widening, requestId);
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

  /**
   * SEC V2-04 / CMP-V2-01: applies the department / process change of a restricted control or KPI under a row lock, with
   * `widening` measured on the effective readers and the PERMISSION_CHANGE row in the same transaction; then notifies.
   */
  async applyPerimeterChange(
    actor: AuthenticatedUser,
    target: VisibilityTarget & { type: "CONTROL" | "KPI" },
    guard: { reason: string; holdsRight: boolean },
    change: PerimeterChange,
    requestId: string,
  ): Promise<PerimeterChangeResult> {
    const access = this.access;
    const result = await writeAudited<PerimeterChangeResult>(
      access.auditsInTransaction,
      this.audit,
      (audit) => access.changePerimeter(actor.tenantId, target.type, target.id, change, audit),
      ({ before, after, widening }) => [{
        tenantId: actor.tenantId,
        userId: actor.userId,
        entityType: target.entity,
        entityId: target.id,
        action: "PERMISSION_CHANGE",
        oldValue: { visibility: target.visibility, ...before },
        newValue: { visibility: target.visibility, ...after, widening },
        reason: guard.reason,
        requestId,
      }],
    );
    if (!guard.holdsRight) await this.notifyOwnerChange(actor, target, result.widening, requestId);
    return result;
  }

  /**
   * q207 (DECISION-107): before a RACI assignment on a risk, control or plan. Returns null when the person already reads
   * it (nothing opens); otherwise the assignment may open it: an author outside the Risk Manager group must give a reason.
   */
  async guardRaciOpening(
    actor: AuthenticatedUser,
    type: "RISK" | "CONTROL" | "ACTION_PLAN",
    id: string,
    userId: string,
    rawReason: string | undefined,
  ): Promise<{ reason: string | null; holdsRight: boolean } | null> {
    if (await this.access.canRead(actor.tenantId, type, id, userId)) return null;
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    const reason = rawReason?.trim() ? checkedReason(rawReason, "open a restricted resource through RACI") : null;
    if (!holdsRight && !reason) {
      throw new ValidationError("A reason (1 to 500 characters) is required: this RACI assignment gives read access to a restricted resource");
    }
    return { reason, holdsRight };
  }

  /** q207: after the assignment, whether it really opened the resource; if so, the audit row and the notification. */
  async raciOpened(actor: AuthenticatedUser, type: "RISK" | "CONTROL" | "ACTION_PLAN", id: string, userId: string): Promise<boolean> {
    return this.access.canRead(actor.tenantId, type, id, userId);
  }

  async notifyRaciOpening(actor: AuthenticatedUser, type: "RISK" | "CONTROL" | "ACTION_PLAN", id: string, requestId: string): Promise<void> {
    await this.notifyManagers(actor, RACI_WIDENED[type], id, requestId);
  }

  /**
   * q207: a new process owner reads the PERIMETRE resources (risks, controls, KPIs) of that process. Returns those they
   * cannot read yet; an author outside the Risk Manager group must then give a reason.
   */
  async guardProcessOwnerOpening(
    actor: AuthenticatedUser,
    processId: string,
    newOwnerId: string,
    rawReason: string | undefined,
  ): Promise<{ reason: string | null; holdsRight: boolean; opened: Array<{ type: string; id: string }> } | null> {
    const opened = await this.access.processOwnerGains(actor.tenantId, processId, newOwnerId);
    if (opened.length === 0) return null;
    const holdsRight = actor.roles.includes("resourcevisibility.set");
    const reason = rawReason?.trim() ? checkedReason(rawReason, "open restricted resources through a process owner") : null;
    if (!holdsRight && !reason) {
      throw new ValidationError("A reason (1 to 500 characters) is required: the new process owner would read restricted resources");
    }
    return { reason, holdsRight, opened };
  }

  async notifyProcessOwnerOpening(actor: AuthenticatedUser, processId: string, requestId: string): Promise<void> {
    await this.notifyManagers(actor, {
      resourceType: "MANAGEMENT",
      eventType: "PROCESS_OWNER_VISIBILITY_WIDENED",
      message: "Un nouveau responsable de processus lit désormais des ressources restreintes.",
    }, processId, requestId);
  }

  /** q208 (DECISION-107): every restricted resource of the client, for the Risk Manager group (`resourcevisibility.set`). */
  async listRestricted(actor: AuthenticatedUser): Promise<RestrictedResourceRow[]> {
    if (!actor.roles.includes("resourcevisibility.set")) {
      throw new ForbiddenError("Only the Risk Manager group can list the restricted resources");
    }
    return this.access.listRestricted(actor.tenantId);
  }

  /** Among `ids`, those the actor may NOT read (one query). */
  async hidden(actor: AuthenticatedUser, type: RestrictableResource, ids: Array<string | null | undefined>): Promise<Set<string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Set();
    return new Set(await this.access.hiddenIds(actor.tenantId, type, unique, readerScope(actor)));
  }

  /** QA-VIS2-01: whether the actor may not read this control execution (its control is hidden and they did not run it). */
  async executionHidden(actor: AuthenticatedUser, executionId: string | null | undefined): Promise<boolean> {
    if (!executionId) return false;
    return (await this.access.hiddenExecutionIds(actor.tenantId, [executionId], readerScope(actor))).length > 0;
  }

  /** QA-VIS2-02: a readable anomaly never names a control or an execution the reader may not see. Two queries for all rows. */
  async maskAnomalyParents<T extends { controlId: string | null; controlExecutionId: string | null }>(actor: AuthenticatedUser, rows: T[]): Promise<T[]> {
    const controls = await this.hidden(actor, "CONTROL", rows.map((r) => r.controlId));
    const executionIds = [...new Set(rows.map((r) => r.controlExecutionId).filter((id): id is string => !!id))];
    const executions = new Set(executionIds.length === 0 ? [] : await this.access.hiddenExecutionIds(actor.tenantId, executionIds, readerScope(actor)));
    if (controls.size === 0 && executions.size === 0) return rows;
    return rows.map((r) => ({
      ...r,
      controlId: r.controlId && controls.has(r.controlId) ? null : r.controlId,
      controlExecutionId: r.controlExecutionId && executions.has(r.controlExecutionId) ? null : r.controlExecutionId,
    }));
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
  private async notifyOwnerChange(actor: AuthenticatedUser, target: VisibilityTarget, widened: boolean, requestId: string): Promise<void> {
    const events = OWNER_EVENTS[target.type];
    if (events) await this.notifyManagers(actor, widened ? events.widened : events.restricted, target.id, requestId);
  }

  /** q199/q207/q208: best-effort, never undoes the change, never names the content. */
  private async notifyManagers(actor: AuthenticatedUser, event: OwnerEvent, resourceId: string, requestId: string): Promise<void> {
    if (!this.notifications || !this.users?.listWithPermission) return;
    try {
      const managers = await this.users.listWithPermission(actor.tenantId, "resourcevisibility.set", actor.userId);
      for (const m of managers) {
        await this.notifications.create({
          tenantId: actor.tenantId,
          recipientUserId: m.id,
          resourceType: event.resourceType,
          resourceId,
          eventType: event.eventType,
          message: event.message,
        });
      }
    } catch (err) {
      console.error(`${event.eventType} ${resourceId}: managers could not be notified (requestId ${requestId})`, err instanceof Error ? err.message : err);
    }
  }

}
