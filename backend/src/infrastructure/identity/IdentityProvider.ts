import type { DashboardScopeMode } from "../../domain/entities/DashboardScope.js";

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: string[];
  /**
   * @architect design 2026-09-30 (dashboard.executive scope): the widest
   * dashboardScopeMode across every Role currently assigned to this user
   * (widestScopeMode — GLOBAL > DEPARTMENT > PROCESS). Resolved once at
   * identity time (server.ts), not re-derived per request. A legacy
   * bootstrap admin (granted only via `users.roles`, no real Role row)
   * always resolves to GLOBAL — see server.ts.
   */
  dashboardScopeMode: DashboardScopeMode;
  /**
   * q260: platform super-administrator, resolved at identity time from the server-side SUPER_ADMIN_EMAILS list against the
   * AUTHENTICATED e-mail. Not a permission: no role, no `users.roles` string and no request field can set it.
   */
  isSuperAdmin?: boolean;
  /**
   * q275: the domain the identity provider ATTESTS for this account (Google: the `hd` claim), null when it attests nothing.
   * Each identity adapter fills it from its own proof; the rest of the code reads only this field, never a provider claim.
   */
  attestedDomain?: string | null;
}

/** What an adapter proved about the caller, handed to the membership lookup (q275 domain, q282 stable subject). */
export interface IdentityProof {
  attestedDomain: string | null;
  /** The provider's stable account id (Google `sub`); absent for local accounts (no external provider). */
  subject?: { provider: string; id: string };
}

/**
 * Verifies an inbound bearer token and resolves it to a user + tenant.
 * V1 implementation wraps Google Identity Platform / Workspace SSO; a
 * future Entra ID / OIDC provider is a new class implementing this same
 * interface (ADR-001). Nothing in services/api should import a specific
 * provider's SDK directly.
 */
export interface IdentityProvider {
  verifyToken(bearerToken: string): Promise<AuthenticatedUser>;
}
