import type { Pool } from "pg";
import type { NotificationRepository } from "../../../domain/repositories/NotificationRepository.js";
import type {
  CreateNotificationInput,
  ListNotificationsOptions,
  ListNotificationsResult,
  Notification,
  NotificationResourceType,
} from "../../../domain/entities/Notification.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface NotificationRow {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  resource_type: NotificationResourceType;
  resource_id: string | null;
  event_type: string;
  message: string;
  sent_at: Date;
  read_at: Date | null;
}

function toDomain(row: NotificationRow): Notification {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    recipientUserId: row.recipient_user_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    eventType: row.event_type,
    message: row.message,
    sentAt: row.sent_at,
    readAt: row.read_at,
  };
}

export class PostgresNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateNotificationInput): Promise<Notification> {
    const { rows } = await this.pool.query<NotificationRow>(
      `INSERT INTO notifications (tenant_id, recipient_user_id, resource_type, resource_id, event_type, message)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [input.tenantId, input.recipientUserId, input.resourceType, input.resourceId, input.eventType, input.message],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into notifications returned no row");
    return toDomain(row);
  }

  async getById(tenantId: string, id: string): Promise<Notification | null> {
    const { rows } = await this.pool.query<NotificationRow>(
      `SELECT * FROM notifications WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async listForRecipient(
    tenantId: string,
    recipientUserId: string,
    options?: ListNotificationsOptions,
  ): Promise<ListNotificationsResult> {
    const conditions = ["tenant_id = $1", "recipient_user_id = $2"];
    const values: unknown[] = [tenantId, recipientUserId];

    if (options?.resourceType) {
      values.push(options.resourceType);
      conditions.push(`resource_type = $${values.length}`);
    }
    if (options?.eventType) {
      values.push(options.eventType);
      conditions.push(`event_type = $${values.length}`);
    }
    if (options?.read === true) {
      conditions.push(`read_at IS NOT NULL`);
    } else if (options?.read === false) {
      conditions.push(`read_at IS NULL`);
    }

    const where = conditions.join(" AND ");

    const countResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM notifications WHERE ${where}`,
      values,
    );
    const total = Number(countResult.rows[0]?.count ?? "0");

    const limit = options?.limit ?? 20;
    const offset = options?.offset ?? 0;
    const dataValues = [...values, limit, offset];
    const limitIdx = dataValues.length - 1;
    const offsetIdx = dataValues.length;

    const { rows } = await this.pool.query<NotificationRow>(
      `SELECT * FROM notifications
       WHERE ${where}
       ORDER BY sent_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      dataValues,
    );

    return { data: rows.map(toDomain), total };
  }

  async markAsRead(tenantId: string, id: string, recipientUserId: string): Promise<Notification> {
    const { rows } = await this.pool.query<NotificationRow>(
      `UPDATE notifications
       SET read_at = now()
       WHERE tenant_id = $1 AND id = $2 AND recipient_user_id = $3
       RETURNING *`,
      [tenantId, id, recipientUserId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Notification", id);
    return toDomain(row);
  }
}
