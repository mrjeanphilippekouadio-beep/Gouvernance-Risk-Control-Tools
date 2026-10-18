import { OAuth2Client } from "google-auth-library";
import type { AuthenticatedUser, IdentityProvider } from "./IdentityProvider.js";
import type { DashboardScopeMode } from "../../domain/entities/DashboardScope.js";
import { ForbiddenError } from "../../domain/errors/DomainErrors.js";

export interface TenantMembershipLookup {
  (email: string): Promise<
    { userId: string; tenantId: string; roles: string[]; dashboardScopeMode: DashboardScopeMode } | null
  >;
}

/**
 * Verifies the Google ID token (Identity Platform / Workspace SSO) to
 * confirm *who* the caller is. Tenant membership and roles are our own
 * business data, not Google's — resolved via `lookupMembership` against
 * our repository, never trusted from the token itself.
 */
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly client: OAuth2Client;
  // Dernier `iat` vu par utilisateur : un nouveau jeton (nouvelle connexion Google) a un nouvel `iat`.
  private readonly lastIat = new Map<string, number>();

  constructor(
    private readonly googleClientId: string,
    private readonly lookupMembership: TenantMembershipLookup,
    /** q155 : appelé uniquement à la première vérification d'un nouveau jeton, pas à chaque requête. */
    private readonly onIdentified?: (tenantId: string, userId: string) => void,
  ) {
    this.client = new OAuth2Client(googleClientId);
  }

  async verifyToken(bearerToken: string): Promise<AuthenticatedUser> {
    const ticket = await this.client.verifyIdToken({
      idToken: bearerToken,
      audience: this.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) {
      throw new ForbiddenError("Google identity token missing a verified email");
    }

    const membership = await this.lookupMembership(payload.email);
    if (!membership) {
      throw new ForbiddenError(`No tenant membership found for ${payload.email}`);
    }

    if (this.onIdentified && this.lastIat.get(membership.userId) !== payload.iat) {
      this.lastIat.set(membership.userId, payload.iat);
      try {
        this.onIdentified(membership.tenantId, membership.userId);
      } catch {
        // jamais bloquant
      }
    }

    return {
      userId: membership.userId,
      tenantId: membership.tenantId,
      email: payload.email,
      displayName: payload.name ?? payload.email,
      roles: membership.roles,
      dashboardScopeMode: membership.dashboardScopeMode,
    };
  }
}
