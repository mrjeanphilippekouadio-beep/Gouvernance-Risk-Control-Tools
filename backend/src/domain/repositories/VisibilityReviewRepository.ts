/** Conservation L2c (q248 B, q269 A): a restriction is reviewed every 12 months by the Risk Manager (a constant, no setting). */
export const VISIBILITY_REVIEW_PERIOD_MONTHS = 12;
/** Bound of the list shown in the governance panel (the total stays exact). */
export const VISIBILITY_REVIEW_LIST_LIMIT = 50;

/** The restrictable roots (whitelist: a type is never taken from a client string without going through it). */
export const REVIEWABLE_TYPES = ["RISK", "CONTROL", "ANOMALY", "ACTION_PLAN", "KPI"] as const;
export type ReviewableType = (typeof REVIEWABLE_TYPES)[number];

/**
 * A resource still restricted (visibility other than CLIENT) whose review is overdue. SEC-L2C-01: the clock is per RESOURCE and
 * only a Risk Manager confirmation restarts it (nothing else: not a renewal, an opening, a perimeter change, a new reason).
 * Starts at the latest of: the last confirmation, the start of the current restriction (last change from CLIENT to restricted),
 * else the resource's creation date. Carries no reason text.
 */
export interface DueVisibilityReview {
  resourceType: ReviewableType;
  resourceId: string;
  visibility: string;
  dueSince: Date;
  lastReviewedAt: Date | null;
}

export interface VisibilityReviewRepository {
  /**
   * Overdue reviews, oldest first. `total` is exact; `totalExcludingNominative` leaves the NOMINATIF ones out (q198: the count
   * shown to readers who do not see everything); `items` holds at most `limit` rows. Tenant-scoped.
   */
  listDue(tenantId: string, limit: number): Promise<{ total: number; totalExcludingNominative: number; items: DueVisibilityReview[] }>;
  /**
   * Records the review of one resource, under a row lock, with its audit line (on the resource, no text, no reference) in the
   * same transaction. Returns null when it is not due (unknown, other tenant, not restricted, reviewed within the period).
   */
  confirm(tenantId: string, type: ReviewableType, id: string, userId: string, requestId: string): Promise<{ reviewedAt: Date } | null>;
}
