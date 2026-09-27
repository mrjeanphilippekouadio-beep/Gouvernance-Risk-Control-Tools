/**
 * New domain — no apps-script-legacy precedent (ACT-190..196). An
 * ActionPlan ("action corrective") is a remediation ticket, structurally
 * close to Anomaly: one row with a lifecycle, not append-only. Closing
 * is the terminal transition and requires mandatory evidence (rather
 * than just a comment, unlike Anomaly).
 *
 * Source is polymorphic (ACT-190): `sourceType` says which kind of
 * entity triggered the action, `sourceId` points at that entity's row
 * *only* when it's one of RISK/CONTROL/KRI — AUDIT/INCIDENT/MANAGEMENT
 * actions aren't tied to an existing entity row in this system, so
 * `sourceId` is null for those (enforced in ActionPlanService, not the
 * DB, since a polymorphic FK can't be expressed as a real constraint).
 *
 * `status` only ever stores PLANIFIEE/EN_COURS/TERMINEE (ACT-192).
 * EN_RETARD is deliberately never stored: this codebase has no
 * scheduler/cron that could flip a stored status when a due date
 * passes, so "late" is computed at read time from `dueDate` vs `now()`
 * — see `computeActionPlanStatus`, same technique as
 * `Kri.computeKriStatus`. This also means EN_RETARD can never go stale:
 * an action whose due date is in the past is *always* reported as late
 * on every read, with no background job required to keep it in sync.
 *
 * Judgment call: the backlog's ACT-192 rule text reads literally as
 * "Planifiée→En retard si date dépassée" (i.e. only a not-yet-started
 * action can be "late"). This implementation instead treats EN_RETARD
 * as applicable whenever `status !== 'TERMINEE'` (so PLANIFIEE *or*
 * EN_COURS) and the due date has passed — an action that was started
 * but still isn't finished by its deadline is, if anything, more late
 * than one that was never started. Flagged explicitly as a design
 * decision in the handoff summary rather than silently picking one.
 */
export type ActionPlanSourceType = "RISK" | "CONTROL" | "KRI" | "AUDIT" | "INCIDENT" | "MANAGEMENT";

/** Stored statuses only — EN_RETARD is never one of these, see above. */
export type ActionPlanStatus = "PLANIFIEE" | "EN_COURS" | "TERMINEE";

/** What a read path actually reports — stored status, or EN_RETARD when computed at read time. */
export type ActionPlanComputedStatus = ActionPlanStatus | "EN_RETARD";

/** ACT-193: computed, never stored — HIGH exactly when computedStatus is EN_RETARD. */
export type ActionPlanPriority = "NORMAL" | "HIGH";

/** ACT-194: resource kinds an action can link to, beyond its own (optional) source. */
export type ActionLinkResourceType = "RISK" | "CONTROL" | "KRI" | "ANOMALY";

export interface ActionPlan {
  id: string;
  tenantId: string;
  title: string;
  description: string | null;
  sourceType: ActionPlanSourceType;
  /** Null for AUDIT/INCIDENT/MANAGEMENT; validated to exist in-tenant for RISK/CONTROL/KRI. */
  sourceId: string | null;
  responsibleUserId: string;
  departmentId: string | null;
  dueDate: Date;
  status: ActionPlanStatus;
  /** 0-100, updated only through ActionPlanService.updateProgress (ACT-191). */
  progressPercent: number;
  /**
   * Judgment call (progress history storage): only the *latest* progress
   * note is kept on the row, not a growing history array/JSONB column.
   * The append-only `audit_logs` table already records oldValue/newValue
   * + timestamp + actor on every `updateProgress` call, which is a
   * complete, tamper-evident history of every percent/comment change —
   * building a second, redundant history mechanism (a `history` JSONB
   * column) on the row itself would duplicate that without adding
   * anything a dashboard couldn't already get from
   * `GET /audit-log?entityType=ActionPlan&entityId=...`. Picked the
   * simpler option per the task brief; if a future requirement needs the
   * history inline in the ActionPlan read payload (not just via a
   * separate audit-log call), revisit as a JSONB `history` column.
   */
  progressComment: string | null;
  /** Mandatory on close (ACT-195) — an Evidence row, validated to exist in-tenant. */
  evidenceId: string | null;
  /** Set at creation, never changed — the maker in the close() maker-checker check (ACT-195). */
  createdBy: string;
  closedBy: string | null;
  closedAt: Date | null;
  closureComment: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateActionPlanInput {
  tenantId: string;
  title: string;
  description?: string | null;
  sourceType: ActionPlanSourceType;
  sourceId?: string | null;
  responsibleUserId: string;
  departmentId?: string | null;
  dueDate: Date;
  createdBy: string;
}

/** ACT-194: pure link/join rows — see the control_risks exemption in CLAUDE.md. */
export interface ActionLink {
  resourceType: ActionLinkResourceType;
  resourceId: string;
}

export interface ActionPlanListFilters {
  /** Stored-status filter only — EN_RETARD is applied client-side in the service after computing (see ActionPlanService.dashboard). */
  status?: ActionPlanStatus;
  sourceType?: ActionPlanSourceType;
  responsibleUserId?: string;
  departmentId?: string;
  dueFrom?: Date;
  dueTo?: Date;
}

/**
 * Pure function, no I/O — mirrors `computeKriStatus`: kept next to the
 * entity so it's trivially unit testable and reusable by both the
 * service and (if ever needed) the frontend without re-deriving the
 * rule. `now` is injectable for tests.
 */
export function computeActionPlanStatus(
  action: Pick<ActionPlan, "status" | "dueDate">,
  now: Date = new Date(),
): ActionPlanComputedStatus {
  if (action.status === "TERMINEE") return "TERMINEE";
  return action.dueDate.getTime() < now.getTime() ? "EN_RETARD" : action.status;
}

/** ACT-193: computed priority flag, HIGH exactly when the computed status is EN_RETARD. */
export function computeActionPlanPriority(computedStatus: ActionPlanComputedStatus): ActionPlanPriority {
  return computedStatus === "EN_RETARD" ? "HIGH" : "NORMAL";
}

/** What every read path (get/list/dashboard) actually returns — stored fields plus the two computed ones. */
export type ActionPlanView = ActionPlan & {
  computedStatus: ActionPlanComputedStatus;
  priority: ActionPlanPriority;
};
