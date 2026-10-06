-- D-06: widen audit_log.action's CHECK constraint to accept 'ESCALATE'.
--
-- AuditAction (backend/src/domain/entities/AuditEvent.ts) has included
-- 'ESCALATE' since RiskService.escalate (ACT-... risk escalation to a
-- superior owner) started writing it, but the CHECK constraint created in
-- 004_audit_log.sql was never amended — verified by grepping every
-- migration touching audit_log, none add it. Any real call to
-- RiskService.escalate against this schema would fail at the audit INSERT
-- with a 23514 (check_violation), after the escalation record itself has
-- already been created — an incomplete write, not caught by the in-memory
-- test doubles used elsewhere in this codebase (they don't enforce SQL
-- CHECK constraints).
--
-- Postgres names an inline `CHECK (...)` on a single column
-- `<table>_<column>_check` by default when no CONSTRAINT name was given in
-- the original CREATE TABLE (004_audit_log.sql) — verified against this
-- table before writing this migration (same convention already used by
-- 026/028/041/042 for their own CHECK widenings).
--
-- Expand-only: no existing action value removed, no column added, no
-- other table touched, append-only behavior (038) untouched.

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN', 'ESCALATE',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE'
  ));
