import { ForbiddenError } from "./errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

/**
 * Permission scopes, per ADR-001 / architecture doc §4 "un véritable
 * moteur de permissions". Checked in services — never left to the
 * frontend, and never inferred from "the caller is authenticated".
 */
export type Permission =
  | "risk.read"
  | "risk.create"
  | "risk.update"
  | "risk.delete"
  | "evidence.read"
  | "evidence.download"
  | "evidence.upload"
  | "evidence.delete"
  | "evidence.import"
  | "control.read"
  | "control.create"
  | "control.update"
  | "control.delete"
  | "execution.read"
  | "execution.create"
  | "execution.validate"
  | "effectiveness.read"
  | "effectiveness.create"
  | "effectiveness.validate"
  | "anomaly.read"
  | "anomaly.create"
  | "anomaly.update"
  | "department.read"
  | "department.create"
  | "department.update"
  | "department.delete"
  | "process.read"
  | "process.create"
  | "process.update"
  | "process.delete"
  /** D2b (DECISION-074): owner / risk champion / N-1 of a process. Opens rights, so never behind process.update. */
  | "process.responsibility.assign"
  /**
   * DECISION-006 governance finding (2026-09-29 architect review, not yet
   * committed): Process.evaluationMode (Classique/Participatif) must never
   * be gated by the generic process.update — same family as SEC-013/
   * SEC-014 (a governance-relevant transition gated by a dedicated
   * permission, reserved to the Risk Manager, not the generic .update
   * grant widely held by anyone who can rename a process).
   */
  | "process.evaluationmode.set"
  /**
   * DECISION-006 (2026-09-29, PO-confirmed Option A): the process-owner
   * path of DECISION-006 — proposing a Classique/Participatif change on
   * a process (`ProcessEvaluationModeRequestService.propose`). Deliberately
   * separate from `process.evaluationmode.set` (the direct Risk-Manager
   * path, which skips the requests table entirely) — a proposal alone
   * never changes `Process.evaluationMode`.
   */
  | "process.evaluationmode.propose"
  /**
   * DECISION-006 (2026-09-29, PO-confirmed Option A): the sole source of
   * validator authority for a pending evaluation-mode request — never
   * `Risk.ownerId` (nullable, multi-valued in practice, mutable via the
   * widely-held `risk.update`, same hazard class as SEC-011/SEC-013/
   * SEC-014). A holder of this permission can still never validate their
   * own proposal (`assertNotSelfValidated` in
   * ProcessEvaluationModeRequestService) — no exception, even for a Risk
   * Manager.
   */
  | "evaluationmode.validate"
  | "audit.read"
  | "role.read"
  /**
   * q188/q189 (DECISION-098, DECISION-101): widens a role.read holder's view of the rights matrix to the Audit
   * group and the administrators. Never grantable through role create/update (assertRolePermissionRules): it waits
   * for its dedicated maker-checker circuit — until then nobody holds it (fail closed).
   */
  | "role.read.sensitive"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.assign"
  | "feedback.create"
  | "feedback.read"
  | "feedback.update"
  | "kpi.read"
  | "kpi.create"
  | "kpi.update"
  | "kpi.delete"
  | "riskappetite.read"
  | "riskappetite.update"
  | "riskappetite.delete"
  | "ratingscale.read"
  | "ratingscale.create"
  | "ratingscale.update"
  | "ratingscale.delete"
  | "user.read"
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.reactivate"
  | "riskevaluation.read"
  | "riskevaluation.create"
  | "riskevaluation.update"
  | "riskevaluation.validate"
  | "kri.read"
  | "kri.create"
  | "kri.update"
  | "kri.delete"
  /** ACT-125: distinct workflow action beyond risk.update, mirroring execution.validate/riskevaluation.validate. */
  | "risk.escalate"
  /** B-0: designating owner / N+1 is a distinct gate, not the widely-held risk.update (self-designation refused in the service). */
  | "risk.owner.assign"
  | "actionplan.read"
  | "actionplan.create"
  | "actionplan.update"
  | "actionplan.validate"
  | "cartography.read"
  /**
   * ACT-080/081/082/084/210/213/214/215/240/241: personal- and
   * department-scoped read views (Dashboard's risk-owner/department
   * views and Reporting's per-department/appetite-vs-residual/
   * compliance reports) — the broad "any authenticated business user can
   * see their own scope" tier.
   */
  | "dashboard.read"
  /**
   * ACT-211/212/242/243 (+ the tenant-wide flavors of 214/215): cross-
   * entity / whole-tenant aggregation (executive dashboard, risk
   * committee report, multi-entity consolidated report). Deliberately a
   * separate, narrower permission from dashboard.read — broader scope
   * needs its own grant, matching this codebase's existing convention
   * (e.g. *.delete never implied by *.update).
   */
  | "dashboard.executive"
  /** ACT-084: tenant logo. Read is only needed to display the current branding; update covers the upload itself. */
  | "branding.read"
  | "branding.update"
  /** ACT-220/226: methodology settings + appetite mode — "impact immédiat sur tous les calculs", kept distinct from config.read. */
  | "config.read"
  | "config.update"
  /** ACT-221/222/223/224/225: module toggles, tenant management, regulatory frameworks, risk categories, Excel import — super-admin-ish operations. */
  | "config.manage"
  /**
   * RISK_MANAGEMENT_V1 §8 (Lot A): recalibrating the Committee score
   * thresholds is distinct from toggling the pass-through obligation
   * itself — the latter is a governance-weight act (SEC-013/SEC-014
   * family: a terminal/high-stakes side effect needs its own permission,
   * never config.update) — kept as two separate permissions on purpose.
   */
  | "config.committeethreshold.set"
  | "config.committeeenforcement.set"
  /** DECISION-042 q58: allow/forbid the Committee + Audit cumul (sensitive tenant setting, application administrator). */
  | "config.cumul.set"
  | "config.governancedelays.set"
  /** DECISION-074 R-0: client's choice for noSelfValidation (REFUSE / DOUBLE_CONFIRMATION) — relaxes a control, administrator only. */
  | "config.selfvalidation.set"
  /** q158 (DECISION-078): second confirmation of a relaxed self-validation policy (Risk Manager, Committee; never Audit). */
  | "config.selfvalidation.approve"
  /** DECISION-074: governance health panel; distinct prefix from governance.* (review cycles). */
  | "governancehealth.read"
  /** DECISION-074/075 (D2c): designate / end the designated manager and the Risk Manager interim (opens Risk Manager rights; administrator only). */
  | "designation.manage"
  /** DECISION-074 R-2 (lot D3): organization profile questionnaire. approve = the second confirmation of a size reduction. */
  | "orgprofile.read"
  | "orgprofile.submit"
  | "orgprofile.approve"
  /** D5 (R-7): review / contest an action applied without a second validation (add-only; RM, Committee, Audit, never the author). */
  | "governanceexception.review"
  /** D5 (q138): accept a non-respected principle for a limited time; confirm = second confirmation; revoke = early end (terminal, own gate). */
  | "governanceprinciple.accept"
  | "governanceprinciple.acceptance.confirm"
  | "governanceprinciple.acceptance.revoke"
  | "notification.read"
  | "governance.read"
  | "governance.create"
  | "governance.validate"
  /** ACT-253: distinct from riskevaluation.validate — higher-stakes Comité des Risques / Direction gate. */
  | "riskevaluation.validate.committee"
  /** Lot 1 RACI minimal (GRC_Migration_Plan.md Lot A) — dedicated permissions, never folded into risk/control/actionplan.update. */
  | "raci.assign"
  | "raci.revoke"
  | "raci.read"
  /**
   * Lot 4 (Audit module, 2026-09-30): AuditMission. audit.mission.close
   * is deliberately its own permission, not folded into
   * audit.mission.update — same "terminal transition gets its own gate"
   * convention as execution.validate/actionplan.validate. Distinct from
   * the pre-existing `audit.read` (AuditLogService — the technical,
   * append-only audit trail, a completely different concept) and from
   * `governance.*` (review cycles) — deliberately prefixed
   * `audit.mission.*`/`audit.finding.*` rather than bare
   * `mission.*`/`finding.*` so these scope to the Audit module
   * unambiguously.
   */
  | "audit.mission.read"
  | "audit.mission.create"
  | "audit.mission.update"
  | "audit.mission.close"
  /**
   * Lot 4 (Audit module, 2026-09-30): Finding. audit.finding.close is its
   * own permission (never audit.finding.update) and is maker-checker
   * gated in FindingService — the auditor who raised a Finding can never
   * be the one who closes it.
   */
  | "audit.finding.read"
  | "audit.finding.create"
  | "audit.finding.update"
  | "audit.finding.close"
  /**
   * RISK_MANAGEMENT_V1 §8/§12 (Lot B): TreatmentDecision. Ordinary
   * maker-checker (confirm/invalidate) is covered by a single
   * treatmentdecision.validate permission — same two-outcome act as
   * riskevaluation.validate/reject. Committee pass-through gets its own
   * dedicated permission, never folded into the one above, same family
   * as riskevaluation.validate.committee.
   */
  | "treatmentdecision.read"
  | "treatmentdecision.create"
  | "treatmentdecision.validate"
  | "treatmentdecision.validate.committee"
  /**
   * B-8 bis (q45): changing the permissions of the fixed Audit group is reserved to
   * the application administrator (never granted to a role of the risk team), and
   * the change is validated by a member of Audit or of the Committee when the
   * administrator is also a Risk Manager. Two distinct permissions, never role.update.
   */
  | "rolegroup.audit.update"
  | "rolegroup.audit.validate"
  /** B-6a: the Dispositif. `activate` (decide) and `archive` (terminal) are never reachable through `update`. */
  | "riskframework.read"
  | "riskframework.create"
  | "riskframework.update"
  | "riskframework.activate"
  | "riskframework.archive"
  | "riskframework.process.assign";

/**
 * Kept in sync with the Permission union by hand (TS types don't exist
 * at runtime) — used by RoleService to reject a role definition that
 * names a permission that doesn't exist.
 */
export const ALL_PERMISSIONS: Permission[] = [
  "risk.read",
  "risk.create",
  "risk.update",
  "risk.delete",
  "evidence.read",
  "evidence.download",
  "evidence.upload",
  "evidence.delete",
  "evidence.import",
  "control.read",
  "control.create",
  "control.update",
  "control.delete",
  "execution.read",
  "execution.create",
  "execution.validate",
  "effectiveness.read",
  "effectiveness.create",
  "effectiveness.validate",
  "anomaly.read",
  "anomaly.create",
  "anomaly.update",
  "department.read",
  "department.create",
  "department.update",
  "department.delete",
  "process.read",
  "process.create",
  "process.update",
  "process.delete",
  "process.responsibility.assign",
  "process.evaluationmode.set",
  "process.evaluationmode.propose",
  "evaluationmode.validate",
  "audit.read",
  "role.read",
  "role.read.sensitive",
  "role.create",
  "role.update",
  "role.delete",
  "role.assign",
  "feedback.create",
  "feedback.read",
  "feedback.update",
  "kpi.read",
  "kpi.create",
  "kpi.update",
  "kpi.delete",
  "riskappetite.read",
  "riskappetite.update",
  "riskappetite.delete",
  "ratingscale.read",
  "ratingscale.create",
  "ratingscale.update",
  "ratingscale.delete",
  "user.read",
  "user.create",
  "user.update",
  "user.delete",
  "user.reactivate",
  "riskevaluation.read",
  "riskevaluation.create",
  "riskevaluation.update",
  "riskevaluation.validate",
  "kri.read",
  "kri.create",
  "kri.update",
  "kri.delete",
  "risk.escalate",
  "risk.owner.assign",
  "actionplan.read",
  "actionplan.create",
  "actionplan.update",
  "actionplan.validate",
  "cartography.read",
  "dashboard.read",
  "dashboard.executive",
  "branding.read",
  "branding.update",
  "config.read",
  "config.update",
  "config.manage",
  "config.committeethreshold.set",
  "config.committeeenforcement.set",
  "config.cumul.set",
  "config.governancedelays.set",
  "config.selfvalidation.set",
  "config.selfvalidation.approve",
  "governancehealth.read",
  "designation.manage",
  "orgprofile.read",
  "orgprofile.submit",
  "orgprofile.approve",
  "governanceexception.review",
  "governanceprinciple.accept",
  "governanceprinciple.acceptance.confirm",
  "governanceprinciple.acceptance.revoke",
  "notification.read",
  "governance.read",
  "governance.create",
  "governance.validate",
  "riskevaluation.validate.committee",
  "raci.assign",
  "raci.revoke",
  "raci.read",
  "audit.mission.read",
  "audit.mission.create",
  "audit.mission.update",
  "audit.mission.close",
  "audit.finding.read",
  "audit.finding.create",
  "audit.finding.update",
  "audit.finding.close",
  "treatmentdecision.read",
  "treatmentdecision.create",
  "treatmentdecision.validate",
  "treatmentdecision.validate.committee",
  "rolegroup.audit.update",
  "rolegroup.audit.validate",
  "riskframework.read",
  "riskframework.create",
  "riskframework.update",
  "riskframework.activate",
  "riskframework.archive",
  "riskframework.process.assign",
];

/**
 * Granted to every authenticated user regardless of role — there's no
 * invite/onboarding flow yet (ACT-091) that could assign it per-user,
 * and feedback capture is meant to be frictionless, not gated.
 */
export const BASE_PERMISSIONS: Permission[] = ["feedback.create", "notification.read"];

export function requirePermission(actor: AuthenticatedUser, permission: Permission): void {
  if (!actor.roles.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

/**
 * SEC-005: `users.roles` is a free-form legacy/bootstrap grant list
 * (seeded or hand-edited via SQL, never validated) that server.ts unions
 * with RBAC-role permissions to compute an actor's effective grants. A
 * typo or stale/renamed string could otherwise sit there silently
 * forever. Filters candidates down to real, current permissions before
 * they're trusted — call this on `users.roles`, never on RBAC-derived
 * permissions (those already came from RoleService.assertKnownPermissions).
 */
export function filterKnownPermissions(candidates: readonly string[]): Permission[] {
  return candidates.filter((c): c is Permission => (ALL_PERMISSIONS as readonly string[]).includes(c));
}
