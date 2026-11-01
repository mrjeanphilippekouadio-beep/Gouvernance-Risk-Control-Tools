-- Rollback of 081_audit_read_audit_group_only.sql : ne restaure PAS `audit.read` (q203 : il ne doit plus exister hors
-- groupe AUDIT). Les valeurs d'avant restent lisibles dans audit_log (request_id 'migration:081') ; le compte technique
-- « Système (migration 081) », suspendu, reste aussi : il est l'auteur de ces lignes d'audit.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DELETE FROM schema_migrations WHERE filename = '081_audit_read_audit_group_only.sql';

COMMIT;
