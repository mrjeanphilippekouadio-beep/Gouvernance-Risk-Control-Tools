import type { Pool } from "pg";
import type { FeedbackRepository } from "../../../domain/repositories/FeedbackRepository.js";
import type { CreateFeedbackInput, Feedback, FeedbackCategory, FeedbackStatus } from "../../../domain/entities/Feedback.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface FeedbackRow {
  id: string;
  tenant_id: string;
  user_id: string;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  status: FeedbackStatus;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: FeedbackRow): Feedback {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    category: row.category,
    message: row.message,
    page: row.page,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresFeedbackRepository implements FeedbackRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateFeedbackInput): Promise<Feedback> {
    const { rows } = await this.pool.query<FeedbackRow>(
      `INSERT INTO feedback (tenant_id, user_id, category, message, page)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.tenantId, input.userId, input.category, input.message, input.page ?? null],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into feedback returned no row");
    return toDomain(row);
  }

  async getById(tenantId: string, id: string): Promise<Feedback | null> {
    const { rows } = await this.pool.query<FeedbackRow>(
      `SELECT * FROM feedback WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, options?: { status?: FeedbackStatus }): Promise<Feedback[]> {
    const statusFilter = options?.status ? "AND status = $2" : "";
    const values = options?.status ? [tenantId, options.status] : [tenantId];
    const { rows } = await this.pool.query<FeedbackRow>(
      `SELECT * FROM feedback WHERE tenant_id = $1 ${statusFilter} ORDER BY created_at DESC`,
      values,
    );
    return rows.map(toDomain);
  }

  async updateStatus(tenantId: string, id: string, status: FeedbackStatus): Promise<Feedback> {
    const { rows } = await this.pool.query<FeedbackRow>(
      `UPDATE feedback SET status = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, status],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("Feedback", id);
    return toDomain(row);
  }
}
