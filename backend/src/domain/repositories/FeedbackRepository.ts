import type { CreateFeedbackInput, Feedback, FeedbackStatus } from "../entities/Feedback.js";

export interface FeedbackRepository {
  create(input: CreateFeedbackInput): Promise<Feedback>;
  getById(tenantId: string, id: string): Promise<Feedback | null>;
  list(tenantId: string, options?: { status?: FeedbackStatus }): Promise<Feedback[]>;
  /** The only mutation allowed after creation — narrow, like ControlExecution's recordValidation. */
  updateStatus(tenantId: string, id: string, status: FeedbackStatus): Promise<Feedback>;
}
