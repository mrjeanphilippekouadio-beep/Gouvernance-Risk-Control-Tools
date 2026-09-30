-- Rollback for 037_roles_dashboard_scope_mode.sql
--
-- Drops the RACI user index and the roles.dashboard_scope_mode column
-- (its CHECK constraint goes with it). Non-destructive as long as no
-- role has actually been switched away from the 'GLOBAL' default by
-- RoleService — verify before running in a shared environment whether
-- any role.dashboardScopeMode has been set to 'DEPARTMENT' (PROCESS is
-- rejected at the service layer, so it cannot appear here); rolling
-- back after that point silently returns those roles to GLOBAL
-- dashboard.executive behavior.
--
-- How to run this file: see README.md in this directory.

DROP INDEX IF EXISTS raci_assignments_tenant_user_idx;
ALTER TABLE roles DROP COLUMN IF EXISTS dashboard_scope_mode;

DELETE FROM schema_migrations WHERE filename = '037_roles_dashboard_scope_mode.sql';
