import { OAuth2Client } from "google-auth-library";
import type { AuthenticatedUser, IdentityProvider } from "./IdentityProvider.js";
import { ForbiddenError } from "../../domain/errors/DomainErrors.js";

export interface TenantMembershipLookup {
  (email: string): Promise<{ userId: string; tenantId: string; roles: string[] } | null>;
}

/**
 * Verifies the Google ID token (Identity Platform / Workspace SSO) to
 * confirm *who* the caller is. Tenant membership and roles are our own
 * business data, not Google's — resolved via `lookupMembership` against
 * our repository, never trusted from the token itself.
 */
export class GoogleIdentityProvider implements IdentityProvider {
  private readonly client: OAuth2Client;

  constructor(
    private readonly googleClientId: string,
    private readonly lookupMembership: TenantMembershipLookup,
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

    return {
      userId: membership.userId,
      tenantId: membership.tenantId,
      email: payload.email,
      displayName: payload.name ?? payload.email,
      roles: membership.roles,
    };
  }
}
