-- Rollback of 048_evidence_xlsx_download.sql.
-- Safe only if no audit_log row has action = 'DOWNLOAD' yet (the restored
-- CHECK would reject it): check
-- `SELECT count(*) FROM audit_log WHERE action = 'DOWNLOAD'` is 0 first.
-- Dropping the evidences columns loses the recorded hashes.

UPDATE roles SET permissions = array_remove(permissions, 'evidence.download'), updated_at = now();
UPDATE users SET roles = array_remove(roles, 'evidence.download');

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN', 'ESCALATE',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE'
  ));

DROP INDEX IF EXISTS evidences_tenant_sha256_idx;
ALTER TABLE evidences DROP COLUMN sha256, DROP COLUMN file_size, DROP COLUMN mime_type;

DELETE FROM schema_migrations WHERE filename = '048_evidence_xlsx_download.sql';
