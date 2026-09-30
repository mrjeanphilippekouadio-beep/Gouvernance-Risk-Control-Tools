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
