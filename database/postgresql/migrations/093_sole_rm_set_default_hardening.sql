-- q279 A (DECISION-133) + durcissements SEC-B6C INFO-12, SEC-B13-01, rebind DevOps (INFO A10 après 092).
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
--   1. q279 A : le régime SOLE_RM (q252 A) couvre aussi SET_DEFAULT (changement du Dispositif par défaut, B-13). Le CHECK de forme
--      accepte kind IN ('ASSIGN_PROCESS', 'SET_DEFAULT'). Le drapeau sole_rm_at_request (090) sert déjà aux deux : figé à la demande.
--   2. SEC-B6C INFO-12 : le CHECK SOLE_RM exige sole_rm_at_request, et la garde de 057 fige la colonne (un UPDATE sous le rôle
--      applicatif ne peut plus poser le drapeau en même temps que le régime). Fonction reprise en entier + contenu figé.
--   3. SEC-B13-01 : la garde de rattachement (processes_framework_guard, 088/091) se déclenche aussi sur deleted_at, et refuse la
--      restauration d'un processus supprimé (supprimer + vider risk_framework_id, puis restaurer = détachement sans approbation).
--      Aucun chemin applicatif ne restaure un processus.
--   4. Rebind DevOps : users.identity_subject / identity_provider qui passe d'une valeur non NULL à une autre valeur ou à NULL
--      écrit une ligne audit_log (user_id = le compte concerné, jamais la valeur de l'identifiant). La première liaison
--      (NULL -> valeur) reste tracée par l'application, pas de doublon. audit_log reste append-only (038) : INSERT seulement.
-- Aucune ligne existante modifiée. Toute fonction fixe son search_path, pg_temp en dernier (F-B6a-11, 058). Idempotente.

-- 1 + 2. CHECK de forme SOLE_RM.
ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_sole_rm_shape_check
  CHECK (decision_regime IS DISTINCT FROM 'SOLE_RM' OR (
    kind IN ('ASSIGN_PROCESS', 'SET_DEFAULT') AND status = 'APPROVED' AND decided_by = requested_by AND sole_rm_at_request
    AND decider_group IS NOT NULL AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
    AND bootstrap_justification IS NULL AND decision_comment IS NOT NULL AND length(btrim(decision_comment)) > 0
  )) NOT VALID;
-- SEC-093-02 : NOT VALID, les décisions SOLE_RM déjà écrites (possiblement sans drapeau, entre 089 et 090) ne sont jamais revalidées
-- ni réécrites ; le CHECK s'applique à toute écriture nouvelle.

-- 2. Garde 055/057 + sole_rm_at_request dans le contenu figé.
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
      NEW.reason, NEW.requested_by, NEW.created_at, NEW.sole_rm_at_request)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.kind, OLD.framework_id, OLD.version_id, OLD.process_id, OLD.previous_value,
      OLD.reason, OLD.requested_by, OLD.created_at, OLD.sole_rm_at_request) THEN
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

-- 3. Garde de rattachement (091) + deleted_at : pas de restauration d'un processus supprimé.
CREATE OR REPLACE FUNCTION processes_framework_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.risk_framework_id IS NOT NULL THEN
      RAISE EXCEPTION 'processes: risk_framework_id cannot be set at insert; it is written by an approved ASSIGN_PROCESS request' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- SEC-B13-01: delete + clear + restore would detach a live process without approval; nothing restores a process.
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'processes: a deleted process cannot be restored' USING ERRCODE = '42501';
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

DROP TRIGGER IF EXISTS processes_framework_guard ON processes;
CREATE TRIGGER processes_framework_guard
  BEFORE INSERT OR UPDATE OF risk_framework_id, tenant_id, deleted_at ON processes
  FOR EACH ROW EXECUTE FUNCTION processes_framework_guard();

-- 4. Audit du rebind d'identité (secours DevOps). AFTER : la ligne n'est écrite que si l'UPDATE a abouti.
CREATE OR REPLACE FUNCTION users_identity_rebind_audit() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, reason, request_id)
  VALUES (
    NEW.tenant_id, NEW.id, 'User', NEW.id, 'UPDATE',
    jsonb_build_object('identityLinked', true, 'identityProvider', OLD.identity_provider),
    jsonb_build_object('identityLinked', NEW.identity_subject IS NOT NULL, 'identityProvider', NEW.identity_provider, 'executedBy', session_user::text),
    CASE WHEN NEW.identity_subject IS NULL
      THEN 'Identity binding cleared (DevOps rebind): the account will be linked again at the next login'
      ELSE 'Identity binding changed directly in the database' END,
    'identity-rebind'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_identity_rebind_audit ON users;
CREATE TRIGGER users_identity_rebind_audit
  AFTER UPDATE OF identity_subject, identity_provider ON users
  FOR EACH ROW
  WHEN (OLD.identity_subject IS NOT NULL
        AND (NEW.identity_subject IS DISTINCT FROM OLD.identity_subject OR NEW.identity_provider IS DISTINCT FROM OLD.identity_provider))
  EXECUTE FUNCTION users_identity_rebind_audit();
