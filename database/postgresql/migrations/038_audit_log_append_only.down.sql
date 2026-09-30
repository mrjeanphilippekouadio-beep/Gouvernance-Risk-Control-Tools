-- Rollback for 038_audit_log_append_only.sql
--
-- This removes the database-level append-only guard. Only execute it
-- deliberately in a controlled maintenance window and re-apply the
-- forward migration before returning the environment to normal use.

DROP TRIGGER IF EXISTS audit_log_append_only_truncate ON audit_log;
DROP TRIGGER IF EXISTS audit_log_append_only_mutation ON audit_log;
DROP FUNCTION IF EXISTS audit_log_append_only_guard();

-- No GRANT is restored here. PUBLIC must remain without
-- UPDATE/DELETE/TRUNCATE on audit_log.
