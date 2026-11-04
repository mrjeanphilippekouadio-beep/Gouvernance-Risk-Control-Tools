import type { Pool } from "pg";
import type { GovernanceHealthRepository } from "../../../domain/repositories/GovernanceHealthRepository.js";
import type { ActiveAcceptance, FactRole, GovernanceFacts, MarkedAction } from "../../../domain/governance/health.js";
import type { SystemGroup } from "../../../domain/entities/Role.js";

/** Bound of the listed items (marked actions, unmarked self-validations); totals are always exact. */
export const HEALTH_LIST_LIMIT = 50;

/** Validations / closures that a self-validation guard protects (D4 inventory): the detective control looks at these. */
const VALIDATING_ACTIONS = `(
  (v.entity_type IN ('ControlExecution', 'ControlEffectivenessAssessment', 'RiskEvaluation', 'TreatmentDecision', 'ProcessEvaluationModeRequest') AND v.action = 'VALIDATE')
  OR (v.entity_type IN ('ActionPlan', 'Finding', 'ReviewCycle') AND v.action = 'CLOSE'))`;

/**
 * Lot D6: the facts behind GET /governance-health. Read-only, every query filtered by tenant_id. "Active" account =
 * `users.deleted_at IS NULL`; active assignment = not revoked, role not deleted (same definition as D4 and the 062 trigger).
 * Journal facts start at `tenants.governance_tracking_started_at` (q143): nothing before it is reconstituted.
 */
export class PostgresGovernanceHealthRepository implements GovernanceHealthRepository {
  constructor(private readonly pool: Pool) {}

  async loadFacts(tenantId: string, now: Date): Promise<GovernanceFacts> {
    const q = <T extends object>(sql: string, params: unknown[] = []) => this.pool.query<T>(sql, [tenantId, ...params]).then((r) => r.rows);
    const [tenant] = await q<{ tracked_since: Date; regime_active: boolean }>(
      `SELECT governance_tracking_started_at AS tracked_since,
              (single_person_regime_declared_at IS NOT NULL AND single_person_regime_lifted_at IS NULL) AS regime_active
       FROM tenants WHERE id = $1`,
    );
    if (!tenant) throw new Error("Tenant not found");
    const since = tenant.tracked_since;
    const [users, roles, assignments, configRows, ratifications, riskGaps, processGaps, marked, markedTotals, unmarked, unmarkedTotal, designations, vacancy, purgeRuns] =
      await Promise.all([
        q<{ id: string; label: string; active: boolean; roles: string[] }>(
          `SELECT id, display_name AS label, deleted_at IS NULL AS active, coalesce(roles, '{}') AS roles FROM users WHERE tenant_id = $1`,
        ),
        q<{ id: string; name: string; system_group: SystemGroup | null; permissions: string[] }>(
          `SELECT id, name, system_group, permissions FROM roles WHERE tenant_id = $1 AND deleted_at IS NULL`,
        ),
        q<{ user_id: string; role_id: string; granted_by: string }>(
          `SELECT ur.user_id, ur.role_id, ur.granted_by FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
           WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL`,
        ),
        q<{ cumul: boolean; enforced: boolean; min_score: number | null; review_delay: number | null; vacancy_max: number | null }>(
          `SELECT committee_audit_cumul_allowed AS cumul, committee_evaluation_enforced AS enforced,
                  committee_treatment_min_score AS min_score, exception_review_delay_days AS review_delay,
                  risk_manager_vacancy_max_days AS vacancy_max
           FROM configs WHERE tenant_id = $1`,
        ),
        q<{ id: string; regime: string; decider_group: string | null; decided_at: Date }>(
          `SELECT id, decision_regime AS regime, decider_group, decided_at FROM risk_framework_change_requests
           WHERE tenant_id = $1 AND status = 'APPROVED' AND ratification_status = 'PENDING' AND decision_regime IN ('FALLBACK', 'BOOTSTRAP')
           ORDER BY decided_at`,
        ),
        // Label only for an unrestricted risk: the panel must never show a restricted risk's content (lots V1 to V4).
        q<{ id: string; label: string | null; restricted: boolean; issue: "NO_OWNER" | "OWNER_SUSPENDED" }>(
          `SELECT r.id, CASE WHEN r.visibility = 'CLIENT' THEN r.description END AS label, r.visibility <> 'CLIENT' AS restricted,
                  CASE WHEN r.owner_id IS NULL THEN 'NO_OWNER' ELSE 'OWNER_SUSPENDED' END AS issue
           FROM risks r LEFT JOIN users u ON u.id = r.owner_id AND u.tenant_id = r.tenant_id
           WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.status <> 'ARCHIVED'
             AND (r.owner_id IS NULL OR u.deleted_at IS NOT NULL)
           ORDER BY r.created_at LIMIT ${HEALTH_LIST_LIMIT}`,
        ),
        q<{ id: string; label: string; missing_owner: boolean; missing_champion: boolean }>(
          `SELECT p.id, p.name AS label,
                  (p.owner_user_id IS NULL OR o.deleted_at IS NOT NULL) AS missing_owner,
                  (p.risk_champion_user_id IS NULL OR c.deleted_at IS NOT NULL) AS missing_champion
           FROM processes p
           LEFT JOIN users o ON o.id = p.owner_user_id AND o.tenant_id = p.tenant_id
           LEFT JOIN users c ON c.id = p.risk_champion_user_id AND c.tenant_id = p.tenant_id
           WHERE p.tenant_id = $1 AND p.active
             AND (p.owner_user_id IS NULL OR o.deleted_at IS NOT NULL OR p.risk_champion_user_id IS NULL OR c.deleted_at IS NOT NULL)
           ORDER BY p.name LIMIT ${HEALTH_LIST_LIMIT}`,
        ),
        q<{ id: string; at: Date; user_id: string; rule: string; entity_type: string; entity_id: string; action: string; reason: string | null; reviewed: boolean }>(
          `SELECT a.id, a."timestamp" AS at, a.user_id, a.governance_exception AS rule, a.entity_type, a.entity_id::text AS entity_id,
                  a.action, a.reason,
                  EXISTS (SELECT 1 FROM governance_exception_reviews r
                          WHERE r.tenant_id = a.tenant_id AND r.audit_log_id = a.id AND r.outcome = 'REVIEWED') AS reviewed
           FROM audit_log a
           WHERE a.tenant_id = $1 AND a.governance_exception IS NOT NULL AND a."timestamp" >= $2
           ORDER BY a."timestamp" DESC, a.id LIMIT ${HEALTH_LIST_LIMIT}`,
          [since],
        ),
        // 'riskManager.vacancy' is a trace, not a decision to review (same exclusion as the D5 count).
        q<{ total: string; unreviewed: string; oldest: Date | null }>(
          `SELECT count(*) AS total,
                  count(*) FILTER (WHERE NOT reviewed AND rule <> 'riskManager.vacancy') AS unreviewed,
                  min(at) FILTER (WHERE NOT reviewed AND rule <> 'riskManager.vacancy') AS oldest
           FROM (SELECT a."timestamp" AS at, a.governance_exception AS rule,
                        EXISTS (SELECT 1 FROM governance_exception_reviews r
                                WHERE r.tenant_id = a.tenant_id AND r.audit_log_id = a.id AND r.outcome = 'REVIEWED') AS reviewed
                 FROM audit_log a
                 WHERE a.tenant_id = $1 AND a.governance_exception IS NOT NULL AND a."timestamp" >= $2) m`,
          [since],
        ),
        q<{ id: string; at: Date; user_id: string; entity_type: string; entity_id: string; action: string }>(
          `${unmarkedSelfValidations("v.id, v.\"timestamp\" AS at, v.user_id, v.entity_type, v.entity_id::text AS entity_id, v.action")}
           ORDER BY v."timestamp" DESC, v.id LIMIT ${HEALTH_LIST_LIMIT}`,
          [since],
        ),
        q<{ n: string }>(unmarkedSelfValidations("count(*) AS n"), [since]),
        q<{ kind: string }>(
          `SELECT DISTINCT d.kind FROM governance_designations d
           JOIN users u ON u.id = d.user_id AND u.tenant_id = d.tenant_id AND u.deleted_at IS NULL
           WHERE d.tenant_id = $1 AND d.ended_at IS NULL`,
        ),
        q<{ since: Date | null }>(
          `SELECT max(a."timestamp") AS since FROM audit_log a
           WHERE a.tenant_id = $1 AND a.governance_exception = 'riskManager.vacancy'
             AND NOT EXISTS (SELECT 1 FROM user_roles ur
                             JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL AND r.system_group = 'RISK_MANAGER'
                             JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
                             WHERE ur.tenant_id = $1 AND ur.revoked_at IS NULL)`,
        ),
        q<{ at: Date | null }>(`SELECT max("timestamp") AS at FROM audit_log WHERE tenant_id = $1 AND entity_type = 'LastSeenPurge'`),
      ]);
    const config = configRows[0];
    const totals = markedTotals[0];
    const markedActions: MarkedAction[] = marked.map((m) => ({
      auditId: m.id, at: m.at, userId: m.user_id, rule: m.rule, entityType: m.entity_type, entityId: m.entity_id,
      action: m.action, reason: m.reason, reviewed: m.reviewed,
    }));
    return {
      now,
      trackedSince: since,
      users: users.map((u) => ({ id: u.id, label: u.label, active: u.active, directPermissions: u.roles })),
      roles: roles.map((r): FactRole => ({ id: r.id, name: r.name, systemGroup: r.system_group, permissions: r.permissions })),
      assignments: assignments.map((a) => ({ userId: a.user_id, roleId: a.role_id, grantedBy: a.granted_by })),
      config: config ? { committeeAuditCumulAllowed: config.cumul, committeeEvaluationEnforced: config.enforced, committeeTreatmentMinScore: config.min_score } : null,
      pendingRatifications: ratifications.map((r) => ({ requestId: r.id, regime: r.regime, deciderGroup: r.decider_group, decidedAt: r.decided_at })),
      riskOwnerGaps: riskGaps,
      processGaps: processGaps.map((p) => ({ id: p.id, label: p.label, missingOwner: p.missing_owner, missingChampion: p.missing_champion })),
      markedActions,
      markedTotal: Number(totals?.total ?? 0),
      unreviewedTotal: Number(totals?.unreviewed ?? 0),
      oldestUnreviewedAt: totals?.oldest ?? null,
      selfValidatedUnmarked: unmarked.map((v) => ({ auditId: v.id, at: v.at, userId: v.user_id, entityType: v.entity_type, entityId: v.entity_id, action: v.action })),
      selfValidatedUnmarkedTotal: Number(unmarkedTotal[0]?.n ?? 0),
      managerDesignated: designations.some((d) => d.kind === "MANAGER"),
      interimDesignated: designations.some((d) => d.kind === "RISK_MANAGER_INTERIM"),
      singlePersonRegimeActive: tenant.regime_active,
      riskManagerVacancySince: vacancy[0]?.since ?? null,
      riskManagerVacancyMaxDays: config?.vacancy_max ?? null,
      exceptionReviewDelayDays: config?.review_delay ?? null,
      lastSeenPurgeAt: purgeRuns[0]?.at ?? null,
    };
  }

  async activeAcceptances(tenantId: string): Promise<ActiveAcceptance[]> {
    const { rows } = await this.pool.query<{
      id: string; principle_id: string; expires_at: Date; reason: string; regime: string | null;
      accepted_by: string; confirmed_by: string | null; offenders_snapshot: unknown[];
    }>(
      `SELECT id, principle_id, expires_at, reason, regime, accepted_by, confirmed_by, offenders_snapshot
       FROM governance_principle_acceptances WHERE tenant_id = $1 AND status = 'ACTIVE'`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id, principleId: r.principle_id, expiresAt: r.expires_at, reason: r.reason, regime: r.regime,
      acceptedBy: r.accepted_by, confirmedBy: r.confirmed_by, offendersSnapshot: r.offenders_snapshot,
    }));
  }
}

/**
 * Contrôle détectif « validateur = auteur sans marqueur » (CMP-PNL-01): a validation or closure, since the start of the
 * tracking, by the account that created or submitted the same object, without the noSelfValidation marker.
 */
function unmarkedSelfValidations(select: string): string {
  return `SELECT ${select} FROM audit_log v
    WHERE v.tenant_id = $1 AND v."timestamp" >= $2 AND v.governance_exception IS NULL AND ${VALIDATING_ACTIONS}
      AND EXISTS (SELECT 1 FROM audit_log c
                  WHERE c.tenant_id = v.tenant_id AND c.entity_type = v.entity_type AND c.entity_id = v.entity_id
                    AND c.action IN ('CREATE', 'SUBMIT') AND c.user_id = v.user_id)`;
}
