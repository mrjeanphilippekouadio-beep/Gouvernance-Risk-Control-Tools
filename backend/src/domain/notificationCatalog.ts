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
  // q170 (DECISION-083): the acceptor learns that someone else ended their acceptance early.
  { resourceType: "MANAGEMENT", eventType: "PRINCIPLE_ACCEPTANCE_REVOKED", label: "Acceptation d’un principe retirée", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "PRINCIPLE_ACCEPTANCE_PENDING", label: "Acceptation d’un principe en attente de confirmation", mandatory: true },
  // DECISION-095: q182 (a lengthening of the governance delays waits for a second person), q178 (Risk Manager vacancy).
  { resourceType: "MANAGEMENT", eventType: "GOVERNANCE_DELAY_REQUEST_PENDING", label: "Allongement des délais de gouvernance en attente", mandatory: true },
  // q200 (DECISION-103): a Committee/Audit member must confirm a Risk Manager's widened view of the rights matrix.
  { resourceType: "MANAGEMENT", eventType: "SENSITIVE_VIEW_GRANT_PENDING", label: "Vue élargie de la matrice des droits en attente", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "RISK_MANAGER_VACANCY", label: "Groupe Risk Manager vacant", mandatory: true },
  // q199 (DECISION-102): an owner widened the visibility of a risk; the Risk Manager group is told, nothing is blocked.
  { resourceType: "RISK", eventType: "RISK_VISIBILITY_WIDENED", label: "Visibilité d’un risque élargie par son propriétaire", mandatory: true },
  // q208 (DECISION-107): any change by the owner is reported, also when it restricts.
  { resourceType: "RISK", eventType: "RISK_VISIBILITY_RESTRICTED", label: "Visibilité d’un risque restreinte par son propriétaire", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_RESTRICTED", label: "Visibilité d’un plan d’action restreinte par son responsable", mandatory: true },
  { resourceType: "ANOMALY", eventType: "ANOMALY_VISIBILITY_RESTRICTED", label: "Visibilité d’une anomalie restreinte par son déclarant", mandatory: true },
  // q207 (DECISION-107): a RACI assignment or a new process owner opened a restricted resource (author outside the RM group).
  { resourceType: "CONTROL", eventType: "CONTROL_VISIBILITY_WIDENED", label: "Contrôle restreint ouvert par une affectation RACI", mandatory: true },
  // q212 (DECISION-109): a department-group role assignment opened restricted resources (author outside the RM group).
  { resourceType: "MANAGEMENT", eventType: "DEPARTMENT_GROUP_VISIBILITY_WIDENED", label: "Attribution de rôle de département : ressources restreintes ouvertes", mandatory: true },
  { resourceType: "MANAGEMENT", eventType: "PROCESS_OWNER_VISIBILITY_WIDENED", label: "Nouveau responsable de processus : ressources restreintes ouvertes", mandatory: true },
  // Lot V2: same rule for an action plan (its responsible) or an anomaly (its declarer) with their own setting.
  { resourceType: "ACTION_PLAN", eventType: "ACTION_PLAN_VISIBILITY_WIDENED", label: "Visibilité d’un plan d’action élargie par son responsable", mandatory: true },
  { resourceType: "ANOMALY", eventType: "ANOMALY_VISIBILITY_WIDENED", label: "Visibilité d’une anomalie élargie par son déclarant", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_STARTED_LATE", label: "Action démarrée en retard", mandatory: true },
  { resourceType: "ACTION_PLAN", eventType: "ACTION_OVERDUE", label: "Action en retard", mandatory: true },
  { resourceType: "KRI", eventType: "KRI_THRESHOLD_BREACH", label: "Seuil KRI dépassé", mandatory: true },
];

export function isMandatoryNotification(resourceType: NotificationResourceType, eventType: string): boolean {
  return NOTIFICATION_CATALOG.some((t) => t.mandatory && t.resourceType === resourceType && t.eventType === eventType);
}
