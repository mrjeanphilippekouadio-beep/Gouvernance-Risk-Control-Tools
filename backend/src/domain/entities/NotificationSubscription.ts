/**
 * NotificationSubscription (ACT-200): a user's opt-in/opt-out per
 * (resourceType, eventType) pair — e.g. "notify me on KRI threshold
 * breach", "notify me on action overdue". Updated in place, one row per
 * (tenantId, userId, resourceType, eventType): a re-subscribe/unsubscribe
 * call upserts the same row rather than appending a new one, matching the
 * Department/Process "updated in place" pattern from CLAUDE.md.
 *
 * This table is deliberately independent from `notifications` — it
 * governs opt-in/opt-out preference, not the notification log itself.
 * Nothing in this codebase currently reads these subscriptions to decide
 * whether to call `Notifier.notify(...)` (the three existing call sites
 * broadcast unconditionally); wiring subscription checks into those call
 * sites is a follow-up integration step, same as `NotificationService.record`.
 */

import type { NotificationResourceType } from "./Notification.js";

export interface NotificationSubscription {
  id: string;
  tenantId: string;
  userId: string;
  resourceType: NotificationResourceType;
  eventType: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertNotificationSubscriptionInput {
  resourceType: NotificationResourceType;
  eventType: string;
  enabled: boolean;
}
