-- F-B6a-09 — la garde du Dispositif couvre aussi INSERT (suite de 055/056).
--
-- Objet
--   (a) risk_framework_versions : une ligne naît toujours en DRAFT, sans activation_request_id, activated_at ni
--       champs d'archivage.
--   (b) risk_framework_change_requests : une ligne naît toujours PENDING, tous les champs de décision à NULL
--       (decided_by, decided_at, decision_comment, decision_regime, decider_group, ratification_status).
--   (c) Tenant des utilisateurs : requested_by (à l'INSERT) et decided_by (à la décision) doivent appartenir
--       au tenant de la demande (la FK vers users(id) seule laissait passer un utilisateur d'un autre tenant).
--
-- Pourquoi
--   Les triggers de 055/056 sont BEFORE UPDATE OR DELETE : un INSERT direct d'une version ACTIVE, ou d'une
--   demande déjà APPROVED puis liée à une version PENDING_APPROVAL, contournait la garde d'activation de 056.
--
-- Compatibilité (vérifiée contre PostgresRiskFrameworkRepository)
--   createWithDraft / createDraftFrom : INSERT ... 'DRAFT', colonnes d'activation/archivage omises (NULL).
--   createActivationRequest : INSERT sans status (défaut PENDING), sans champ de décision.
--   recordDecision / withdraw : UPDATE uniquement (decided_by = utilisateur du tenant de l'acteur).
--   Brouillon de reprise de 055 : INSERT ... 'DRAFT' -> accepté.
--   BOOTSTRAP (B-6d) : l'amorçage passera aussi par une demande PENDING puis une décision, donc inchangé ici.
--
-- Pas de validation de lignes existantes : les triggers ne s'appliquent qu'aux nouvelles écritures.
-- Idempotente : CREATE OR REPLACE FUNCTION, DROP TRIGGER IF EXISTS puis CREATE TRIGGER. Noms explicites,
-- distincts des triggers existants (..._guard, ..._truncate_guard) -> pas de 42710.

-- 1. Versions : naissance en DRAFT -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION risk_framework_versions_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'DRAFT'
     OR NEW.activation_request_id IS NOT NULL
     OR NEW.activated_at IS NOT NULL
     OR NEW.archived_at IS NOT NULL
     OR NEW.archived_by IS NOT NULL
     OR NEW.archive_reason IS NOT NULL THEN
    RAISE EXCEPTION 'risk_framework_versions: a version must be inserted as DRAFT, without activation or archive data' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS risk_framework_versions_insert_guard ON risk_framework_versions;
CREATE TRIGGER risk_framework_versions_insert_guard
  BEFORE INSERT ON risk_framework_versions
  FOR EACH ROW EXECUTE FUNCTION risk_framework_versions_insert_guard();

-- 2. Demandes : naissance en PENDING, requested_by du tenant -------------------------------------------

CREATE OR REPLACE FUNCTION risk_framework_change_requests_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'PENDING'
     OR NEW.decided_by IS NOT NULL
     OR NEW.decided_at IS NOT NULL
     OR NEW.decision_comment IS NOT NULL
     OR NEW.decision_regime IS NOT NULL
     OR NEW.decider_group IS NOT NULL
     OR NEW.ratification_status IS NOT NULL THEN
    RAISE EXCEPTION 'risk_framework_change_requests: a request must be inserted as PENDING, with no decision data' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.requested_by AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'risk_framework_change_requests: requested_by must belong to the tenant of the request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS risk_framework_change_requests_insert_guard ON risk_framework_change_requests;
CREATE TRIGGER risk_framework_change_requests_insert_guard
  BEFORE INSERT ON risk_framework_change_requests
  FOR EACH ROW EXECUTE FUNCTION risk_framework_change_requests_insert_guard();

-- 3. Demandes : decided_by du même tenant (garde UPDATE de 055 + contrôle) -----------------------------

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
  -- F-B6a-09 : le décideur appartient au tenant de la demande.
  IF NEW.decided_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.decided_by AND u.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'risk_framework_change_requests: decided_by must belong to the tenant of the request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
