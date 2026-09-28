import type { Pool } from "pg";
import type { NotificationSubscriptionRepository } from "../../../domain/repositories/NotificationSubscriptionRepository.js";
import type {
  NotificationSubscription,
  UpsertNotificationSubscriptionInput,
} from "../../../domain/entities/NotificationSubscription.js";
import type { NotificationResourceType } from "../../../domain/entities/Notification.js";

interface NotificationSubscriptionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  resource_type: NotificationResourceType;
  event_type: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: NotificationSubscriptionRow): NotificationSubscription {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    resourceType: row.resource_type,
    eventType: row.event_type,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresNotificationSubscriptionRepository implements NotificationSubscriptionRepository {
  constructor(private readonly pool: Pool) {}

  async listForUser(tenantId: string, userId: string): Promise<NotificationSubscription[]> {
    const { rows } = await this.pool.query<NotificationSubscriptionRow>(
      `SELECT * FROM notification_subscriptions WHERE tenant_id = $1 AND user_id = $2 ORDER BY resource_type, event_type`,
      [tenantId, userId],
    );
    return rows.map(toDomain);
  }

  async getByKey(
    tenantId: string,
    userId: string,
    resourceType: NotificationResourceType,
    eventType: string,
  ): Promise<NotificationSubscription | null> {
    const { rows } = await this.pool.query<NotificationSubscriptionRow>(
      `SELECT * FROM notification_subscriptions
       WHERE tenant_id = $1 AND user_id = $2 AND resource_type = $3 AND event_type = $4`,
      [tenantId, userId, resourceType, eventType],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** ACT-200: upsert on the (tenant, user, resourceType, eventType) unique key — in-place update, never a new row per call. */
  async upsert(tenantId: string, userId: string, input: UpsertNotificationSubscriptionInput): Promise<NotificationSubscription> {
    const { rows } = await this.pool.query<NotificationSubscriptionRow>(
      `INSERT INTO notification_subscriptions (tenant_id, user_id, resource_type, event_type, enabled)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, user_id, resource_type, event_type)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
       RETURNING *`,
      [tenantId, userId, input.resourceType, input.eventType, input.enabled],
    );
    const row = rows[0];
    if (!row) throw new Error("Upsert into notification_subscriptions returned no row");
    return toDomain(row);
  }
}
