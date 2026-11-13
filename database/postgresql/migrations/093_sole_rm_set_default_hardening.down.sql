-- Rollback of 093_sole_rm_set_default_hardening.sql. Rejouable. Aucune donnée supprimée ou modifiée.
-- Remet : le CHECK SOLE_RM de 090 (échoue, et annule tout, s'il existe une décision SOLE_RM sur SET_DEFAULT : une décision tracée
-- n'est jamais réécrite), la garde de 057 sans sole_rm_at_request, la garde de rattachement de 091 et son trigger de 088, et retire
-- le trigger d'audit du rebind. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

DROP TRIGGER IF EXISTS users_identity_rebind_audit ON users;
DROP FUNCTION IF EXISTS users_identity_rebind_audit();

DROP TRIGGER IF EXISTS processes_framework_guard ON processes;
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
  -- R-02 (SEC-b6c): detaching changes the applicable method without approval; only a deleted process may lose its Dispositif.
  IF OLD.risk_framework_id IS NOT NULL AND NEW.risk_framework_id IS NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'processes: risk_framework_id cannot be cleared on a live process' USING ERRCODE = '42501';
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
CREATE TRIGGER processes_framework_guard
  BEFORE INSERT OR UPDATE OF risk_framework_id, tenant_id ON processes
  FOR EACH ROW EXECUTE FUNCTION processes_framework_guard();

CREATE OR REPLACE FUNCTION risk_framework_change_requests_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
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
  -- F-B6a-09 : le décideur appartient au tenant de la demande.
  IF NEW.decided_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.decided_by AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'risk_framework_change_requests: decided_by must belong to the tenant of the request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_sole_rm_shape_check
  CHECK (decision_regime IS DISTINCT FROM 'SOLE_RM' OR (
    kind = 'ASSIGN_PROCESS' AND status = 'APPROVED' AND decided_by = requested_by
    AND decider_group IS NOT NULL AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
    AND bootstrap_justification IS NULL AND decision_comment IS NOT NULL AND length(btrim(decision_comment)) > 0
  ));

DELETE FROM schema_migrations WHERE filename = '093_sole_rm_set_default_hardening.sql';

COMMIT;
