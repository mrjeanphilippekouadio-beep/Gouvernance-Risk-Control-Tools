-- Dev/local convenience only. NOT applied automatically by the migration
-- runner (which only reads ../migrations). Run manually against a Neon
-- dev branch: psql "$DATABASE_URL" -f database/postgresql/seed/dev_seed.sql
-- Never run against a production database.

INSERT INTO tenants (id, name, deployment_mode)
VALUES ('00000000-0000-0000-0000-000000000001', 'Djamo (dev)', 'managed_saas')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, email, display_name, roles)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'dev@example.com',
  'Dev User',
  ARRAY[
    'risk.read', 'risk.create', 'risk.update', 'risk.delete', 'risk.owner.assign',
    'feedback.read', 'feedback.update',
    'role.read', 'role.create', 'role.update', 'role.delete', 'role.assign',
    'rolegroup.audit.update'
  ]
)
ON CONFLICT DO NOTHING;

-- B-8 fixed groups (migration 049 creates them for tenants that existed
-- at migration time; this seed tenant is inserted after).
INSERT INTO roles (tenant_id, name, description, permissions, system_group)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Risk Manager', 'Groupe fixe : équipe risque (jamais vide)',
    ARRAY['risk.read','risk.create','risk.update','risk.delete','risk.escalate','risk.owner.assign','riskevaluation.read','riskevaluation.create','riskevaluation.update','riskevaluation.validate','control.read','kri.read','actionplan.read','dashboard.read','dashboard.executive','cartography.read','process.read','department.read'], 'RISK_MANAGER'),
  ('00000000-0000-0000-0000-000000000001', 'Risk Committee', 'Groupe fixe : Comité des risques (peut être vide)',
    ARRAY['risk.read','riskevaluation.read','control.read','kri.read','actionplan.read','dashboard.read','dashboard.executive','cartography.read','riskevaluation.validate.committee','treatmentdecision.validate.committee','rolegroup.audit.validate'], 'RISK_COMMITTEE'),
  ('00000000-0000-0000-0000-000000000001', 'Audit', 'Groupe fixe : Audit (peut être vide)',
    ARRAY['risk.read','riskevaluation.read','control.read','kri.read','actionplan.read','dashboard.read','dashboard.executive','cartography.read','audit.read','audit.mission.read','audit.finding.read','rolegroup.audit.validate'], 'AUDIT')
ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, email, display_name, roles)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'auditeur@example.com',
  'Dev Auditeur',
  ARRAY[]::text[]
)
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
SELECT
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM roles WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND system_group = 'AUDIT' AND deleted_at IS NULL),
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000002'
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.system_group = 'AUDIT'
  WHERE ur.tenant_id = '00000000-0000-0000-0000-000000000001'
    AND user_id = '00000000-0000-0000-0000-000000000004'
    AND revoked_at IS NULL
);
