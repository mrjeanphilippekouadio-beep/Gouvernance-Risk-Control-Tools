import { z } from "zod";

/**
 * q260 (DECISION-125): platform super-administrators = a fixed list of e-mail addresses in a server environment variable
 * (SUPER_ADMIN_EMAILS). Fail closed: empty/absent = nobody. Each entry must be an exact e-mail (no wildcard, no pattern),
 * normalized to lowercase, deduplicated, at most 20. An invalid entry stops the server at start, never silently dropped.
 * Pure module (no env read) so it can be unit-tested.
 */
export const MAX_SUPER_ADMINS = 20;

export function parseSuperAdminEmails(raw: string, ctx: z.RefinementCtx): string[] {
  const emails: string[] = [];
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!email) continue;
    if (!z.email().safeParse(email).success || /[*?%\s]/.test(email)) {
      ctx.addIssue({ code: "custom", message: "SUPER_ADMIN_EMAILS must be a comma-separated list of exact e-mail addresses (no wildcard)" });
      return z.NEVER;
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > MAX_SUPER_ADMINS) {
    ctx.addIssue({ code: "custom", message: `SUPER_ADMIN_EMAILS: at most ${MAX_SUPER_ADMINS} addresses` });
    return z.NEVER;
  }
  return emails;
}

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** q275 (DECISION-132): exact domain names (no wildcard), lowercase, deduplicated, at most 20; an invalid entry stops the server at start. */
export function parseSuperAdminDomains(raw: string, ctx: z.RefinementCtx): string[] {
  const domains: string[] = [];
  for (const part of raw.split(",")) {
    const domain = part.trim().toLowerCase();
    if (!domain) continue;
    if (!DOMAIN_RE.test(domain)) {
      ctx.addIssue({ code: "custom", message: "SUPER_ADMIN_DOMAINS must be a comma-separated list of exact domain names (no wildcard)" });
      return z.NEVER;
    }
    if (!domains.includes(domain)) domains.push(domain);
  }
  if (domains.length > MAX_SUPER_ADMINS) {
    ctx.addIssue({ code: "custom", message: `SUPER_ADMIN_DOMAINS: at most ${MAX_SUPER_ADMINS} domains` });
    return z.NEVER;
  }
  return domains;
}

export function emailDomain(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at < 0 ? "" : e.slice(at + 1);
}

/**
 * q275: platform super-administrator = authenticated e-mail in the list AND a domain ATTESTED by the identity provider
 * (`attestedDomain`, null = nothing attested = refused) that is the e-mail's own domain AND is in SUPER_ADMIN_DOMAINS.
 * The only place that decides it; provider-specific proof (Google `hd`, ...) stays in the identity adapters.
 */
export function isSuperAdminIdentity(
  authenticatedEmail: string,
  attestedDomain: string | null | undefined,
  superAdminEmails: readonly string[],
  superAdminDomains: readonly string[],
): boolean {
  if (!attestedDomain || !isSuperAdminEmail(authenticatedEmail, superAdminEmails)) return false;
  const attested = attestedDomain.trim().toLowerCase();
  return attested === emailDomain(authenticatedEmail) && superAdminDomains.includes(attested);
}

/** Exact comparison of an AUTHENTICATED e-mail (verified by the identity provider) to the list; no wildcard, case-insensitive. */
export function isSuperAdminEmail(authenticatedEmail: string, superAdmins: readonly string[]): boolean {
  const email = authenticatedEmail.trim().toLowerCase();
  return email.length > 0 && superAdmins.includes(email);
}
