import { apiRequest } from "./client";

export type FeedbackCategory = "BUG" | "IDEA" | "RECOMMENDATION" | "OTHER";

export interface Feedback {
  id: string;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  status: "NEW" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "DECLINED";
  createdAt: string;
}

export interface CreateFeedbackInput {
  category: FeedbackCategory;
  message: string;
  page?: string;
}

export const feedbackApi = {
  create: (token: string, input: CreateFeedbackInput) =>
    apiRequest<Feedback>("/api/v1/feedback", { method: "POST", body: input, token }),
};
