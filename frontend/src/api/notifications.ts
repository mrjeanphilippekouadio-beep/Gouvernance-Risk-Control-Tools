import { apiRequest } from "./client";

export type NotificationResourceType =
  | "RISK" | "KRI" | "ACTION_PLAN" | "CONTROL" | "ANOMALY" | "RISK_EVALUATION" | "REVIEW_CYCLE" | "MANAGEMENT";

/** Mirrors backend `Notification` (dates are ISO strings over HTTP). */
export interface AppNotification {
  id: string;
  resourceType: NotificationResourceType;
  resourceId: string | null;
  eventType: string;
  message: string;
  sentAt: string;
  readAt: string | null;
}

export interface NotificationSubscription {
  id: string;
  resourceType: NotificationResourceType;
  eventType: string;
  enabled: boolean;
}

/** Catalogue served by the backend; `mandatory` types (security/governance) cannot be unsubscribed. */
export interface NotificationType {
  resourceType: NotificationResourceType;
  eventType: string;
  label: string;
  mandatory: boolean;
}

// The client unwraps `{ data }`, so the backend's `total` is not reachable: callers count `data.length`.
export const notificationsApi = {
  list: (token: string, opts: { read?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 50) });
    if (opts.read !== undefined) q.set("read", String(opts.read));
    return apiRequest<AppNotification[]>(`/api/v1/notifications?${q}`, { token });
  },
  unreadCount: (token: string) => apiRequest<number>("/api/v1/notifications/unread-count", { token }),
  listTypes: (token: string) => apiRequest<NotificationType[]>("/api/v1/notifications/types", { token }),
  markAllRead: (token: string) =>
    apiRequest<{ updated: number }>("/api/v1/notifications/read-all", { method: "POST", token }),
  markRead: (token: string, id: string) =>
    apiRequest<AppNotification>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH", token }),
  listSubscriptions: (token: string) =>
    apiRequest<NotificationSubscription[]>("/api/v1/notification-subscriptions", { token }),
  subscribe: (token: string, input: { resourceType: NotificationResourceType; eventType: string; enabled: boolean }) =>
    apiRequest<NotificationSubscription>("/api/v1/notification-subscriptions", { method: "POST", body: input, token }),
};
