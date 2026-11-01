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
 * What a reader may see, resolved once per request (`VisibilityResolver`): `{ all: true }` for the groups above;
 * otherwise CLIENT rows, plus — lot V1, risks and what inherits from them — the restricted risks whose perimeter or list
 * includes `userId` (SQL `risk_visible_to`, migration 082). Without `userId` (READER_DEFAULT_SCOPE): CLIENT rows only.
 */
export type ReadScope = { all: true } | { all: false; userId?: string };

/**
 * SEC V0-01 (fail-closed): the scope is mandatory on every root read. A server-internal read that legitimately needs
 * every row (validation of a link, a recomputation, a dashboard already gated by its own permission) says so explicitly
 * with this marker — never by omitting the scope. A reader-facing read uses `VisibilityResolver`; without a resolver
 * the reader gets `READER_DEFAULT_SCOPE` (CLIENT rows only), never everything.
 */
export const SYSTEM_SCOPE: ReadScope = Object.freeze({ all: true });
export const READER_DEFAULT_SCOPE: ReadScope = Object.freeze({ all: false });

/**
 * Lot V1: the scope of a read made on behalf of `actor` without the resolver at hand. The SQL (`risk_visible_to`) also
 * admits the fixed groups that see everything, so the result is the same as the resolver's — only one query cheaper
 * to build. Never use it for a server-internal read that must see every row (that is SYSTEM_SCOPE).
 */
export const readerScope = (actor: { userId: string }): ReadScope => ({ all: false, userId: actor.userId });

export const isVisible =(visibility: Visibility, scope: ReadScope): boolean => scope.all || visibility === "CLIENT";
