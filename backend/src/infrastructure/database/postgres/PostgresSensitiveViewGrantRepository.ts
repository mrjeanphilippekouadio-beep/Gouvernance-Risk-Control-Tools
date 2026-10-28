import type { Pool } from "pg";
import type {
  SensitiveViewGrant,
  SensitiveViewGrantRepository,
  SensitiveViewGrantStatus,
} from "../../../domain/repositories/SensitiveViewGrantRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";

interface Row {
  id: string;
  tenant_id: string;
  user_id: string;
  reason: string;
  status: SensitiveViewGrantStatus;
  requested_by: string;
  requested_at: Date;
  expires_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  revoked_by: string | null;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

const toDomain = (r: Row): SensitiveViewGrant => ({
  id: r.id,
  tenantId: r.tenant_id,
  userId: r.user_id,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionReason: r.decision_reason,
  revokedBy: r.revoked_by,
  revokedAt: r.revoked_at,
  revokeReason: r.revoke_reason,
});

const MAX_LISTED = 200;

/** q200 (DECISION-103): individual grants of role.read.sensitive (migration 079). */
export class PostgresSensitiveViewGrantRepository implements SensitiveViewGrantRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string): Promise<SensitiveViewGrant[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM sensitive_view_grants WHERE tenant_id = $1 ORDER BY requested_at DESC LIMIT ${MAX_LISTED}`, [tenantId]);
    return rows.map(toDomain);
  }

  async getById(tenantId: string, id: string): Promise<SensitiveViewGrant | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM sensitive_view_grants WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async isApproved(tenantId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM sensitive_view_grants WHERE tenant_id = $1 AND user_id = $2 AND status = 'APPROVED'`, [tenantId, userId]);
    return rows.length > 0;
  }

  async create(
    input: { tenantId: string; userId: string; reason: string; requestedBy: string; expiresAt: Date | null },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant> {
    return runAudited(this.pool, async (db) => {
      try {
        const { rows } = await db.query<Row>(
          `INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, requested_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [input.tenantId, input.userId, input.reason, input.requestedBy, input.expiresAt],
        );
        return toDomain(rows[0]!);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new ConflictError("This account already has a pending or active widened view");
        throw err;
      }
    }, audit);
  }

  async decide(
    tenantId: string,
    id: string,
    change: { status: "APPROVED" | "REJECTED"; by: string; reason: string | null },
    audit: TransactionalAudit<SensitiveViewGrant>,
  ): Promise<SensitiveViewGrant> {
    return runAudited(this.pool, async (db) => {
      const { rows } = await db.query<Row>(
        `UPDATE sensitive_view_grants SET status = $3, decided_by = $4, decided_at = now(), decision_reason = $5
         WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
           -- q174: a confirmation never applies an expired request (rechecked inside the transaction).
           AND ($3 <> 'APPROVED' OR expires_at IS NULL OR expires_at > now())
         RETURNING *`,
        [tenantId, id, change.status, change.by, change.reason],
      );
      if (!rows[0]) throw new ConflictError("This request has already been decided or has expired");
      return toDomain(rows[0]);
    }, audit);
  }

  async revoke(tenantId: string, id: string, change: { by: string; reason: string }, audit: TransactionalAudit<SensitiveViewGrant>): Promise<SensitiveViewGrant> {
    return runAudited(this.pool, async (db) => {
      const { rows } = await db.query<Row>(
        `UPDATE sensitive_view_grants SET status = 'REVOKED', revoked_by = $3, revoked_at = now(), revoke_reason = $4
         WHERE tenant_id = $1 AND id = $2 AND status IN ('PENDING', 'APPROVED') RETURNING *`,
        [tenantId, id, change.by, change.reason],
      );
      if (!rows[0]) throw new ConflictError("This widened view is already refused or revoked");
      return toDomain(rows[0]);
    }, audit);
  }
}
