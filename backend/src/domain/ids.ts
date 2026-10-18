/**
 * Canonical form of a client-supplied id before any comparison with an id read from the database
 * (`actor.userId` included). Postgres `uuid` accepts upper case and resolves the same row, so a
 * text comparison on the raw input lets "MY-ID" pass a "not yourself" guard (QA-B6d-01 class).
 */
export const canonicalId = (id: string): string => id.trim().toLowerCase();
