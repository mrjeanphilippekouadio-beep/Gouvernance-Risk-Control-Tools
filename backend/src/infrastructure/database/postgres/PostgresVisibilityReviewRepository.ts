import type { Pool } from "pg";
import { insertAuditEvent } from "./PostgresAuditRepository.js";
import {
  VISIBILITY_REVIEW_PERIOD_MONTHS,
  type DueVisibilityReview,
  type ReviewableType,
  type VisibilityReviewRepository,
} from "../../../domain/repositories/VisibilityReviewRepository.js";

/** Marker of the audit line written by a confirmation (on the resource itself: entity_type / entity_id of the resource). */
const REVIEW_EVENT = "VISIBILITY_REVIEW";
const ENTITY: Record<ReviewableType, string> = { RISK: "Risk", CONTROL: "Control", ANOMALY: "Anomaly", ACTION_PLAN: "ActionPlan", KPI: "Kpi" };
const TABLE: Record<ReviewableType, string> = { RISK: "risks", CONTROL: "controls", ANOMALY: "anomalies", ACTION_PLAN: "action_plans", KPI: "kpis" };

/**
 * Every resource still restricted whose review clock ran out. $1 = tenant, $2 = months. Technical reads of audit_log (no retention
 * marks): (1) last confirmation of the resource; (2) start of the current restriction = last PERMISSION_CHANGE going from CLIENT
 * to restricted, else the creation date of the resource. Nothing else restarts the clock.
 */
const dueSql = (extra: string) => `
  SELECT * FROM (
    SELECT r.type, r.id, r.visibility,
           greatest(coalesce(rev.at, '-infinity'::timestamptz), coalesce(st.at, r.created_at)) AS clock,
           rev.at AS last_reviewed_at
    FROM (
      SELECT 'RISK' AS type, id, visibility, created_at, 'Risk' AS entity_type FROM risks WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
      UNION ALL SELECT 'CONTROL', id, visibility, created_at, 'Control' FROM controls WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
      UNION ALL SELECT 'ANOMALY', id, visibility, created_at, 'Anomaly' FROM anomalies WHERE tenant_id = $1 AND visibility <> 'CLIENT'
      UNION ALL SELECT 'ACTION_PLAN', id, visibility, created_at, 'ActionPlan' FROM action_plans WHERE tenant_id = $1 AND visibility <> 'CLIENT'
      UNION ALL SELECT 'KPI', id, visibility, created_at, 'Kpi' FROM kpis WHERE tenant_id = $1 AND deleted_at IS NULL AND visibility <> 'CLIENT'
    ) r
    LEFT JOIN LATERAL (
      SELECT a."timestamp" AS at FROM public.audit_log a
      WHERE a.tenant_id = $1 AND a.entity_type = r.entity_type AND a.entity_id = r.id
        AND a.action = 'UPDATE' AND a.new_value->>'event' = '${REVIEW_EVENT}'
      ORDER BY a."timestamp" DESC, a.id DESC LIMIT 1
    ) rev ON true
    LEFT JOIN LATERAL (
      SELECT a."timestamp" AS at FROM public.audit_log a
      WHERE a.tenant_id = $1 AND a.entity_type = r.entity_type AND a.entity_id = r.id AND a.action = 'PERMISSION_CHANGE'
        AND a.old_value->>'visibility' = 'CLIENT' AND a.new_value->>'visibility' <> 'CLIENT'
      ORDER BY a."timestamp" DESC, a.id DESC LIMIT 1
    ) st ON true
  ) due
  WHERE due.clock < now() - make_interval(months => $2::int)
    ${extra}`;

interface DueRow {
  type: ReviewableType; id: string; visibility: string; clock: Date; last_reviewed_at: Date | null;
}

export class PostgresVisibilityReviewRepository implements VisibilityReviewRepository {
  constructor(private readonly pool: Pool) {}

  async listDue(tenantId: string, limit: number): Promise<{ total: number; totalExcludingNominative: number; items: DueVisibilityReview[] }> {
    const { rows } = await this.pool.query<DueRow & { total: string; total_open: string }>(
      `SELECT d.*, count(*) OVER () AS total, count(*) FILTER (WHERE d.visibility <> 'NOMINATIF') OVER () AS total_open
       FROM (${dueSql("")}) d ORDER BY d.clock, d.type, d.id LIMIT $3`,
      [tenantId, VISIBILITY_REVIEW_PERIOD_MONTHS, limit],
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      totalExcludingNominative: Number(rows[0]?.total_open ?? 0),
      items: rows.map((r) => ({ resourceType: r.type, resourceId: r.id, visibility: r.visibility, dueSince: r.clock, lastReviewedAt: r.last_reviewed_at })),
    };
  }

  async confirm(tenantId: string, type: ReviewableType, id: string, userId: string, requestId: string): Promise<{ reviewedAt: Date } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serializes two confirmations of the same resource (the table name comes from a whitelist, never from the client).
      await client.query(`SELECT 1 FROM public.${TABLE[type]} WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [tenantId, id]);
      const due = await client.query<DueRow>(`SELECT * FROM (${dueSql("AND due.type = $3 AND due.id = $4")}) d`, [tenantId, VISIBILITY_REVIEW_PERIOD_MONTHS, type, id]);
      const row = due.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }
      const { rows } = await client.query<{ at: Date }>(`SELECT clock_timestamp() AS at`);
      const reviewedAt = rows[0]!.at;
      // On the resource itself, no reason text and no reason reference: it never re-exposes a text through GET /audit-logs.
      await insertAuditEvent(client, {
        tenantId, userId, entityType: ENTITY[type], entityId: id, action: "UPDATE",
        oldValue: { lastReviewedAt: row.last_reviewed_at, dueSince: row.clock },
        newValue: { event: REVIEW_EVENT, reviewedAt }, reason: null, requestId,
      }, true);
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
