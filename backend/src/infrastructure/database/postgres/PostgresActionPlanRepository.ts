import type { Pool, PoolClient } from "pg";
import type { ActionPlanRepository } from "../../../domain/repositories/ActionPlanRepository.js";
import type {
  ActionLink,
  ActionLinkResourceType,
  ActionPlan,
  ActionPlanListFilters,
  ActionPlanSourceType,
  ActionPlanStatus,
  CreateActionPlanInput,
} from "../../../domain/entities/ActionPlan.js";
import { NotFoundError } from "../../../domain/errors/DomainErrors.js";

interface ActionPlanRow {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  source_type: ActionPlanSourceType;
  source_id: string | null;
  responsible_user_id: string;
  department_id: string | null;
  due_date: Date;
  status: ActionPlanStatus;
  progress_percent: number;
  progress_comment: string | null;
  evidence_id: string | null;
  created_by: string;
  closed_by: string | null;
  closed_at: Date | null;
  closure_comment: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDomain(row: ActionPlanRow): ActionPlan {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    sourceType: row.source_type,
    sourceId: row.source_id,
    responsibleUserId: row.responsible_user_id,
    departmentId: row.department_id,
    dueDate: row.due_date,
    status: row.status,
    progressPercent: row.progress_percent,
    progressComment: row.progress_comment,
    evidenceId: row.evidence_id,
    createdBy: row.created_by,
    closedBy: row.closed_by,
    closedAt: row.closed_at,
    closureComment: row.closure_comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listLinksFor(client: Pool | PoolClient, tenantId: string, actionId: string): Promise<ActionLink[]> {
  const { rows } = await client.query<{ resource_type: ActionLinkResourceType; resource_id: string }>(
    `SELECT resource_type, resource_id FROM action_links WHERE tenant_id = $1 AND action_id = $2`,
    [tenantId, actionId],
  );
  return rows.map((r) => ({ resourceType: r.resource_type, resourceId: r.resource_id }));
}

export class PostgresActionPlanRepository implements ActionPlanRepository {
  constructor(private readonly pool: Pool) {}

  async getById(tenantId: string, id: string): Promise<ActionPlan | null> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `SELECT * FROM action_plans WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async list(tenantId: string, filters?: ActionPlanListFilters): Promise<ActionPlan[]> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: unknown[] = [tenantId];

    if (filters?.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters?.sourceType) {
      params.push(filters.sourceType);
      conditions.push(`source_type = $${params.length}`);
    }
    if (filters?.responsibleUserId) {
      params.push(filters.responsibleUserId);
      conditions.push(`responsible_user_id = $${params.length}`);
    }
    if (filters?.departmentIds && filters.departmentIds.length > 0) {
      params.push(filters.departmentIds);
      conditions.push(`department_id = ANY($${params.length})`);
    }
    if (filters?.dueFrom) {
      params.push(filters.dueFrom);
      conditions.push(`due_date >= $${params.length}`);
    }
    if (filters?.dueTo) {
      params.push(filters.dueTo);
      conditions.push(`due_date <= $${params.length}`);
    }

    const { rows } = await this.pool.query<ActionPlanRow>(
      `SELECT * FROM action_plans WHERE ${conditions.join(" AND ")} ORDER BY due_date ASC`,
      params,
    );
    return rows.map(toDomain);
  }

  async create(input: CreateActionPlanInput): Promise<ActionPlan> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `INSERT INTO action_plans
         (tenant_id, title, description, source_type, source_id, responsible_user_id,
          department_id, due_date, created_by, status, progress_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PLANIFIEE', 0)
       RETURNING *`,
      [
        input.tenantId,
        input.title,
        input.description ?? null,
        input.sourceType,
        input.sourceId ?? null,
        input.responsibleUserId,
        input.departmentId ?? null,
        input.dueDate,
        input.createdBy,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into action_plans returned no row");
    return toDomain(row);
  }

  async updateProgress(tenantId: string, id: string, progressPercent: number, comment: string | null): Promise<ActionPlan> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `UPDATE action_plans
       SET progress_percent = $3,
           progress_comment = $4,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, progressPercent, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ActionPlan", id);
    return toDomain(row);
  }

  async start(tenantId: string, id: string): Promise<ActionPlan> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `UPDATE action_plans
       SET status = 'EN_COURS',
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status = 'PLANIFIEE'
       RETURNING *`,
      [tenantId, id],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ActionPlan", id);
    return toDomain(row);
  }

  async close(tenantId: string, id: string, closedBy: string, evidenceId: string, comment: string | null): Promise<ActionPlan> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `UPDATE action_plans
       SET status = 'TERMINEE',
           progress_percent = 100,
           evidence_id = $3,
           closed_by = $4,
           closed_at = now(),
           closure_comment = $5,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND status <> 'TERMINEE'
       RETURNING *`,
      [tenantId, id, evidenceId, closedBy, comment],
    );
    const row = rows[0];
    if (!row) throw new NotFoundError("ActionPlan", id);
    return toDomain(row);
  }

  async listLinks(tenantId: string, actionId: string): Promise<ActionLink[]> {
    return listLinksFor(this.pool, tenantId, actionId);
  }

  /**
   * DECISION-003: a risk's action plans, combining both ways one can be
   * tied to it — directly via `source_type/source_id`, or indirectly via
   * an `action_links` row — in a single query (no N+1 across either the
   * tenant's full action plan list or a per-action link lookup).
   */
  async listForRisk(tenantId: string, riskId: string): Promise<ActionPlan[]> {
    const { rows } = await this.pool.query<ActionPlanRow>(
      `SELECT DISTINCT ap.* FROM action_plans ap
       LEFT JOIN action_links al ON al.tenant_id = ap.tenant_id AND al.action_id = ap.id
       WHERE ap.tenant_id = $1
         AND (
           (ap.source_type = 'RISK' AND ap.source_id = $2)
           OR (al.resource_type = 'RISK' AND al.resource_id = $2)
         )
       ORDER BY ap.due_date ASC`,
      [tenantId, riskId],
    );
    return rows.map(toDomain);
  }

  async replaceLinks(tenantId: string, actionId: string, links: ActionLink[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // action_links is a pure link table (see the control_risks
      // exemption in CLAUDE.md) — rebuilt by delete + insert rather than
      // soft-deleted, but still tenant-scoped so this can never touch
      // another tenant's row even if actionId were reused.
      await client.query(`DELETE FROM action_links WHERE tenant_id = $1 AND action_id = $2`, [tenantId, actionId]);
      for (const link of links) {
        await client.query(
          `INSERT INTO action_links (tenant_id, action_id, resource_type, resource_id) VALUES ($1, $2, $3, $4)`,
          [tenantId, actionId, link.resourceType, link.resourceId],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
