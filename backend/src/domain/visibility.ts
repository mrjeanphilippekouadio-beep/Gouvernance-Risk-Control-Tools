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

/**
 * SEC V0-01 (fail-closed): the scope is mandatory on every root read. A server-internal read that legitimately needs
 * every row (validation of a link, a recomputation, a dashboard already gated by its own permission) says so explicitly
 * with this marker — never by omitting the scope. A reader-facing read uses `VisibilityResolver`; without a resolver
 * the reader gets `READER_DEFAULT_SCOPE` (CLIENT rows only), never everything.
 */
export const SYSTEM_SCOPE: ReadScope = Object.freeze({ all: true });
export const READER_DEFAULT_SCOPE: ReadScope = Object.freeze({ all: false });

export const isVisible = (visibility: Visibility, scope: ReadScope): boolean => scope.all || visibility === "CLIENT";
