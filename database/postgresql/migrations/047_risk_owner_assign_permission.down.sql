-- Rollback of 047_risk_owner_assign_permission.sql: removes the permission
-- from every role / user. Owner assignment is then impossible until the
-- backend is rolled back too (it requires risk.owner.assign).

UPDATE roles SET permissions = array_remove(permissions, 'risk.owner.assign'), updated_at = now();
UPDATE users SET roles = array_remove(roles, 'risk.owner.assign');

DELETE FROM schema_migrations WHERE filename = '047_risk_owner_assign_permission.sql';
