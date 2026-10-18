import type { GovernanceExceptionLookup } from "../domain/governance/selfValidation.js";

/**
 * q142: adds `validationIndependence` ("INDEPENDENT" | "WITHOUT_INDEPENDENT_REVIEW" | "REVIEWED_BY_THIRD_PARTY") to
 * a response object or list, computed from the audit marker by the single GovernanceExceptionLookup. The object's own
 * status is untouched, so every calculation keeps treating the act as validated (q153). An object not validated yet
 * reads "INDEPENDENT" (nothing was bypassed). Without a lookup (tests) the data is returned as is.
 */
export function withIndependence(lookup: GovernanceExceptionLookup | undefined, entityType: string) {
  return async function <T>(tenantId: string, data: T): Promise<T> {
    if (!lookup || data === null || typeof data !== "object") return data;
    const items = (Array.isArray(data) ? data : [data]) as Array<{ id?: unknown }>;
    const ids = items.map((i) => i.id).filter((id): id is string => typeof id === "string");
    const found = await lookup.forEntities(tenantId, entityType, ids);
    const decorate = (i: { id?: unknown }) => ({
      ...i,
      validationIndependence: (typeof i.id === "string" && found.get(i.id)) || "INDEPENDENT",
    });
    return (Array.isArray(data) ? items.map(decorate) : decorate(items[0]!)) as T;
  };
}
