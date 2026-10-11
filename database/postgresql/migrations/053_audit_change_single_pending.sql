-- B-8 ter (F-B8b-04, F-B8b-02): one PENDING change of rights per role, and the
-- author's reason kept with the change so the validator can read it.
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
-- Fails (and rolls back, the runner is transactional) if a role already has
-- several PENDING changes. Check first:
--   SELECT role_id, count(*) FROM role_permission_changes
--   WHERE status = 'PENDING' GROUP BY role_id HAVING count(*) > 1;
-- and have the duplicates decided (rejected) through the application beforehand.

ALTER TABLE role_permission_changes ADD COLUMN reason text;

CREATE UNIQUE INDEX role_permission_changes_one_pending_idx
  ON role_permission_changes (role_id) WHERE status = 'PENDING';
