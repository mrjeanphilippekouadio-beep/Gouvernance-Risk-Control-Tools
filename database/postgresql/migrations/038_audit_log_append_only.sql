-- SEC: database-level append-only protection for the audit journal.
--
-- 037_roles_dashboard_scope_mode.sql is the latest migration currently
-- present on main. The numbers documented later in GRC_Migration_Plan.md
-- are indicative and are shifted at implementation time when another
-- migration is inserted earlier in the sequence.
--
-- Defense in depth:
--   1. PUBLIC is explicitly denied UPDATE/DELETE/TRUNCATE.
--   2. Triggers reject UPDATE/DELETE/TRUNCATE even when the application
--      connection owns the table and therefore cannot be constrained by
--      table-level REVOKE alone.
--
-- Important limitation:
-- A database owner/superuser can still disable/drop the trigger or alter
-- the schema. Production deployment must therefore also use a dedicated
-- application role that is not the database owner/admin.

CREATE OR REPLACE FUNCTION audit_log_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only_mutation ON audit_log;
CREATE TRIGGER audit_log_append_only_mutation
  BEFORE UPDATE OR DELETE
  ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_append_only_guard();

DROP TRIGGER IF EXISTS audit_log_append_only_truncate ON audit_log;
CREATE TRIGGER audit_log_append_only_truncate
  BEFORE TRUNCATE
  ON audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_append_only_guard();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM PUBLIC;
