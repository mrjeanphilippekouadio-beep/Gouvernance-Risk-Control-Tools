export type FeedbackCategory = "BUG" | "IDEA" | "RECOMMENDATION" | "OTHER";

export type FeedbackStatus = "NEW" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "DECLINED";

/**
 * Ticket lifecycle like Anomaly — one row, status moves forward, the
 * original submission (category/message/page) is never edited. Not
 * soft-deletable: a piece of feedback stays on record even once
 * resolved or declined, that history is the point of collecting it.
 */
export interface Feedback {
  id: string;
  tenantId: string;
  userId: string;
  category: FeedbackCategory;
  message: string;
  /** Route/path the widget was opened from, e.g. "/risks" — best-effort, not authoritative. */
  page: string | null;
  status: FeedbackStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFeedbackInput {
  tenantId: string;
  userId: string;
  category: FeedbackCategory;
  message: string;
  page?: string | null;
}
