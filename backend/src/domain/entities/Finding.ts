/**
 * New domain — Lot 4 (Audit module), GRC_Target_Domain_Model.md §9.2.
 * A Finding is an audit constat, raised during an AuditMission — distinct
 * from Incident (not necessarily a real event) and from Anomaly (not
 * necessarily born from a control execution), per distinction 2 in the
 * target domain model. Ticket-lifecycle pattern (one row, updated in
 * place, same shape as Anomaly/ActionPlan/AuditMission).
 *
 * MODELING DECISION — "suivi des recommandations" (explicitly flagged
 * "non tranché" by GRC_Target_Domain_Model.md §9.2): NOT built as a
 * separate `AuditRecommendation` entity here. `recommendation` is a
 * plain text field on Finding (the auditor's prescribed remedy, captured
 * at the same time as the constat) — and its *follow-up/tracking* is
 * exactly what an ActionPlan with `sourceType = "FINDING"` /
 * `sourceId = <this Finding's id>` already gives for free: status
 * (PLANIFIEE/EN_COURS/TERMINEE/EN_RETARD-computed), a responsible owner,
 * a due date, progress, mandatory evidence on close. Building a second,
 * parallel "recommendation" object with its own status machine would
 * duplicate ActionPlan's lifecycle for no new capability — it's the same
 * "ticket that must get done" shape ActionPlan already exists to be the
 * one place for (see ActionPlan.ts's module comment on why ActionPlan is
 * the established, reusable convergence point for every kind of
 * remediation across this codebase: RISK/CONTROL/KRI/AUDIT/INCIDENT/
 * MANAGEMENT, now FINDING). If a future requirement needs a
 * recommendation to exist and be tracked *before* any ActionPlan is
 * opened against it (e.g. recommendations pending assignment), that is
 * the trigger to split it out — not anticipated speculatively here.
 */

import type { GrcObjectType } from "../GrcObjectType.js";

/**
 * Subset of GrcObjectType a Finding may relate to (GRC_Target_Domain_Model.md
 * §9.2: "Peut être rattaché à un risque, un contrôle, un incident, une
 * anomalie"). Nullable at the entity level — a Finding need not be tied
 * to an existing object row at all (e.g. an organizational/process
 * observation with nothing to point at). INCIDENT is included in the
 * whitelist per the architecture doc but — like ActionPlan's AUDIT/
 * INCIDENT/MANAGEMENT sourceTypes — has no backing table in this
 * codebase yet, so relatedObjectId is accepted but not existence-checked
 * for it (see FindingService.assertRelatedObjectExists).
 */
export const FINDING_RELATED_OBJECT_TYPES = [
  "RISK",
  "CONTROL",
  "INCIDENT",
  "ANOMALY",
] as const satisfies readonly GrcObjectType[];

export type FindingRelatedObjectType = (typeof FINDING_RELATED_OBJECT_TYPES)[number];

/** Mirrors AnomalySeverity exactly (LOW/MODERATE/HIGH/MAJOR/CRITICAL) — same 5-level ordinal scale already established for a "how bad is this ticket" field on a constat-shaped entity, rather than inventing a second, parallel severity vocabulary. */
export type FindingSeverity = "LOW" | "MODERATE" | "HIGH" | "MAJOR" | "CRITICAL";

export type FindingStatus = "OUVERT" | "EN_TRAITEMENT" | "CLOS";

export interface Finding {
  id: string;
  tenantId: string;
  auditMissionId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  /** The auditor's prescribed remedy, free text — see module comment on why this isn't a separate entity. */
  recommendation: string | null;
  relatedObjectType: FindingRelatedObjectType | null;
  relatedObjectId: string | null;
  status: FindingStatus;
  /** Set to the actor who created the Finding — the maker in the close() maker-checker check. */
  raisedBy: string;
  closedBy: string | null;
  closedAt: Date | null;
  /** Mandatory on close, same convention as Anomaly/ActionPlan. */
  closureComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFindingInput {
  tenantId: string;
  auditMissionId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  recommendation?: string | null;
  relatedObjectType?: FindingRelatedObjectType | null;
  relatedObjectId?: string | null;
  raisedBy: string;
}

export interface FindingListFilters {
  auditMissionId?: string;
  status?: FindingStatus;
  severity?: FindingSeverity;
}
