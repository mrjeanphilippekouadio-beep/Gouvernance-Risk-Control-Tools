import { apiRequest } from "./client";

export type FeedbackCategory = "BUG" | "IDEA" | "RECOMMENDATION" | "OTHER";
export type FeedbackStatus = "NEW" | "ACKNOWLEDGED" | "IN_PROGRESS" | "RESOLVED" | "DECLINED";

export interface Feedback {
  id: string;
  category: FeedbackCategory;
  message: string;
  page: string | null;
  status: FeedbackStatus;
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

  list: (token: string, status?: FeedbackStatus) =>
    apiRequest<Feedback[]>(`/api/v1/feedback${status ? `?status=${status}` : ""}`, { token }),

  updateStatus: (token: string, id: string, status: FeedbackStatus) =>
    apiRequest<Feedback>(`/api/v1/feedback/${id}`, { method: "PATCH", body: { status }, token }),
};
