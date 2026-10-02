/**
 * New domain — Lot 4 (Audit module), GRC_Target_Domain_Model.md §9.1.
 * The entry point of the Finding->ActionPlan chain: an AuditMission is
 * the frame ("mission d'audit") an auditor opens before any Finding can
 * be raised. Ticket-lifecycle pattern (same shape as Anomaly/ActionPlan
 * — one row, updated in place, never append-only).
 *
 * `scope` is deliberately free text, not a polymorphic
 * (GrcObjectType/id) pair: a mission's audited perimeter ("quel
 * processus/dispositif/département") is frequently broader than, or
 * spans several of, the object kinds GrcObjectType enumerates (Process
 * and Department aren't GrcObjectType members at all today), and
 * GRC_Target_Domain_Model.md §9.1 itself only lists `scope` as a plain
 * attribute. Per-object linkage to something GrcObjectType *does* cover
 * (a specific Risk/Control/Incident/Anomaly) happens one level down, on
 * each Finding raised during the mission (relatedObjectType/Id) — that
 * is where the whitelist actually earns its keep, not here.
 */

export type AuditMissionStatus = "PLANIFIEE" | "EN_COURS" | "CLOTUREE";

export interface AuditMission {
  id: string;
  tenantId: string;
  /** Human-facing mission code, e.g. "AUD-2026-014" — caller-supplied, not generated (mirrors no other entity having one yet, kept simple). */
  reference: string;
  title: string;
  /** Free text: what's being audited (a process, a department, a broader dispositif) — see module comment. */
  scope: string;
  status: AuditMissionStatus;
  leadAuditorId: string;
  /** Other auditors on the mission team, beyond the lead — plain id array, no independent lifecycle of its own (same judgment call as RatingScale's JSONB sub-lists: a list of values, not a set of entities with identity). */
  auditorIds: string[];
  plannedStartDate: Date;
  plannedEndDate: Date;
  /** Set automatically by AuditMissionService.start(), never client-supplied. */
  actualStartDate: Date | null;
  /** Set automatically by AuditMissionService.close(), never client-supplied. */
  actualEndDate: Date | null;
  /** Mandatory on close (mirrors Anomaly/ActionPlan's "no terminal transition without saying why"). */
  closureComment: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAuditMissionInput {
  tenantId: string;
  reference: string;
  title: string;
  scope: string;
  leadAuditorId: string;
  auditorIds?: string[];
  plannedStartDate: Date;
  plannedEndDate: Date;
  createdBy: string;
}

export interface AuditMissionListFilters {
  status?: AuditMissionStatus;
  leadAuditorId?: string;
}
