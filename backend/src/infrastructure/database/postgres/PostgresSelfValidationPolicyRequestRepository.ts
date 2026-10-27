import type { Pool } from "pg";
import type { SelfValidationPolicy } from "../../../domain/governance/selfValidation.js";
import type {
  PolicyChange,
  PolicyChangeResult,
  SelfValidationPolicyRequest,
  SelfValidationPolicyRequestRepository,
  SelfValidationPolicyRequestStatus,
} from "../../../domain/repositories/SelfValidationPolicyRequestRepository.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";
import { runAudited } from "./PostgresAuditRepository.js";
import { upsertConfigRow } from "./PostgresConfigRepository.js";

interface Row {
  id: string;
  tenant_id: string;
  requested_policy: SelfValidationPolicy;
  reason: string;
  status: SelfValidationPolicyRequestStatus;
  requested_by: string;
  requested_at: Date;
  decided_by: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  expires_at: Date | null;
}

const toDomain = (r: Row): SelfValidationPolicyRequest => ({
  id: r.id,
  tenantId: r.tenant_id,
  requestedPolicy: r.requested_policy,
  reason: r.reason,
  status: r.status,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at,
  decidedBy: r.decided_by,
  decidedAt: r.decided_at,
  decisionReason: r.decision_reason,
  expiresAt: r.expires_at ?? null,
});

async function insertRequest(
  db: Pick<Pool, "query">,
  tenantId: string,
  requestedPolicy: SelfValidationPolicy,
  reason: string,
  requestedBy: string,
  expiresAt: Date | null = null,
): Promise<SelfValidationPolicyRequest> {
  try {
    const { rows } = await db.query<Row>(
      `INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [tenantId, requestedPolicy, reason, requestedBy, expiresAt],
    );
    return toDomain(rows[0]!);
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ConflictError("A self-validation policy request is already pending");
    throw err;
  }
}

async function decideRequest(
  db: Pick<Pool, "query">,
  tenantId: string,
  id: string,
  status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">,
  decidedBy: string,
  decisionReason: string | null,
): Promise<SelfValidationPolicyRequest | null> {
  const { rows } = await db.query<Row>(
    `UPDATE self_validation_policy_requests
     SET status = $3, decided_by = $4, decided_at = now(), decision_reason = $5
     WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
     RETURNING *`,
    [tenantId, id, status, decidedBy, decisionReason],
  );
  return rows[0] ? toDomain(rows[0]) : null;
}

export class PostgresSelfValidationPolicyRequestRepository implements SelfValidationPolicyRequestRepository {
  /** DECISION-079: `change` inserts its audit events with the transaction client. */
  readonly auditsInTransaction = true;

  constructor(private readonly pool: Pool) {}

  async getPending(tenantId: string): Promise<SelfValidationPolicyRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM self_validation_policy_requests WHERE tenant_id = $1 AND status = 'PENDING'`,
      [tenantId],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<SelfValidationPolicyRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT * FROM self_validation_policy_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(tenantId: string, requestedPolicy: SelfValidationPolicy, reason: string, requestedBy: string, expiresAt: Date | null = null): Promise<SelfValidationPolicyRequest> {
    return insertRequest(this.pool, tenantId, requestedPolicy, reason, requestedBy, expiresAt);
  }

  async decide(
    tenantId: string,
    id: string,
    status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">,
    decidedBy: string,
    decisionReason: string | null,
  ): Promise<SelfValidationPolicyRequest | null> {
    return decideRequest(this.pool, tenantId, id, status, decidedBy, decisionReason);
  }

  /**
   * DECISION-079: claim -> (new request | policy write) -> audit rows, ONE transaction. A failing audit insert (or
   * a request decided meanwhile) rolls everything back: the policy never changes without its trace.
   */
  async change(tenantId: string, change: PolicyChange, audit: TransactionalAudit<PolicyChangeResult>): Promise<PolicyChangeResult> {
    return runAudited<PolicyChangeResult>(
      this.pool,
      async (db) => {
        let decided: SelfValidationPolicyRequest | null = null;
        if (change.decide) {
          const d = change.decide;
          decided = await decideRequest(db, tenantId, d.id, d.status, d.by, d.reason);
          if (!decided) throw new ConflictError("This request has already been decided");
        }
        const submitted = change.submit
          ? await insertRequest(db, tenantId, change.submit.policy, change.submit.reason, change.submit.by, change.submit.expiresAt ?? null)
          : null;
        const config = change.setPolicy ? await upsertConfigRow(db, tenantId, change.setPolicy.patch, change.setPolicy.updatedBy) : null;
        return { decided, submitted, config };
      },
      audit,
    );
  }
}
