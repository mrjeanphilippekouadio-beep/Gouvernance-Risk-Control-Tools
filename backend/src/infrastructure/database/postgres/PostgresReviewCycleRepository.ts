import type { Pool } from "pg";
import type { ReviewCycleRepository } from "../../../domain/repositories/ReviewCycleRepository.js";
import type {
  CreateReviewCycleInput,
  ListReviewCyclesOptions,
  ReviewCycle,
  ReviewCycleStatus,
  ReviewCycleType,
} from "../../../domain/entities/ReviewCycle.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface ReviewCycleRow {
  id: string;
  tenant_id: string;
  type: ReviewCycleType;
  title: string;
  scope: string | null;
  reason: string | null;
  status: ReviewCycleStatus;
  created_by: string;
  proposed_closure_by: string | null;
  proposed_closure_at: Date | null;
  proposed_closure_comment: string | null;
  closed_by: string | null;
  closed_at: Date | null;
  closure_comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: ReviewCycleRow): ReviewCycle {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type,
    title: row.title,
    scope: row.scope,
    reason: row.reason,
    status: row.status,
    createdBy: row.created_by,
    proposedClosureBy: row.proposed_closure_by,
    proposedClosureAt: row.proposed_closure_at,
    proposedClosureComment: row.proposed_closure_comment,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closureComment: row.closure_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresReviewCycleRepository implements ReviewCycleRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<ReviewCycle | null> {
    const { rows } = await this.pool.query<ReviewCycleRow>(`SELECT * FROM review_cycles WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      id,
    ]);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: ListReviewCyclesOptions): Promise<ReviewCycle[]> {
    const conditions = ["tenant_id = $1"];
    const values: unknown[] = [tenantId];
    if (options?.status) {
      values.push(options.status);
      conditions.push(`status = $${values.length}`);
    }
    if (options?.type) {
      values.push(options.type);
      conditions.push(`type = $${values.length}`);
    }
    const { rows } = await this.pool.query<ReviewCycleRow>(
      `SELECT * FROM review_cycles WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
      values,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateReviewCycleInput): Promise<ReviewCycle> {
    const { rows } = await this.pool.query<ReviewCycleRow>(
      `INSERT INTO review_cycles (tenant_id, type, title, scope, reason, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'OUVERT', $6)
       RETURNING *`,
      [input.tenantId, input.type, input.title, input.scope, input.reason, input.createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into review_cycles returned no row");
    return toDomain(row);
  }

  async proposeClosure(tenantId: string, id: string, proposedBy: string, comment: string | null): Promise<ReviewCycle> {
    const { rows } = await this.pool.query<ReviewCycleRow>(
      `UPDATE review_cycles
       SET status = 'CLOTURE_PROPOSEE', proposed_closure_by = $3, proposed_closure_at = now(), proposed_closure_comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, proposedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ReviewCycle", id);
    return toDomain(row);
  }

  async close(tenantId: string, id: string, closedBy: string, comment: string | null): Promise<ReviewCycle> {
    const { rows } = await this.pool.query<ReviewCycleRow>(
      `UPDATE review_cycles
       SET status = 'CLOTUREE', closed_by = $3, closed_at = now(), closure_comment = $4, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, closedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ReviewCycle", id);
    return toDomain(row);
  }
}
