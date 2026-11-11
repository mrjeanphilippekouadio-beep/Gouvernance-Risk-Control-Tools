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

/** Exact comparison of an AUTHENTICATED e-mail (verified by the identity provider) to the list; no wildcard, case-insensitive. */
export function isSuperAdminEmail(authenticatedEmail: string, superAdmins: readonly string[]): boolean {
  const email = authenticatedEmail.trim().toLowerCase();
  return email.length > 0 && superAdmins.includes(email);
}
