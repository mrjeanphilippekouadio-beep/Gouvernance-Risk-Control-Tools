import { z } from "zod";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";

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

/** SEC-PNL-01 / F-PNL-11: a governance reason: trimmed, 1..max, no control character, at least one visible character. */
export function reasonText(max = 500) {
  return z.string().trim().min(1).max(max).refine(isAcceptableReason, "Motif invalide : caractères de contrôle ou aucun caractère visible");
}

/** DECISION-074: the explicit second confirmation of a self-validation (`governanceConfirmation` in the request body). */
export const GovernanceConfirmationBody = z.object({
  rule: z.literal("noSelfValidation"),
  reason: reasonText(),
});

/** Shared by the scale's `defenseLines` and the mastery assessment's `lines` (one entry per defense line). */
export const MAX_DEFENSE_LINES = 50;
/** B-9: impact scale size ceiling (6 levels) and impact axes ceiling (7 axes) — mirrored in RatingScaleService. */
export const MAX_SCALE_SIZE = 6;
export const MAX_IMPACT_AXES = 7;
