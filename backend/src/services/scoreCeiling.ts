import type { RatingScaleRepository } from "../domain/repositories/RatingScaleRepository.js";
import { DEFAULT_MATRIX_SIZE, maxScoreForScale, maxScoreForSize } from "../domain/scoring.js";

/**
 * B-9 bis (q49): score ceiling (probabilityLevels x impactLevels, n² when equal) of the tenant's
 * ACTIVE rating scale. Falls back to the historical 5x5 ceiling (25) when no repository is wired
 * or no scale is active yet.
 */
export async function resolveMaxScore(
  ratingScales: Pick<RatingScaleRepository, "list"> | undefined,
  tenantId: string,
): Promise<number> {
  if (!ratingScales) return maxScoreForSize(DEFAULT_MATRIX_SIZE);
  const active = (await ratingScales.list(tenantId)).find((s) => s.status === "ACTIVE");
  return active ? maxScoreForScale(active) : maxScoreForSize(DEFAULT_MATRIX_SIZE);
}
