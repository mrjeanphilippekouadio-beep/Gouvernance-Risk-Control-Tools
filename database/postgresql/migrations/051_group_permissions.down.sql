-- Rollback of 051_group_permissions.sql.
-- Perd : les demandes de changement en attente, les droits posés sur les 3 groupes
-- (remis à vide), l'état « Auditeur » : le rôle est réactivé mais ses anciens
-- détenteurs ne sont PAS ré-attribués (à refaire à la main depuis l'audit).
-- Sûr seulement si aucune notification MANAGEMENT ni ligne d'audit READ n'existe.

UPDATE roles SET deleted_at = NULL WHERE name = 'Auditeur' AND system_group IS NULL;
UPDATE roles SET permissions = '{}' WHERE system_group IS NOT NULL;
DROP TABLE role_permission_changes;

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN', 'ESCALATE',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE', 'DOWNLOAD'
  ));

ALTER TABLE notification_subscriptions DROP CONSTRAINT notification_subscriptions_resource_type_check;
ALTER TABLE notification_subscriptions ADD CONSTRAINT notification_subscriptions_resource_type_check
  CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE'));
ALTER TABLE notifications DROP CONSTRAINT notifications_resource_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_resource_type_check
  CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE'));

DELETE FROM schema_migrations WHERE filename = '051_group_permissions.sql';
