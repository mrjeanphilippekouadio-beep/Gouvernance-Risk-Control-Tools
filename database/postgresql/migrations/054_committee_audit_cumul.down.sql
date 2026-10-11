-- Rollback of 054_committee_audit_cumul.sql.
-- Atomic: run with `psql -1 -v ON_ERROR_STOP=1 -f`.
BEGIN;

ALTER TABLE configs DROP COLUMN committee_audit_cumul_allowed;

DELETE FROM schema_migrations WHERE filename = '054_committee_audit_cumul.sql';

COMMIT;
