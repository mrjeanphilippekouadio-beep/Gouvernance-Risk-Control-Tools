import type { Pool } from "pg";
import type {
  DelayChange,
  DelayChangeResult,
  GovernanceDelayRequest,
  GovernanceDelayRequestRepository,
  GovernanceDelays,
} from "../../../domain/repositories/GovernanceDelayRequestRepository.js";
import type { SelfValidationPolicyRequestStatus } from "../../../domain/repositories/SelfValidationPolicyRequestRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";
import { upsertConfigRow } from "./PostgresConfigRepository.js";

interface Row {
  id: string;
  tenant_id: string;
  requested_delays: GovernanceDelays;
  reason: string;
  status: SelfValidationPolicyRequestStatus;
  requested_by: string;
  requested_at: Date;
  expires_at: Date | null;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
}

const toDomain = (r: Row): GovernanceDelayRequest => ({
  id: r.id,
  tenantId: r.tenant_id,
  requestedDelays: r.requested_delays,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  expiresAt: r.expires_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionReason: r.decision_reason,
});

/** q182 (DECISION-095): lengthening requests of the governance delays (migration 076). */
export class PostgresGovernanceDelayRequestRepository implements GovernanceDelayRequestRepository {
  constructor(private readonly pool: Pool) {}

  async getPending(tenantId: string): Promise<GovernanceDelayRequest | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM governance_delay_requests WHERE tenant_id = $1 AND status = 'PENDING'`, [tenantId]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<GovernanceDelayRequest | null> {
    const { rows } = await this.pool.query<Row>(`SELECT * FROM governance_delay_requests WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  /** claim -> (new request | delays write) -> audit rows, ONE transaction: the delays never change without their trace. */
  async change(tenantId: string, change: DelayChange, audit: TransactionalAudit<DelayChangeResult>): Promise<DelayChangeResult> {
    return runAudited<DelayChangeResult>(
      this.pool,
      async (db) => {
        let decided: GovernanceDelayRequest | null = null;
        if (change.decide) {
          const d = change.decide;
          const { rows } = await db.query<Row>(
            `UPDATE governance_delay_requests
             SET status = $3, decided_by = $4, decided_at = now(), decision_reason = $5
             WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
               -- q174: an approval claim never applies an expired request (rechecked inside the transaction).
               AND ($3 <> 'APPLIED' OR expires_at IS NULL OR expires_at > now())
             RETURNING *`,
            [tenantId, d.id, d.status, d.by, d.reason],
          );
          if (!rows[0]) throw new ConflictError("This request has already been decided or has expired");
          decided = toDomain(rows[0]);
        }
        let submitted: GovernanceDelayRequest | null = null;
        if (change.submit) {
          const s = change.submit;
          try {
            const { rows } = await db.query<Row>(
              `INSERT INTO governance_delay_requests (tenant_id, requested_delays, reason, requested_by, expires_at)
               VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING *`,
              [tenantId, JSON.stringify(s.delays), s.reason, s.by, s.expiresAt],
            );
            submitted = toDomain(rows[0]!);
          } catch (err) {
            if ((err as { code?: string }).code === "23505") throw new ConflictError("A governance delay request is already pending");
            throw err;
          }
        }
        const config = change.setDelays ? await upsertConfigRow(db, tenantId, change.setDelays.patch, change.setDelays.updatedBy) : null;
        return { decided, submitted, config };
      },
      audit,
    );
  }
}
