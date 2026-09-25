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
  | "risk.delete";

export function requirePermission(actor: AuthenticatedUser, permission: Permission): void {
  if (!actor.roles.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}
