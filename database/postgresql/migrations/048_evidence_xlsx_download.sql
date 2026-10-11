-- EVD-1: evidence file fingerprint + dedicated download permission.
--
-- 1. evidences gets sha256 / file_size / mime_type. Nullable: rows uploaded
--    before this migration have no recorded hash. Non-unique index on
--    (tenant_id, sha256): a client may deliberately register a duplicate
--    file as a new reference, so uniqueness is enforced by the service
--    (409), not by the database.
-- 2. audit_log.action accepts 'DOWNLOAD' (every evidence download is audited).
-- 3. New permission `evidence.download` (replaces `evidence.read` on the
--    download-URL endpoint). Granted to every active role / legacy user that
--    already holds `evidence.read`, so nobody loses access. Idempotent.

ALTER TABLE evidences
  ADD COLUMN sha256     text,
  ADD COLUMN file_size  bigint,
  ADD COLUMN mime_type  text;

CREATE INDEX evidences_tenant_sha256_idx ON evidences (tenant_id, sha256) WHERE sha256 IS NOT NULL;

ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
    'CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'VALIDATE', 'REJECT',
    'APPROVE', 'CLOSE', 'REOPEN', 'ASSIGN', 'UNASSIGN', 'ESCALATE',
    'STATUS_CHANGE', 'ROLE_CHANGE', 'PERMISSION_CHANGE', 'DOWNLOAD'
  ));

UPDATE roles
SET permissions = array_append(permissions, 'evidence.download'),
    updated_at = now()
WHERE deleted_at IS NULL
  AND 'evidence.read' = ANY (permissions)
  AND NOT ('evidence.download' = ANY (permissions));

-- Legacy direct grants (users.roles holds permission strings).
UPDATE users
SET roles = array_append(roles, 'evidence.download')
WHERE deleted_at IS NULL
  AND 'evidence.read' = ANY (roles)
  AND NOT ('evidence.download' = ANY (roles));
