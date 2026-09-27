import type { NotificationRepository } from "../domain/repositories/NotificationRepository.js";
import type { NotificationSubscriptionRepository } from "../domain/repositories/NotificationSubscriptionRepository.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import type {
  ListNotificationsOptions,
  ListNotificationsResult,
  Notification,
  NotificationResourceType,
} from "../domain/entities/Notification.js";
import type { NotificationSubscription } from "../domain/entities/NotificationSubscription.js";
import { NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import { requirePermission } from "../domain/permissions.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

const RESOURCE_TYPES: NotificationResourceType[] = [
  "RISK",
  "KRI",
  "ACTION_PLAN",
  "CONTROL",
  "ANOMALY",
  "RISK_EVALUATION",
  "REVIEW_CYCLE",
];

const MAX_EVENT_TYPE_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 2000;

export interface SubscribeRequest {
  resourceType: NotificationResourceType;
  eventType: string;
  enabled: boolean;
}

/**
 * ACT-201: system-facing call — invoked internally by another already
 * authorized service (e.g. KriMeasureService, RiskService, ActionPlanService)
 * right after it calls `Notifier.notify(...)`, never directly from an HTTP
 * route. There is deliberately no `actor`/`requirePermission` gate here,
 * same reasoning as `AuditRepository.record`: the caller is trusted
 * application code that has already authorized the underlying business
 * action, not a client-supplied request. `triggeredBy` carries the real
 * user id from that caller's own `actor.userId` (already in scope at every
 * one of the three call sites) so the audit_log row still has a valid,
 * FK-checked `user_id` — there is no "system" sentinel user in this schema.
 *
 * NOT YET WIRED: KriMeasureService.record, RiskService's owner
 * reassignment/escalation paths, and ActionPlanService.start/escalateIfOverdue
 * still only call `Notifier.notify(...)` directly. Wiring each of those
 * three call sites to also call `NotificationService.record(...)` is a
 * follow-up integration step for the orchestrator (see task brief) — each
 * touches an already-shipped, tested service outside this module's scope.
 */
export interface RecordNotificationInput {
  tenantId: string;
  recipientUserId: string;
  resourceType: NotificationResourceType;
  resourceId?: string | null;
  eventType: string;
  message: string;
  triggeredBy: string;
  requestId: string;
}

/**
 * ACT-200/ACT-201/ACT-202: two independent concerns bundled in one service
 * because they're small and share no write path — subscriptions are
 * updated in place (Department/Process pattern), notifications are
 * append-only with a single narrow mutation (mark-as-read), mirroring
 * ControlExecution/ControlEffectivenessAssessment.
 */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly subscriptions: NotificationSubscriptionRepository,
    private readonly audit: AuditRepository,
  ) {}

  // -- ACT-200: subscriptions -----------------------------------------

  /** Always scoped to the actor's own subscriptions — there is no cross-user subscription management. */
  async subscribe(actor: AuthenticatedUser, input: SubscribeRequest, requestId: string): Promise<NotificationSubscription> {
    requirePermission(actor, "notification.read");

    if (!RESOURCE_TYPES.includes(input.resourceType)) {
      throw new ValidationError(`resourceType must be one of: ${RESOURCE_TYPES.join(", ")}`);
    }
    if (!input.eventType?.trim()) throw new ValidationError("eventType is required");
    if (input.eventType.trim().length > MAX_EVENT_TYPE_LENGTH) {
      throw new ValidationError(`eventType must be at most ${MAX_EVENT_TYPE_LENGTH} characters`);
    }
    if (typeof input.enabled !== "boolean") throw new ValidationError("enabled must be a boolean");

    const before = await this.subscriptions.getByKey(actor.tenantId, actor.userId, input.resourceType, input.eventType.trim());

    const after = await this.subscriptions.upsert(actor.tenantId, actor.userId, {
      resourceType: input.resourceType,
      eventType: input.eventType.trim(),
      enabled: input.enabled,
    });

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "NotificationSubscription",
      entityId: after.id,
      action: before ? "UPDATE" : "CREATE",
      oldValue: before,
      newValue: after,
      reason: null,
      requestId,
    });

    return after;
  }

  async listSubscriptions(actor: AuthenticatedUser): Promise<NotificationSubscription[]> {
    requirePermission(actor, "notification.read");
    return this.subscriptions.listForUser(actor.tenantId, actor.userId);
  }

  // -- ACT-201: system-facing notification log -------------------------

  async record(input: RecordNotificationInput): Promise<Notification> {
    if (!RESOURCE_TYPES.includes(input.resourceType)) {
      throw new ValidationError(`resourceType must be one of: ${RESOURCE_TYPES.join(", ")}`);
    }
    if (!input.recipientUserId?.trim()) throw new ValidationError("recipientUserId is required");
    if (!input.eventType?.trim()) throw new ValidationError("eventType is required");
    if (input.eventType.trim().length > MAX_EVENT_TYPE_LENGTH) {
      throw new ValidationError(`eventType must be at most ${MAX_EVENT_TYPE_LENGTH} characters`);
    }
    if (!input.message?.trim()) throw new ValidationError("message is required");
    if (input.message.trim().length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError(`message must be at most ${MAX_MESSAGE_LENGTH} characters`);
    }
    if (!input.triggeredBy?.trim()) throw new ValidationError("triggeredBy is required for the audit trail");

    const notification = await this.notifications.create({
      tenantId: input.tenantId,
      recipientUserId: input.recipientUserId,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      eventType: input.eventType.trim(),
      message: input.message.trim(),
    });

    await this.audit.record({
      tenantId: input.tenantId,
      userId: input.triggeredBy,
      entityType: "Notification",
      entityId: notification.id,
      action: "CREATE",
      oldValue: null,
      newValue: notification,
      reason: null,
      requestId: input.requestId,
    });

    return notification;
  }

  // -- ACT-202: notification center -------------------------------------

  /**
   * `user_id=me` is the only supported value — this always resolves to the
   * caller's own id, server-side. There is no cross-user inbox read here on
   * purpose (BOLA/IDOR guard): a client-supplied arbitrary user id is never
   * trusted, matching the codebase-wide rule that authorization decisions
   * never rely on client input.
   */
  async listForRecipient(actor: AuthenticatedUser, userIdParam: string, options?: ListNotificationsOptions): Promise<ListNotificationsResult> {
    requirePermission(actor, "notification.read");
    if (userIdParam !== "me" && userIdParam !== actor.userId) {
      throw new ValidationError("user_id must be 'me' — reading another user's notification center is not supported");
    }
    return this.notifications.listForRecipient(actor.tenantId, actor.userId, options);
  }

  async markAsRead(actor: AuthenticatedUser, id: string, requestId: string): Promise<Notification> {
    requirePermission(actor, "notification.read");
    const existing = await this.notifications.getById(actor.tenantId, id);
    if (!existing) throw new NotFoundError("Notification", id);
    if (existing.recipientUserId !== actor.userId) {
      // Existence check already tenant-scoped above; this additionally
      // enforces that only the recipient can mark their own notification
      // read (never another user's, even within the same tenant).
      throw new NotFoundError("Notification", id);
    }
    if (existing.readAt !== null) return existing;

    const after = await this.notifications.markAsRead(actor.tenantId, id, actor.userId);

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: "Notification",
      entityId: id,
      action: "UPDATE",
      oldValue: existing,
      newValue: after,
      reason: "MARK_READ",
      requestId,
    });

    return after;
  }
}
