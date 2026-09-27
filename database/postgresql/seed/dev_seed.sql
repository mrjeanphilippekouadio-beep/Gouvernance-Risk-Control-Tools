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
  ARRAY['risk.read', 'risk.create', 'risk.update', 'risk.delete', 'feedback.create', 'feedback.read', 'feedback.update']
)
ON CONFLICT DO NOTHING;

-- Built-in "Auditeur" role (CLAUDE.md "Domaine Audit" gap, ACT-071):
-- read-only access to the audit trail, assignable via
-- POST /api/v1/roles/:id/assign like any other role.
INSERT INTO roles (id, tenant_id, name, description, permissions)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000001',
  'Auditeur',
  'Accès lecture seule à l''audit trail (ACT-071)',
  ARRAY['audit.read']
)
ON CONFLICT DO NOTHING;

INSERT INTO users (id, tenant_id, email, display_name, roles)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000001',
  'auditeur@example.com',
  'Dev Auditeur',
  ARRAY['feedback.create']
)
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by)
SELECT
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000002'
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
    AND role_id = '00000000-0000-0000-0000-000000000003'
    AND user_id = '00000000-0000-0000-0000-000000000004'
    AND revoked_at IS NULL
);
