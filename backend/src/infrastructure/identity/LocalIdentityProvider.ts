import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AuthenticatedUser, IdentityProvider } from "./IdentityProvider.js";
import { ForbiddenError } from "../../domain/errors/DomainErrors.js";

export interface LocalAuthUser {
  email: string;
  passwordHash: string;
}

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
  if (!/^[0-9a-f]+$/i.test(expectedHex)) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
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
  private readonly usersByEmail: Map<string, LocalAuthUser>;

  constructor(
    users: LocalAuthUser[],
    private readonly tokenSecret: string,
    private readonly tokenTtlSeconds: number,
    private readonly lookupMembership: LocalAuthMembershipLookup,
  ) {
    this.usersByEmail = new Map();

    for (const user of users) {
      const email = user.email.trim().toLowerCase();
      if (!email || !user.passwordHash) throw new Error("Invalid local-auth user configuration");
      if (this.usersByEmail.has(email)) throw new Error(`Duplicate local-auth email configured: ${email}`);
      this.usersByEmail.set(email, { email, passwordHash: user.passwordHash });
    }

    if (this.usersByEmail.size === 0) throw new Error("At least one local-auth user must be configured");
  }

  async authenticate(email: string, password: string): Promise<string> {
    const normalizedEmail = email.trim().toLowerCase();
    const configuredUser = this.usersByEmail.get(normalizedEmail);

    if (!configuredUser || !verifyPassword(password, configuredUser.passwordHash)) {
      throw new ForbiddenError("Invalid local credentials");
    }

    const membership = await this.lookupMembership(configuredUser.email);
    if (!membership) {
      throw new ForbiddenError(`No tenant membership found for ${configuredUser.email}`);
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
