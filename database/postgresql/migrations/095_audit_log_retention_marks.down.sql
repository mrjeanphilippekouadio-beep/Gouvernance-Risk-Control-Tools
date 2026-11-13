-- Rollback de 095_audit_log_retention_marks.sql : supprime la fonction et la table de marques (les lignes de audit_log, jamais
-- touchées, redeviennent toutes visibles). Le code (filtre NOT EXISTS des trois lectures) doit être retiré AVANT.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

-- SEC-L1-02 : le rollback ne détruit jamais la trace des marquages. Refus s'il existe au moins une marque.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.audit_log_retention_marks) THEN
    RAISE EXCEPTION '095 down refused: audit_log_retention_marks holds marks (the trace of the retention runs would be lost)' USING ERRCODE = '55000';
  END IF;
END $$;

DROP FUNCTION IF EXISTS mark_expired_audit_log(uuid, interval);
DROP TRIGGER IF EXISTS audit_log_retention_marks_truncate ON audit_log_retention_marks;
DROP TRIGGER IF EXISTS audit_log_retention_marks_mutation ON audit_log_retention_marks;
DROP TABLE IF EXISTS audit_log_retention_marks;
DROP FUNCTION IF EXISTS audit_log_retention_marks_guard();

DELETE FROM schema_migrations WHERE filename = '095_audit_log_retention_marks.sql';
COMMIT;
