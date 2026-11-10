-- SEC-B6C-03 (B-6c) — garde en base sur processes.risk_framework_id et sur les références d'une demande ASSIGN_PROCESS.
--
-- Objet
--   (a) processes : risk_framework_id ne peut pas être posé à l'INSERT ; à l'UPDATE, toute valeur non NULL exige
--       (1) un Dispositif du MÊME tenant que le processus (la FK simple vers risk_frameworks(id) ne le garantit pas) et
--       (2) une demande ASSIGN_PROCESS APPROVED du même tenant, pour ce processus et ce Dispositif, décidée dans
--           la transaction courante (decided_at = now(), qui est l'heure de début de la transaction) : seul le chemin
--           d'approbation (decideAssignment) satisfait la condition. Remettre la colonne à NULL reste permis.
--   (b) risk_framework_change_requests : une demande ASSIGN_PROCESS naît avec un processus et un Dispositif du tenant
--       de la demande.
--
-- Compatibilité (vérifiée contre PostgresRiskFrameworkRepository.decideAssignment) : la demande est passée à APPROVED
-- (decided_at = now()) AVANT l'UPDATE de processes, dans la même transaction. Aucun autre écrivain de la colonne.
-- Pas de validation de lignes existantes : les triggers ne s'appliquent qu'aux nouvelles écritures.
-- Toute fonction fixe son search_path, pg_temp en dernier (F-B6a-11, 058).
-- Idempotente : CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS puis CREATE TRIGGER.

CREATE OR REPLACE FUNCTION processes_framework_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.risk_framework_id IS NOT NULL THEN
      RAISE EXCEPTION 'processes: risk_framework_id cannot be set at insert; it is written by an approved ASSIGN_PROCESS request' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
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

DROP TRIGGER IF EXISTS processes_framework_guard ON processes;
CREATE TRIGGER processes_framework_guard
  BEFORE INSERT OR UPDATE OF risk_framework_id ON processes
  FOR EACH ROW EXECUTE FUNCTION processes_framework_guard();

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

DROP TRIGGER IF EXISTS risk_framework_assign_tenant_guard ON risk_framework_change_requests;
CREATE TRIGGER risk_framework_assign_tenant_guard
  BEFORE INSERT ON risk_framework_change_requests
  FOR EACH ROW EXECUTE FUNCTION risk_framework_assign_tenant_guard();
