import type { Pool } from "pg";
import type { AuditRepository } from "../../../domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../../../domain/entities/AuditEvent.js";

interface AuditRow {
  id: string;
  tenant_id: string;
  timestamp: Date;
  user_id: string;
  entity_type: string;
  entity_id: string;
  action: AuditEvent["action"];
  old_value: unknown;
  new_value: unknown;
  reason: string | null;
  request_id: string;
}

function toDomain(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    timestamp: row.timestamp,
    userId: row.user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    oldValue: row.old_value,
    newValue: row.new_value,
    reason: row.reason,
    requestId: row.request_id,
  };
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log
         (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        event.tenantId,
        event.userId,
        event.entityType,
        event.entityId,
        event.action,
        event.oldValue !== undefined ? JSON.stringify(event.oldValue) : null,
        event.newValue !== undefined ? JSON.stringify(event.newValue) : null,
        event.reason,
        event.requestId,
      ],
    );
  }

  async listForEntity(tenantId: string, entityType: string, entityId: string): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_log
       WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
       ORDER BY "timestamp" DESC`,
      [tenantId, entityType, entityId],
    );
    return rows.map(toDomain);
  }

  async listRecent(tenantId: string, limit: number): Promise<AuditEvent[]> {
    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_log WHERE tenant_id = $1 ORDER BY "timestamp" DESC LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map(toDomain);
  }
}
