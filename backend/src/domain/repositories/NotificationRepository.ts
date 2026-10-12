import type {
  CreateNotificationInput,
  ListNotificationsOptions,
  ListNotificationsResult,
  Notification,
} from "../entities/Notification.js";

export interface NotificationRepository {
  /** ACT-201: the only way a Notification row is ever created — always tenant + recipient scoped. */
  create(input: CreateNotificationInput): Promise<Notification>;
  getById(tenantId: string, id: string): Promise<Notification | null>;
  /** ACT-202: the notification center for one recipient — paginated, filterable by type/read-status. */
  listForRecipient(tenantId: string, recipientUserId: string, options?: ListNotificationsOptions): Promise<ListNotificationsResult>;
  /** ACT-202: the only mutation ever allowed after creation — stamps readAt, never touches anything else. */
  markAsRead(tenantId: string, id: string, recipientUserId: string): Promise<Notification>;
  /** F-NOTIF-01: true if an UNREAD notification already exists for this exact (tenant, recipient, resource, event). Optional so older fakes keep working (no dedup then). */
  existsUnread?(tenantId: string, recipientUserId: string, resourceType: string, resourceId: string, eventType: string): Promise<boolean>;
  /** Unread notifications of one recipient. */
  countUnread(tenantId: string, recipientUserId: string): Promise<number>;
  /** Stamps readAt on every unread notification of that recipient (tenant-scoped); returns how many changed. */
  markAllAsRead(tenantId: string, recipientUserId: string): Promise<number>;
}
