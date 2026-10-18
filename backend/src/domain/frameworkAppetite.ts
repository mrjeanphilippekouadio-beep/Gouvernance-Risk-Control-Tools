import type { AppetiteThresholdEntry } from "./entities/RiskFramework.js";

const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Appetite of a version for (sub-category, entity); entity equal after COALESCE(entity, '') on both sides.
 * q145: when the evaluation carries a `subCategoryId`, the entry is matched on that id (an entry saved before q133
 * without id still matches on its label). An evaluation without id (free label from before q145) keeps the label match.
 * Entries of a version are the active thresholds, so there is no "active" filter here.
 */
export function findAppetite(
  list: readonly AppetiteThresholdEntry[],
  subCategory: string,
  entity: string | null,
  subCategoryId?: string | null,
): AppetiteThresholdEntry | null {
  return (
    list.find((a) => {
      if ((a.entity ?? "") !== (entity ?? "")) return false;
      if (subCategoryId && a.subCategoryId) return sameId(a.subCategoryId, subCategoryId);
      return a.subCategory === subCategory;
    }) ?? null
  );
}
