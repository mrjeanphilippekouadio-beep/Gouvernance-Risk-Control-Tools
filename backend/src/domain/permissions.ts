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
  | "evidence.upload"
  | "evidence.delete"
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
  | "audit.read"
  | "role.read"
  | "role.create"
  | "role.update"
  | "role.delete"
  | "role.assign"
  | "feedback.create"
  | "feedback.read"
  | "feedback.update";

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
  "evidence.upload",
  "evidence.delete",
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
  "audit.read",
  "role.read",
  "role.create",
  "role.update",
  "role.delete",
  "role.assign",
  "feedback.create",
  "feedback.read",
  "feedback.update",
];

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
