import type { Pool } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import {
  VISIBILITY_REVIEW_PERIOD_MONTHS,
  type DueVisibilityReview,
  type VisibilityReviewRepository,
} from "../../../domain/repositories/VisibilityReviewRepository.js";

/**
 * Reasons that are the reason of the LAST visibility change (PERMISSION_CHANGE) of a resource still restricted, not ended, whose
 * last review (else creation) is older than the period. $1 = tenant, $2 = months. Technical read of audit_log (no retention marks).
 */
const dueSql = (extra: string) => `
  WITH restricted AS (
    SELECT 'RISK' AS type, id, 'Risk' AS entity_type FROM risks WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
    UNION ALL SELECT 'CONTROL', id, 'Control' FROM controls WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
    UNION ALL SELECT 'ANOMALY', id, 'Anomaly' FROM anomalies WHERE tenant_id = $1 AND visibility <> 'CLIENT'
    UNION ALL SELECT 'ACTION_PLAN', id, 'ActionPlan' FROM action_plans WHERE tenant_id = $1 AND visibility <> 'CLIENT'
    UNION ALL SELECT 'KPI', id, 'Kpi' FROM kpis WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
  )
  SELECT vr.id AS reason_id, vr.source, r.type, r.id AS resource_id, vr.created_at, vr.reviewed_at,
         count(*) OVER () AS total
  FROM restricted r
  JOIN LATERAL (
    SELECT a.reason_ref FROM audit_log a
    WHERE a.tenant_id = $1 AND a.action = 'PERMISSION_CHANGE' AND a.entity_id = r.id AND a.entity_type = r.entity_type
    ORDER BY a."timestamp" DESC LIMIT 1
  ) lc ON true
  JOIN public.visibility_reasons vr ON vr.tenant_id = $1 AND vr.id = lc.reason_ref
  WHERE vr.effect_ended_at IS NULL
    AND coalesce(vr.reviewed_at, vr.created_at) < now() - make_interval(months => $2::int)
    ${extra}`;

interface DueRow {
  reason_id: string; source: string; type: string; resource_id: string; created_at: Date; reviewed_at: Date | null; total: string;
}

export class PostgresVisibilityReviewRepository implements VisibilityReviewRepository {
  constructor(private readonly pool: Pool) {}

  async listDue(tenantId: string, limit: number): Promise<{ total: number; items: DueVisibilityReview[] }> {
    const { rows } = await this.pool.query<DueRow>(
      `${dueSql("")} ORDER BY coalesce(vr.reviewed_at, vr.created_at), vr.id, r.id LIMIT $3`,
      [tenantId, VISIBILITY_REVIEW_PERIOD_MONTHS, limit],
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      items: rows.map((r) => ({
        reasonId: r.reason_id, source: r.source, resourceType: r.type, resourceId: r.resource_id, createdAt: r.created_at, reviewedAt: r.reviewed_at,
      })),
    };
  }

  async confirm(tenantId: string, reasonId: string, userId: string, requestId: string): Promise<{ reviewedAt: Date } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM public.visibility_reasons WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, reasonId]);
      const due = await client.query<DueRow>(`${dueSql("AND vr.id = $3")} ORDER BY r.id`, [tenantId, VISIBILITY_REVIEW_PERIOD_MONTHS, reasonId]);
      const first = due.rows[0];
      if (!first) {
        await client.query("ROLLBACK");
        return null;
      }
      const { rows } = await client.query<{ reviewed_at: Date }>(
        `UPDATE public.visibility_reasons SET reviewed_at = clock_timestamp() WHERE tenant_id = $1 AND id = $2 RETURNING reviewed_at`,
        [tenantId, reasonId],
      );
      const reviewedAt = rows[0]!.reviewed_at;
      // No reason text, no reason_ref: the line names the reason by id only (it never re-exposes the text through GET /audit-logs).
      await insertAuditEvent(client, {
        tenantId, userId, entityType: "VisibilityReason", entityId: reasonId, action: "UPDATE",
        oldValue: { reviewedAt: first.reviewed_at },
        newValue: { reviewedAt, source: first.source, resources: due.rows.map((r) => ({ type: r.type, id: r.resource_id })) },
        reason: null, requestId,
      });
      await client.query("COMMIT");
      return { reviewedAt };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
