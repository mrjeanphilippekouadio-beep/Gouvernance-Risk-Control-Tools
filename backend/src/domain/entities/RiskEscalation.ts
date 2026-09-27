/**
 * ACT-125: append-only escalation history for a Risk, like
 * ControlExecution/ControlEffectivenessAssessment — a new row per
 * escalation, no update, no delete. Exists specifically so "consulter
 * l'historique" of escalations for a risk is a real query rather than
 * something reconstructed from a Notifier's fire-and-forget message
 * (which is fine for alerting but not for an auditable record).
 *
 * `superiorOwnerId` is captured at escalation time (a snapshot), not
 * re-derived from `Risk.superiorOwnerId` when read later — if the
 * superior owner is reassigned after an escalation, this row must still
 * say who was actually notified at the time.
 */
export interface RiskEscalation {
  id: string;
  tenantId: string;
  riskId: string;
  escalatedBy: string;
  superiorOwnerId: string;
  reason: string;
  createdAt: Date;
}

export interface CreateRiskEscalationInput {
  tenantId: string;
  riskId: string;
  escalatedBy: string;
  superiorOwnerId: string;
  reason: string;
}
