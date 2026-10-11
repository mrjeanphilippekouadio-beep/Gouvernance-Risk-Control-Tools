-- B-8 bis (DECISION-040 q42-q46, q48): droits des 3 groupes fixes, Audit
-- remplace « Auditeur », demandes de changement des droits du groupe Audit,
-- notifications « droits perdus », action d'audit READ.
-- Ne jamais appliquer à la main : passe par `npm run migrate`.

-- 1. Notifications de gestion (droits perdus à la réactivation).
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_resource_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_resource_type_check
  CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE', 'MANAGEMENT'));
ALTER TABLE notification_subscriptions DROP CONSTRAINT IF EXISTS notification_subscriptions_resource_type_check;
ALTER TABLE notification_subscriptions ADD CONSTRAINT notification_subscriptions_resource_type_check
  CHECK (resource_type IN ('RISK', 'KRI', 'ACTION_PLAN', 'CONTROL', 'ANOMALY', 'RISK_EVALUATION', 'REVIEW_CYCLE', 'MANAGEMENT'));

-- 2. Audit : action READ (consultation « qui peut me redonner ce droit »).
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN', 'ESCALATE',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE', 'DOWNLOAD', 'READ'
  ));

-- 3. Changement des droits du groupe Audit en attente de validation (q45).
CREATE TABLE role_permission_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  role_id       uuid NOT NULL REFERENCES roles (id),
  permissions   text[] NOT NULL,
  requested_by  uuid NOT NULL REFERENCES users (id),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  decided_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX role_permission_changes_tenant_idx ON role_permission_changes (tenant_id, status);

-- 4. Droits des groupes fixes (q42). Uniquement si le groupe n'a aucune
-- permission (un groupe adopté par nom en 049 garde les siennes).
UPDATE roles SET permissions = ARRAY[
  'risk.read','risk.create','risk.update','risk.delete','risk.escalate','risk.owner.assign',
  'riskevaluation.read','riskevaluation.create','riskevaluation.update','riskevaluation.validate',
  'kri.read','kri.create','kri.update','kri.delete',
  'actionplan.read','actionplan.create','actionplan.update','actionplan.validate',
  'control.read','control.create','control.update','control.delete',
  'execution.read','execution.create','execution.validate',
  'effectiveness.read','effectiveness.create','effectiveness.validate',
  'anomaly.read','anomaly.create','anomaly.update',
  'treatmentdecision.read','treatmentdecision.create','treatmentdecision.validate',
  'evidence.read','evidence.download','evidence.upload',
  'raci.read','raci.assign','raci.revoke',
  'kpi.read','kpi.create','kpi.update','riskappetite.read','ratingscale.read',
  'process.read','department.read','cartography.read','dashboard.read','dashboard.executive',
  'governance.read','governance.create','notification.read'
] WHERE system_group = 'RISK_MANAGER' AND deleted_at IS NULL AND permissions = '{}';

UPDATE roles SET permissions = ARRAY[
  'risk.read','riskevaluation.read','kri.read','actionplan.read','control.read','execution.read',
  'effectiveness.read','anomaly.read','treatmentdecision.read','evidence.read','evidence.download',
  'raci.read','kpi.read','riskappetite.read','ratingscale.read','process.read','department.read',
  'cartography.read','dashboard.read','dashboard.executive','governance.read','notification.read',
  'riskevaluation.validate.committee','treatmentdecision.validate.committee','governance.validate',
  'rolegroup.audit.validate'
] WHERE system_group = 'RISK_COMMITTEE' AND deleted_at IS NULL AND permissions = '{}';

UPDATE roles SET permissions = ARRAY[
  'risk.read','riskevaluation.read','kri.read','actionplan.read','control.read','execution.read',
  'effectiveness.read','anomaly.read','treatmentdecision.read','evidence.read','evidence.download',
  'raci.read','kpi.read','riskappetite.read','ratingscale.read','process.read','department.read',
  'cartography.read','dashboard.read','dashboard.executive','governance.read','notification.read',
  'audit.read','audit.mission.read','audit.finding.read','rolegroup.audit.validate'
] WHERE system_group = 'AUDIT' AND deleted_at IS NULL AND permissions = '{}';

-- 5. Le groupe Audit REMPLACE le rôle « Auditeur » : ses détenteurs passent
-- dans le groupe Audit, puis le rôle est désactivé (soft). Exception : un
-- détenteur déjà membre de Risk Manager ne peut pas cumuler avec Audit (q43) ;
-- son rôle « Auditeur » est simplement retiré, sans entrée dans Audit.
INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
SELECT ur.tenant_id, g.id, ur.user_id, ur.granted_by
FROM user_roles ur
JOIN roles old ON old.id = ur.role_id AND old.name = 'Auditeur' AND old.system_group IS NULL AND old.deleted_at IS NULL
JOIN roles g ON g.tenant_id = ur.tenant_id AND g.system_group = 'AUDIT' AND g.deleted_at IS NULL
WHERE ur.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_roles x JOIN roles xr ON xr.id = x.role_id
                  WHERE x.tenant_id = ur.tenant_id AND x.user_id = ur.user_id AND x.revoked_at IS NULL
                    AND xr.system_group IN ('AUDIT', 'RISK_MANAGER') AND xr.deleted_at IS NULL);

UPDATE user_roles SET revoked_at = now()
WHERE revoked_at IS NULL
  AND role_id IN (SELECT id FROM roles WHERE name = 'Auditeur' AND system_group IS NULL AND deleted_at IS NULL);

UPDATE roles SET deleted_at = now()
WHERE name = 'Auditeur' AND system_group IS NULL AND deleted_at IS NULL;
