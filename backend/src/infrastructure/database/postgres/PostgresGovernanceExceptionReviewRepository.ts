import type { Pool } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import type { ExceptionReviewOutcome, GovernanceExceptionReview, ReviewableAuditEntry } from "../../../domain/entities/GovernanceReviews.js";
import type { TransactionalAudit } from "../../../domain/entities/RiskFramework.js";
import type {
  GovernanceExceptionReviewRepository,
  InsertExceptionReviewInput,
} from "../../../domain/repositories/GovernanceReviewRepositories.js";
import { ConflictError, ForbiddenError } from "../../../domain/errors/DomainErrors.js";

interface Row {
  id: string;
  tenant_id: string;
  audit_log_id: string;
  outcome: ExceptionReviewOutcome;
  reviewed_by: string;
  reviewed_at: Date;
  comment: string;
}

const toDomain = (r: Row): GovernanceExceptionReview => ({
  id: r.id,
  tenantId: r.tenant_id,
  auditLogId: r.audit_log_id,
  outcome: r.outcome,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  comment: r.comment,
});

const pgCode = (err: unknown): unknown => (typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined);

export class PostgresGovernanceExceptionReviewRepository implements GovernanceExceptionReviewRepository {
  constructor(private readonly pool: Pool) {}

  /** "Reviewable" = marked as an exception, or the submission of a profile that lowers the size (q157: the Audit can contest it). */
  async getAuditEntry(tenantId: string, auditLogId: string): Promise<ReviewableAuditEntry | null> {
    const { rows } = await this.pool.query<{
      id: string; user_id: string; entity_type: string; entity_id: string; action: string; governance_exception: string | null; reviewable: boolean;
    }>(
      `SELECT id, user_id, entity_type, entity_id, action, governance_exception,
              (governance_exception IS NOT NULL
               OR (entity_type = 'OrganizationProfile' AND action = 'SUBMIT' AND new_value->>'lowersSize' = 'true')) AS reviewable
       FROM audit_log WHERE tenant_id = $1 AND id = $2`,
      [tenantId, auditLogId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          userId: r.user_id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          action: r.action,
          governanceException: r.governance_exception,
          reviewable: r.reviewable,
        }
      : null;
  }

  async insert(
    input: InsertExceptionReviewInput,
    audit: TransactionalAudit<GovernanceExceptionReview>,
  ): Promise<GovernanceExceptionReview> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<Row>(
        `INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [input.tenantId, input.auditLogId, input.outcome, input.reviewedBy, input.comment],
      );
      const row = rows[0];
      if (!row) throw new Error("Insert into governance_exception_reviews returned no row");
      const review = toDomain(row);
      for (const event of audit(review)) await insertAuditEvent(client, event);
      await client.query("COMMIT");
      return review;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (pgCode(err) === "23505") throw new ConflictError("You have already reviewed this entry");
      // The guard trigger (42501): author of the action, or an entry of another tenant.
      if (pgCode(err) === "42501") throw new ForbiddenError("This entry cannot be reviewed by you");
      throw err;
    } finally {
      client.release();
    }
  }
}
