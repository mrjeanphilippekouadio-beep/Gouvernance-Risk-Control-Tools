export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  roles: string[];
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
