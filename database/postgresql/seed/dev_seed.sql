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
  ARRAY['risk.create', 'risk.update', 'risk.approve']
)
ON CONFLICT DO NOTHING;
