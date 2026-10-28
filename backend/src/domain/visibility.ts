import type { SystemGroup } from "./entities/Role.js";

/**
 * DECISION-100/102/103 (spec docs/architecture/RM-V1-Visibilite-Ressources-spec.md): who may READ a root resource
 * (risk, control, anomaly, action plan, KPI). CLIENT = the whole client (behaviour before 080, and the default of every
 * row); PERIMETRE = restricted to its perimeter; NOMINATIF = named people.
 */
export type Visibility = "CLIENT" | "PERIMETRE" | "NOMINATIF";
export const VISIBILITIES: readonly Visibility[] = ["CLIENT", "PERIMETRE", "NOMINATIF"];

/** The fixed groups that always see everything, at every level (spec §4, q191). */
export const SEES_EVERYTHING: readonly SystemGroup[] = ["RISK_MANAGER", "RISK_COMMITTEE", "AUDIT"];

/**
 * What a reader may see, resolved once per request (`VisibilityResolver`). Lot V0: `{ all: true }` for the groups above,
 * otherwise `{ all: false }` = CLIENT rows only. Lot V1 widens `{ all: false }` with the reader's perimeter and grants.
 */
export type ReadScope = { all: true } | { all: false };

export const isVisible = (visibility: Visibility, scope: ReadScope | undefined): boolean =>
  !scope || scope.all || visibility === "CLIENT";
