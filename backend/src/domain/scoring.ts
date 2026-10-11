import type { ScoreThreshold } from "./entities/RatingScale.js";

/** Matrix size used when no active rating scale is known (the historical 5x5 methodology). */
export const DEFAULT_MATRIX_SIZE = 5;
/** Largest matrix a rating scale can have (B-9); the absolute score ceiling is therefore 36. */
export const MAX_MATRIX_SIZE = 6;
export const ABSOLUTE_MAX_SCORE = MAX_MATRIX_SIZE * MAX_MATRIX_SIZE;

/** B-9 bis (q49): score ceiling of an n x n matrix. The ONLY place this rule lives. */
export function maxScoreForSize(n: number): number {
  return n * n;
}

/** Real score ceiling of a scale: probabilityLevels x impactLevels (n² when equal). */
export function maxScoreForScale(s: { probabilityLevels: number; impactLevels: number }): number {
  return s.probabilityLevels * s.impactLevels;
}

/**
 * B-9 bis (q49): default criticality bands for an n x n matrix — the historical
 * 1-4 / 5-9 / 10-15 / 16-25 split scaled to n² (integer arithmetic, so n=5 gives
 * exactly the historical bands). The ONLY place the default bands live.
 */
export function defaultCriticalityBands(n: number): ScoreThreshold[] {
  return defaultBandsForMaxScore(maxScoreForSize(n));
}

/** Same bands from a score ceiling (also covers unequal legacy P x I sizes). */
export function defaultBandsForMaxScore(max: number): ScoreThreshold[] {
  const faible = Math.floor((max * 4) / 25);
  const modere = Math.floor((max * 9) / 25);
  const eleve = Math.floor((max * 15) / 25);
  return [
    { label: "Faible", min: 1, max: faible },
    { label: "Modéré", min: faible + 1, max: modere },
    { label: "Élevé", min: modere + 1, max: eleve },
    { label: "Critique", min: eleve + 1, max },
  ];
}

/**
 * Default Comité threshold = upper bound of the 3rd ("Élevé") default band, so it follows the
 * matrix size with the same rule as the bands (15 for 5x5). A default only: never replaces a configured value.
 */
export function defaultCommitteeThreshold(maxScore: number): number {
  return defaultBandsForMaxScore(maxScore)[2]!.max;
}
