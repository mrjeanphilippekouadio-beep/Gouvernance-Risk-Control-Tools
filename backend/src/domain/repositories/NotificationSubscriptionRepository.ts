import type { NotificationSubscription, UpsertNotificationSubscriptionInput } from "../entities/NotificationSubscription.js";

export interface NotificationSubscriptionRepository {
  listForUser(tenantId: string, userId: string): Promise<NotificationSubscription[]>;
  getByKey(
    tenantId: string,
    userId: string,
    resourceType: NotificationSubscription["resourceType"],
    eventType: string,
  ): Promise<NotificationSubscription | null>;
  /** ACT-200: in-place update — one row per (tenant, user, resourceType, eventType); upserts, never appends. */
  upsert(tenantId: string, userId: string, input: UpsertNotificationSubscriptionInput): Promise<NotificationSubscription>;
}
