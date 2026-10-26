import type { NotificationResourceType } from "./entities/Notification.js";

/**
 * Catalogue of the notification types the backend persists. `mandatory` types are
 * security/governance safeguards (DECISION-042/044, q85, q95): a user cannot unsubscribe from them.
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
  { resourceType: "MANAGEMENT", eventType: "RISK_FRAMEWORK_CHANGE_PENDING", label: "Changement du Dispositif en attente", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "RISK_FRAMEWORK_CHANGE_DECIDED", label: "Changement du Dispositif décidé", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "RISK_FRAMEWORK_NO_DECIDER", label: "Dispositif sans décideur", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "RISK_FRAMEWORK_CHANGE_AUDIT_NOTICE", label: "Changement du Dispositif signalé à l’audit", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "RISK_FRAMEWORK_BOOTSTRAP_NOTICE", label: "Dispositif activé en amorçage", mandatory: true },
  // D5 (DECISION-074 R-6.3/R-6.4, q157, q158, SEC-PNL-04): governance safeguards, emitted after commit by GovernanceNotifier.
  { resourceType: "MANAGEMENT", eventType: "GOVERNANCE_EXCEPTION_RECORDED", label: "Action appliquée sans validation indépendante", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "GOVERNANCE_EXCEPTIONS_TO_REVIEW", label: "Actions sans validation indépendante à revoir", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "GOVERNANCE_EXCEPTION_CONTESTED", label: "Action sans validation indépendante contestée", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "GOVERNANCE_MEMBER_REMOVED", label: "Membre d’un groupe de gouvernance retiré", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "ORGPROFILE_SIZE_LOWERED", label: "Baisse de taille du profil d’organisation", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "ORGPROFILE_APPROVAL_PENDING", label: "Baisse de taille en attente de confirmation", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "SELF_VALIDATION_POLICY_REQUEST_PENDING", label: "Assouplissement de l’auto-validation en attente", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "PRINCIPLE_ACCEPTANCE_PENDING", label: "Acceptation d’un principe en attente de confirmation", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_STARTED_LATE", label: "Action démarrée en retard", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", label: "Action en retard", mandatory: true },
  { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", label: "Seuil KRI dépassé", mandatory: true },
];

export function isMandatoryNotification(resourceType: NotificationResourceType, eventType: string): boolean {
  return NOTIFICATION_CATALOG.some((t) => t.mandatory && t.resourceType === resourceType && t.eventType === eventType);
}
