-- Rollback of 091_framework_default_archive_guard.sql (B-13). Rejouable. Aucune donnée supprimée ou modifiée.
-- Retire le trigger de risk_frameworks et restaure les deux fonctions telles que définies par 088 (avec leur search_path).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

DROP TRIGGER IF EXISTS risk_frameworks_guard ON risk_frameworks;
DROP FUNCTION IF EXISTS risk_frameworks_guard();

CREATE OR REPLACE FUNCTION risk_framework_assign_tenant_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.kind = 'ASSIGN_PROCESS' THEN
    IF NOT EXISTS (SELECT 1 FROM processes p WHERE p.id = NEW.process_id AND p.tenant_id = NEW.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.id = NEW.framework_id AND f.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'risk_framework_change_requests: the process and the Dispositif of an assignment must belong to the tenant of the request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION processes_framework_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.risk_framework_id IS NOT NULL THEN
      RAISE EXCEPTION 'processes: risk_framework_id cannot be set at insert; it is written by an approved ASSIGN_PROCESS request' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- R-03 (retest A10): a process carrying a Dispositif cannot change tenant (it would keep another tenant's Dispositif).
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NEW.risk_framework_id IS NOT NULL THEN
    RAISE EXCEPTION 'processes: a process attached to a Dispositif cannot change tenant' USING ERRCODE = '42501';
  END IF;
  IF NEW.risk_framework_id IS NOT DISTINCT FROM OLD.risk_framework_id OR NEW.risk_framework_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.id = NEW.risk_framework_id AND f.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'processes: the Dispositif must belong to the tenant of the process' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM risk_framework_change_requests r
    WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'ASSIGN_PROCESS' AND r.status = 'APPROVED'
      AND r.process_id = NEW.id AND r.framework_id = NEW.risk_framework_id AND r.decided_at = now()
  ) THEN
    RAISE EXCEPTION 'processes: risk_framework_id requires an ASSIGN_PROCESS request approved in this transaction' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DELETE FROM schema_migrations WHERE filename = '091_framework_default_archive_guard.sql';

COMMIT;
