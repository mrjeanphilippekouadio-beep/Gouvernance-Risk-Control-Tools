import type { AppetiteThresholdEntry } from "./entities/RiskFramework.js";

/**
 * Appetite of a version for (subCategory, entity). Same matching rule as
 * PostgresRiskAppetiteRepository.getBySubCategory: exact subCategory, and entity equal after
 * COALESCE(entity, '') on both sides (null and "" are the same key). Entries of a version are
 * the active thresholds, so there is no "active" filter here.
 */
export function findAppetite(
  list: readonly AppetiteThresholdEntry[],
  subCategory: string,
  entity: string | null,
): AppetiteThresholdEntry | null {
  return list.find((a) => a.subCategory === subCategory && (a.entity ?? "") === (entity ?? "")) ?? null;
}
