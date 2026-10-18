import type { Role, SystemGroup } from "./entities/Role.js";
import type { Permission } from "./permissions.js";

/**
 * B-8 ter (B8bis-02): single source of truth for the rights of the 3 fixed
 * groups (DECISION-040 q42). Migration 051 seeds the same lists for tenants
 * that existed when it ran (a test keeps the two in sync);
 * PostgresTenantRepository.create uses this constant for tenants created later.
 */
export const FIXED_GROUP_PERMISSIONS: Record<SystemGroup, Permission[]> = {
  RISK_MANAGER: [
    "risk.read", "risk.create", "risk.update", "risk.delete", "risk.escalate", "risk.owner.assign",
    "riskevaluation.read", "riskevaluation.create", "riskevaluation.update", "riskevaluation.validate", "kri.read",
    "kri.create", "kri.update", "kri.delete", "actionplan.read", "actionplan.create", "actionplan.update",
    "actionplan.validate", "control.read", "control.create", "control.update", "control.delete", "execution.read",
    "execution.create", "execution.validate", "effectiveness.read", "effectiveness.create", "effectiveness.validate",
    "anomaly.read", "anomaly.create", "anomaly.update", "treatmentdecision.read", "treatmentdecision.create",
    "treatmentdecision.validate", "evidence.read", "evidence.download", "evidence.upload", "raci.read",
    "raci.assign", "raci.revoke", "kpi.read", "kpi.create", "kpi.update", "riskappetite.read", "ratingscale.read",
    "process.read", "department.read", "cartography.read", "dashboard.read", "dashboard.executive",
    "governance.read", "governance.create", "notification.read",
    "riskframework.read", "riskframework.create", "riskframework.update", "riskframework.activate", "riskframework.archive",
    "riskframework.process.assign",
    "governancehealth.read",
  ],
  RISK_COMMITTEE: [
    "risk.read", "riskevaluation.read", "kri.read", "actionplan.read", "control.read", "execution.read",
    "effectiveness.read", "anomaly.read", "treatmentdecision.read", "evidence.read", "evidence.download",
    "raci.read", "kpi.read", "riskappetite.read", "ratingscale.read", "process.read", "department.read",
    "cartography.read", "dashboard.read", "dashboard.executive", "governance.read", "notification.read",
    "riskevaluation.validate.committee", "treatmentdecision.validate.committee", "governance.validate",
    "rolegroup.audit.validate", "riskframework.read", "governancehealth.read",
  ],
  AUDIT: [
    "risk.read", "riskevaluation.read", "kri.read", "actionplan.read", "control.read", "execution.read",
    "effectiveness.read", "anomaly.read", "treatmentdecision.read", "evidence.read", "evidence.download",
    "raci.read", "kpi.read", "riskappetite.read", "ratingscale.read", "process.read", "department.read",
    "cartography.read", "dashboard.read", "dashboard.executive", "governance.read", "notification.read",
    "audit.read", "audit.mission.read", "audit.finding.read", "rolegroup.audit.validate", "riskframework.read",
    "governancehealth.read",
  ],
};

/**
 * F-B8b-01 (q42: Audit is read-only): the only permissions the Audit group may
 * carry — reads, downloads, the executive dashboard and the right to validate
 * a change of the Audit rights.
 */
export function isAuditGroupPermission(p: Permission): boolean {
  return p.endsWith(".read") || p.endsWith(".download") || p === "dashboard.executive" || p === "rolegroup.audit.validate";
}

/** F-B8b-01: rolegroup.audit.update is held by no role at all; .validate only by Audit and the Committee. */
export function rolegroupAuditPermissionAllowedOn(p: Permission, group: SystemGroup | null): boolean {
  if (p === "rolegroup.audit.validate") return group === "AUDIT" || group === "RISK_COMMITTEE";
  return !p.startsWith("rolegroup.audit.");
}

/** F-B8b-05: permissions that make a holder an auditor in effect (reads of the audit trail included). */
export function isAuditPermission(p: Permission): boolean {
  return p.startsWith("audit.");
}

/**
 * DECISION-042 q63: "application administrator" = holds, through any active role, at least one of
 * these management permissions (role/user reads do not count). rolegroup.audit.update is the
 * administrator-only right on the Audit group's permissions.
 */
export const ADMIN_PERMISSIONS: Permission[] = [
  "role.create", "role.update", "role.delete", "role.assign",
  "user.create", "user.update", "user.delete", "user.reactivate",
  "rolegroup.audit.update", "config.cumul.set", "config.committeeenforcement.set",
  // q79 (DECISION-044): client management (module toggles, tenants, regulatory frameworks, risk categories,
  // Excel import) counts. Methodology (config.update) does not.
  "config.manage",
  // DECISION-074 R-0 / §1.3: relaxing the no-self-validation control is an administrator act (same nature as config.cumul.set).
  // governancehealth.read is deliberately NOT here: reading the panel must not make someone an "administrator" (q63 cumul rules).
  "config.selfvalidation.set",
  // DECISION-075 (D2c): designating an interim opens Risk Manager rights; never held by a fixed group.
  "designation.manage",
];

export const isAdministrator = (roles: Role[]): boolean => roles.some((r) => r.permissions.some((p) => ADMIN_PERMISSIONS.includes(p)));
/** F-D044-01: holding one of these counts as Committee membership for the q94 rule (RM + Committee). */
const COMMITTEE_VALIDATION_PERMISSIONS: Permission[] = [
  "riskevaluation.validate.committee", "treatmentdecision.validate.committee", "governance.validate",
];
export const isCommitteeValidationPermission = (p: Permission): boolean => COMMITTEE_VALIDATION_PERMISSIONS.includes(p);
export const isRiskManagerMember = (roles: Role[]): boolean => roles.some((r) => r.systemGroup === "RISK_MANAGER");
/** Committee membership = the group or its validation powers (F-D044-01), for q94 as for q80/G1. */
export const isCommitteeRole = (r: Role): boolean => r.systemGroup === "RISK_COMMITTEE" || r.permissions.some(isCommitteeValidationPermission);
export const isCommitteeMember = (roles: Role[]): boolean => roles.some(isCommitteeRole);
/** q104 (DECISION-046): Audit membership = the system group only (extension to audit.* permissions is F-D044-08, with A13). */
export const isAuditGroupMember = (roles: Role[]): boolean => roles.some((r) => r.systemGroup === "AUDIT");
