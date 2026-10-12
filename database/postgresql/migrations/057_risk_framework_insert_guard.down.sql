-- Rollback of 057_risk_framework_insert_guard.sql (F-B6a-09).
--
-- Retire les deux triggers BEFORE INSERT et leurs fonctions, et restaure la garde UPDATE/DELETE des demandes
-- telle que définie par 055 (sans contrôle de tenant de decided_by). Aucune donnée supprimée ou modifiée.
-- Si 055 change un jour risk_framework_change_requests_guard(), resynchroniser la copie ci-dessous.
-- Le fichier gère sa transaction : l'exécuter avec `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS risk_framework_versions_insert_guard ON risk_framework_versions;
DROP TRIGGER IF EXISTS risk_framework_change_requests_insert_guard ON risk_framework_change_requests;
DROP FUNCTION IF EXISTS risk_framework_versions_insert_guard();
DROP FUNCTION IF EXISTS risk_framework_change_requests_insert_guard();

CREATE OR REPLACE FUNCTION risk_framework_change_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_framework_change_requests is append-only: DELETE is not permitted' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'risk_framework_change_requests is append-only: only PENDING -> a decision is permitted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.kind, NEW.framework_id, NEW.version_id, NEW.process_id, NEW.previous_value,
      NEW.reason, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.kind, OLD.framework_id, OLD.version_id, OLD.process_id, OLD.previous_value,
      OLD.reason, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'risk_framework_change_requests: the content of a request cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
