import type { NotificationResourceType } from "./entities/Notification.js";

/**
 * Catalogue of the notification types the backend persists. `mandatory` types are
 * security/governance safeguards (DECISION-042): a user cannot unsubscribe from them.
 */
export interface NotificationTypeInfo {
  resourceType: NotificationResourceType;
  eventType: string;
  label: string;
  mandatory: boolean;
}

export const NOTIFICATION_CATALOG: readonly NotificationTypeInfo[] = [
  { resourceType: "MANAGEMENT", eventType: "RIGHTS_LOST_ON_REACTIVATION", label: "Droits perdus à la réactivation", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "ADMIN_RISK_MANAGER_CUMUL", label: "Cumul administrateur et gestionnaire des risques", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "COMMITTEE_MEMBER_ADDED", label: "Nouveau membre du comité", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "AUDIT_RIGHTS_CHANGE_PENDING", label: "Changement de droits d’audit en attente", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_STARTED_LATE", label: "Action démarrée en retard", mandatory: false },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", label: "Action en retard", mandatory: false },
  { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", label: "Seuil KRI dépassé", mandatory: false },
];

export function isMandatoryNotification(resourceType: NotificationResourceType, eventType: string): boolean {
  return NOTIFICATION_CATALOG.some((t) => t.mandatory && t.resourceType === resourceType && t.eventType === eventType);
}
