import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser, IdentityProvider } from "./IdentityProvider.js";
import { ForbiddenError } from "../../domain/errors/DomainErrors.js";

export interface LocalAuthMembershipLookup {
  (email: string): Promise<AuthenticatedUser | null>;
}

interface LocalTokenPayload {
  sub: string;
  email: string;
  exp: number;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function hashLocalPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

/**
 * Staging-only local identity provider for deterministic browser/E2E tests.
 *
 * It deliberately keeps the same server-side membership resolution model as
 * Google SSO: the local credential authenticates an email, then the database
 * resolves tenant/roles/permissions. It never accepts roles or tenant ids
 * from the browser.
 */
export class LocalIdentityProvider implements IdentityProvider {
  constructor(
    private readonly configuredEmail: string,
    private readonly passwordHash: string,
    private readonly tokenSecret: string,
    private readonly tokenTtlSeconds: number,
    private readonly lookupMembership: LocalAuthMembershipLookup,
  ) {}

  async authenticate(email: string, password: string): Promise<string> {
    if (email.trim().toLowerCase() !== this.configuredEmail.toLowerCase()) {
      throw new ForbiddenError("Invalid local credentials");
    }
    if (!verifyPassword(password, this.passwordHash)) {
      throw new ForbiddenError("Invalid local credentials");
    }

    const membership = await this.lookupMembership(this.configuredEmail);
    if (!membership) {
      throw new ForbiddenError(`No tenant membership found for ${this.configuredEmail}`);
    }

    return this.issueToken(membership);
  }

  async verifyToken(bearerToken: string): Promise<AuthenticatedUser> {
    const [encodedPayload, providedSignature] = bearerToken.split(".");
    if (!encodedPayload || !providedSignature) {
      throw new ForbiddenError("Invalid local token");
    }

    const expectedSignature = sign(encodedPayload, this.tokenSecret);
    const actual = Buffer.from(providedSignature);
    const expected = Buffer.from(expectedSignature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ForbiddenError("Invalid local token signature");
    }

    let payload: LocalTokenPayload;
    try {
      payload = JSON.parse(decode(encodedPayload)) as LocalTokenPayload;
    } catch {
      throw new ForbiddenError("Invalid local token payload");
    }

    if (!payload.sub || !payload.email || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new ForbiddenError("Expired local token");
    }

    const membership = await this.lookupMembership(payload.email);
    if (!membership || membership.userId !== payload.sub) {
      throw new ForbiddenError("Local user is no longer authorized");
    }

    return membership;
  }

  private issueToken(user: AuthenticatedUser): string {
    const payload: LocalTokenPayload = {
      sub: user.userId,
      email: user.email,
      exp: Math.floor(Date.now() / 1000) + this.tokenTtlSeconds,
    };
    const encodedPayload = encode(JSON.stringify(payload));
    return `${encodedPayload}.${sign(encodedPayload, this.tokenSecret)}`;
  }
}
