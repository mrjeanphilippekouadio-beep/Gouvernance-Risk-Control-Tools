/**
 * Technical accounts created by migrations to sign their audit rows (e.g. 077, q186). Created suspended, with a
 * reserved `.invalid` address nobody can sign in with; SEC-077-01: they are never reactivated or renamed (a role needs
 * an active account, so none can be given either).
 */
export const SYSTEM_ACCOUNT_DOMAIN = "@system.invalid";

export function isSystemAccount(user: { email: string }): boolean {
  return typeof user.email === "string" && user.email.toLowerCase().endsWith(SYSTEM_ACCOUNT_DOMAIN);
}
