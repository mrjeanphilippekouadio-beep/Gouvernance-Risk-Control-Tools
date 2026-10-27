-- Rollback of 075_governance_delays.sql.
-- Atomic: run with `psql -1 -v ON_ERROR_STOP=1 -f`.
BEGIN;

UPDATE users SET roles = array_remove(roles, 'config.governancedelays.set') WHERE 'config.governancedelays.set' = ANY(roles);
UPDATE roles SET permissions = array_remove(permissions, 'config.governancedelays.set') WHERE 'config.governancedelays.set' = ANY(permissions);

ALTER TABLE configs
  DROP COLUMN exception_review_delay_days,
  DROP COLUMN acceptance_max_days,
  DROP COLUMN policy_request_expiry_days;

DELETE FROM schema_migrations WHERE filename = '075_governance_delays.sql';

COMMIT;
