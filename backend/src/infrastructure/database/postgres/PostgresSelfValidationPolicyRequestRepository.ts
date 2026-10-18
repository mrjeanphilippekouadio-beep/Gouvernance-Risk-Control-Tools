import type { Pool } from "pg";
import type { SelfValidationPolicy } from "../../../domain/governance/selfValidation.js";
import type {
  SelfValidationPolicyRequest,
  SelfValidationPolicyRequestRepository,
  SelfValidationPolicyRequestStatus,
} from "../../../domain/repositories/SelfValidationPolicyRequestRepository.js";
import { ConflictError } from "../../../domain/errors/DomainErrors.js";

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
});

export class PostgresSelfValidationPolicyRequestRepository implements SelfValidationPolicyRequestRepository {
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

  async create(tenantId: string, requestedPolicy: SelfValidationPolicy, reason: string, requestedBy: string): Promise<SelfValidationPolicyRequest> {
    try {
      const { rows } = await this.pool.query<Row>(
        `INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, requestedPolicy, reason, requestedBy],
      );
      return toDomain(rows[0]!);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") throw new ConflictError("A self-validation policy request is already pending");
      throw err;
    }
  }

  async decide(
    tenantId: string,
    id: string,
    status: Exclude<SelfValidationPolicyRequestStatus, "PENDING">,
    decidedBy: string,
    decisionReason: string | null,
  ): Promise<SelfValidationPolicyRequest | null> {
    const { rows } = await this.pool.query<Row>(
      `UPDATE self_validation_policy_requests
       SET status = $3, decided_by = $4, decided_at = now(), decision_reason = $5
       WHERE tenant_id = $1 AND id = $2 AND status = 'PENDING'
       RETURNING *`,
      [tenantId, id, status, decidedBy, decisionReason],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async reopen(tenantId: string, id: string): Promise<void> {
    await this.pool.query(
      `UPDATE self_validation_policy_requests
       SET status = 'PENDING', decided_by = NULL, decided_at = NULL, decision_reason = NULL
       WHERE tenant_id = $1 AND id = $2 AND status IN ('APPLIED', 'REJECTED')`,
      [tenantId, id],
    );
  }
}
