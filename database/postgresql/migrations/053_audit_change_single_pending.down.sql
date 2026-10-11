-- Rollback of 053_audit_change_single_pending.sql.
-- Drops the stored reasons of the pending/decided changes (the audit_log rows keep them).
-- Atomic: run with `psql -1 -v ON_ERROR_STOP=1 -f`.
BEGIN;

DROP INDEX role_permission_changes_one_pending_idx;
ALTER TABLE role_permission_changes DROP COLUMN reason;

DELETE FROM schema_migrations WHERE filename = '053_audit_change_single_pending.sql';

COMMIT;
