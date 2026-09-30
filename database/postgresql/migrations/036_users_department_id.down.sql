-- Rollback for 036_users_department_id.sql
--
-- Drops the index and the nullable department_id column added by the
-- forward migration. Safe at any time this column has never been
-- written by application code with real data a rollback would need to
-- preserve — no later migration in this repo (as of 036) depends on
-- users.department_id.
--
-- How to run this file: see README.md in this directory.

DROP INDEX IF EXISTS users_tenant_department_idx;
ALTER TABLE users DROP COLUMN IF EXISTS department_id;

DELETE FROM schema_migrations WHERE filename = '036_users_department_id.sql';
