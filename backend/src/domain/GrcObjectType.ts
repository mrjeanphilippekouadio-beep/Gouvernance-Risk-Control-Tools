/**
 * Canonical polymorphic GRC object type — DECISION-003/DECISION-004
 * (see .claude/agent-context/SHARED_LOG.md, @architect, 2026-09-29),
 * confirmed and finalized here after the 15-agent sweep found 7
 * divergent whitelists (not the 5-6 originally estimated), 2 of them
 * with different casing on the same field-in-spirit:
 *
 *   - ActionPlanSourceType / ActionLinkResourceType
 *     (backend/src/domain/entities/ActionPlan.ts) — SNAKE_CASE:
 *     "RISK" | "CONTROL" | "KRI" | "AUDIT" | "INCIDENT" | "MANAGEMENT"
 *     | "ANOMALY"
 *   - RaciEntityType (backend/src/domain/entities/RaciAssignment.ts)
 *     — PascalCase: "Risk" | "Control" | "ActionPlan"
 *   - NotificationResourceType (backend/src/domain/entities/Notification.ts,
 *     consumed by notifications.routes.ts and
 *     notificationSubscriptions.routes.ts) — SNAKE_CASE:
 *     "RISK" | "KRI" | "ACTION_PLAN" | "CONTROL" | "ANOMALY"
 *     | "RISK_EVALUATION" | "REVIEW_CYCLE"
 *
 * CASING DECISION: SNAKE_CASE upper, e.g. "ACTION_PLAN".
 * Rationale: 2 of the 3 whitelists checked here (ActionPlan's pair,
 * Notification's) are already SNAKE_CASE, and the wider 7-whitelist
 * sweep skews the same way — PascalCase (RaciEntityType) is the
 * outlier, not the norm. SNAKE_CASE upper also matches this codebase's
 * stored-status convention elsewhere (ActionPlanStatus:
 * "PLANIFIEE" | "EN_COURS" | "TERMINEE", DB CHECK constraints written
 * as upper-snake string literals). Migrating the one PascalCase
 * whitelist (RaciEntityType, 3 values, Lot 1 scope, no DB CHECK yet
 * shipped beyond that lot) is cheaper and lower-risk than migrating
 * two SNAKE_CASE whitelists plus every DB CHECK constraint that
 * mirrors them. This confirms (does not revise) DECISION-003/004's
 * prior lean toward SNAKE_CASE.
 *
 * SCOPE DECISION: NotificationResourceType's extra values
 * (RISK_EVALUATION, REVIEW_CYCLE) ARE folded into this canonical type
 * rather than left as a separate list. Reasoning: those two values
 * name real GRC domain objects (a risk evaluation event, a review
 * cycle) that the codebase already tracks elsewhere — they are missing
 * from ActionPlan's and RACI's whitelists only because those two
 * features don't yet originate from or attach to those object kinds,
 * not because the object kinds are conceptually foreign to the domain.
 * A single closed union that is the *union of all currently-known GRC
 * object kinds* is more useful than a narrower "canonical" type that a
 * 4th consumer would immediately have to special-case or extend again.
 * Keeping Notification's whitelist separate would just recreate the
 * fragmentation this type exists to end. Each consumer (ActionPlan,
 * RACI, Notification, future ones) is expected to accept/validate only
 * the subset of GrcObjectType values that are meaningful for it — that
 * per-feature narrowing is the consuming module's responsibility (e.g.
 * via a `satisfies` subset check or a runtime allow-list), not this
 * type's.
 *
 * MIGRATION NOTE for @dev-backend (not performed by this file):
 *   - ActionPlanSourceType / ActionLinkResourceType: already
 *     SNAKE_CASE and a subset of GrcObjectType — replace with
 *     GrcObjectType (or a `Pick`-style subset alias) directly, no
 *     value renaming needed.
 *   - RaciEntityType: needs value renaming, "Risk" -> "RISK",
 *     "Control" -> "CONTROL", "ActionPlan" -> "ACTION_PLAN", plus the
 *     matching DB CHECK constraint update and any stored data
 *     migration (Lot 1 entity_type column) if rows already exist with
 *     the PascalCase values.
 *   - NotificationResourceType: already SNAKE_CASE and equal in
 *     coverage to the full GrcObjectType — replace with GrcObjectType
 *     directly.
 *   - Each Zod `z.enum([...])` whitelist currently hand-duplicating one
 *     of these unions (e.g. notifications.routes.ts,
 *     notificationSubscriptions.routes.ts) should derive from
 *     GRC_OBJECT_TYPES below instead of repeating the literal array,
 *     so the runtime validator and the compile-time type cannot drift.
 */
export type GrcObjectType =
  | "RISK"
  | "CONTROL"
  | "KRI"
  | "ACTION_PLAN"
  | "ANOMALY"
  | "AUDIT"
  | "INCIDENT"
  | "MANAGEMENT"
  | "RISK_EVALUATION"
  | "REVIEW_CYCLE";

/** Runtime mirror of GrcObjectType, for building Zod enums / DB CHECK lists without duplicating the literal array. */
export const GRC_OBJECT_TYPES: readonly GrcObjectType[] = [
  "RISK",
  "CONTROL",
  "KRI",
  "ACTION_PLAN",
  "ANOMALY",
  "AUDIT",
  "INCIDENT",
  "MANAGEMENT",
  "RISK_EVALUATION",
  "REVIEW_CYCLE",
] as const;
