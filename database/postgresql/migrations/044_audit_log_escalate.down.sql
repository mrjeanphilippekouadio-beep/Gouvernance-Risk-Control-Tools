-- Rollback of 044_audit_log_escalate.sql. Restores the exact original
-- CHECK constraint from 004_audit_log.sql (no value guessed).
--
-- Safe only as long as no audit_log row has been inserted with
-- action = 'ESCALATE' yet — check
-- `SELECT count(*) FROM audit_log WHERE action = 'ESCALATE'` returns 0
-- before running this in a shared environment; otherwise the ADD
-- CONSTRAINT below fails (existing rows would violate it).

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE'
  ));

DELETE FROM schema_migrations WHERE filename = '044_audit_log_escalate.sql';
