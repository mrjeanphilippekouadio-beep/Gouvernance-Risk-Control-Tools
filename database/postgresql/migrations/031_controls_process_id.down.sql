-- Rollback for 031_controls_process_id.sql
--
-- Drops the index and the nullable process_id column added by the
-- forward migration. Safe at any time this column has never been
-- written by application code with real data a rollback would need to
-- preserve — no later migration in this repo (as of 031) depends on
-- controls.process_id.
--
-- How to run this file: see README.md in this directory.

DROP INDEX IF EXISTS controls_tenant_process_idx;
ALTER TABLE controls DROP COLUMN IF EXISTS process_id;

DELETE FROM schema_migrations WHERE filename = '031_controls_process_id.sql';
