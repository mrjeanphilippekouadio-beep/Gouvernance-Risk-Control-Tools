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
}
