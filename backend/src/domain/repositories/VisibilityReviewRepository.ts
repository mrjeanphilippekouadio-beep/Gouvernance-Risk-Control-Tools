/** Conservation L2c (q248 B, q269 A): a restriction is reviewed every 12 months by the Risk Manager (a constant, no setting). */
export const VISIBILITY_REVIEW_PERIOD_MONTHS = 12;
/** Bound of the list shown in the governance panel (the total stays exact). */
export const VISIBILITY_REVIEW_LIST_LIMIT = 50;

/**
 * One active visibility reason (`effect_ended_at` null) that is the reason of the last visibility change of a resource still
 * restricted, whose last review (else creation) is older than the period. Never carries the reason text.
 */
export interface DueVisibilityReview {
  reasonId: string;
  source: string;
  resourceType: string;
  resourceId: string;
  createdAt: Date;
  reviewedAt: Date | null;
}

export interface VisibilityReviewRepository {
  /** Overdue reviews, oldest first; `total` is exact, `items` holds at most `limit` rows. Tenant-scoped. */
  listDue(tenantId: string, limit: number): Promise<{ total: number; items: DueVisibilityReview[] }>;
  /**
   * Sets `reviewed_at = now()` of a reason that is due, under a row lock, and writes the audit row in the same
   * transaction. Returns null when the reason is not due (unknown, other tenant, ended, not attached, or already reviewed).
   */
  confirm(tenantId: string, reasonId: string, userId: string, requestId: string): Promise<{ reviewedAt: Date } | null>;
}
