import type { Pool } from "pg";
import type { AuditRepository, AuditSearchFilters } from "../../../domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../../../domain/entities/AuditEvent.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";

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
  governance_exception: string | null;
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
    governanceException: row.governance_exception ?? null,
  };
}

/** The single INSERT into audit_log; `db` may be a pool or a transaction client (q90: same transaction). */
export async function insertAuditEvent(db: Pick<Pool, "query">, event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
  await db.query(
    `INSERT INTO audit_log
       (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id, governance_exception)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
      event.governanceException ?? null,
    ],
  );
}

/**
 * DECISION-079: the write and its audit rows in ONE transaction (a failing audit insert rolls the write back).
 * Without `audit`, `write` just runs on the pool (callers that do not audit in the repository, test fakes).
 */
export async function runAudited<T>(
  pool: Pool,
  write: (db: Pick<Pool, "query">) => Promise<T>,
  audit?: TransactionalAudit<T>,
): Promise<T> {
  if (!audit) return write(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await write(client);
    for (const event of audit(out)) await insertAuditEvent(client, event);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export class PostgresAuditRepository implements AuditRepository {
  constructor(private readonly pool: Pool) {}

  async record(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    await insertAuditEvent(this.pool, event);
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

  async search(tenantId: string, filters: AuditSearchFilters, limit: number): Promise<AuditEvent[]> {
    const conditions = ["tenant_id = $1"];
    const values: unknown[] = [tenantId];
    let i = 2;

    if (filters.userId !== undefined) {
      conditions.push(`user_id = $${i++}`);
      values.push(filters.userId);
    }
    if (filters.action !== undefined) {
      conditions.push(`action = $${i++}`);
      values.push(filters.action);
    }
    if (filters.entityType !== undefined) {
      conditions.push(`entity_type = $${i++}`);
      values.push(filters.entityType);
    }
    if (filters.entityId !== undefined) {
      conditions.push(`entity_id = $${i++}`);
      values.push(filters.entityId);
    }
    if (filters.from !== undefined) {
      conditions.push(`"timestamp" >= $${i++}`);
      values.push(filters.from);
    }
    if (filters.to !== undefined) {
      conditions.push(`"timestamp" <= $${i++}`);
      values.push(filters.to);
    }
    if (typeof filters.governanceException === "string") {
      conditions.push(`governance_exception = $${i++}`);
      values.push(filters.governanceException);
    } else if (filters.governanceException === true) {
      conditions.push("governance_exception IS NOT NULL");
    }
    values.push(limit);

    const { rows } = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_log WHERE ${conditions.join(" AND ")} ORDER BY "timestamp" DESC LIMIT $${i}`,
      values,
    );
    return rows.map(toDomain);
  }
}
