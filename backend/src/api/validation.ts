import { z } from "zod";

/**
 * Array schema for HTTP input, with the length checked BEFORE the elements
 * are parsed. zod 4.6.5 (CVE-2023-54404, no fixed release) parses every
 * element and accumulates issues first, so a bare `z.array(El).max(N)` still
 * burns ~2 s CPU / ~540 MB on a 1 MB body of `{}`. Never use a bare
 * `z.array` on request data — use this. See docs/security/snyk-dependencies.md.
 */
export function boundedArray<T extends z.ZodType>(element: T, max: number, min = 0) {
  return z.array(z.unknown()).min(min).max(max).pipe(z.array(element));
}

/** Shared by the scale's `defenseLines` and the mastery assessment's `lines` (one entry per defense line). */
export const MAX_DEFENSE_LINES = 50;
