/**
 * Canonical form of a client-supplied id before any comparison with an id read from the database
 * (`actor.userId` included). Postgres `uuid` resolves the same row for upper case, no hyphens, braces
 * or misplaced hyphens, so a text comparison on the raw input lets "MY-ID" pass a "not yourself"
 * guard (QA-B6d-01, SEC-ID-01).
 */
export function canonicalId(id: string): string {
  const s = id.trim().toLowerCase();
  const hex = uuidHex(s);
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : s;
}

/** The 32 hex digits if Postgres would read `s` as a uuid, else null. */
export function uuidHex(s: string): string | null {
  const hex = s.replace(/^\{(.*)\}$/, "$1").replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex) ? hex.toLowerCase() : null;
}
