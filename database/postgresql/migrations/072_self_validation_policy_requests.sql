-- q158 (DECISION-078) : assouplir la politique d'auto-validation (REFUSE -> DOUBLE_CONFIRMATION) est confirmé par une
-- seconde personne quand elle existe. Une ligne = une DEMANDE d'assouplissement ; la politique réelle reste
-- configs.self_validation_policy et n'est écrite qu'à l'approbation (ou directement par l'administrateur seul, sans tiers).
--
--   status  PENDING    en attente d'un approbateur (au plus une par tenant)
--           APPLIED    approuvée par une autre personne, politique appliquée
--           REJECTED   refusée par un approbateur (motif obligatoire)
--           WITHDRAWN  remplacée par une nouvelle demande / un changement direct de l'administrateur
-- Maker-checker en base : l'approbateur ou le rejeteur n'est jamais l'auteur (CHECK ; le retrait par l'auteur est permis).
-- Aucune suppression (REVOKE DELETE/TRUNCATE) + trigger de garde (SEC-PNL2-03, durci en place : 072 n'a jamais tourné sur
-- une base partagée) : contenu immuable (type, motif, auteur, date), insertion en PENDING sans colonne de décision,
-- une seule transition PENDING -> APPLIED | REJECTED | WITHDRAWN, jamais de retour ; garde TRUNCATE ;
-- `search_path = pg_catalog, public, pg_temp` (pg_temp en dernier, F-B6a-11) sur chaque définition.
-- decision_reason = motif propre de l'approbateur / du rejeteur / de celui qui retire (distinct de `reason`, celui du demandeur).
-- Droit : config.selfvalidation.approve, donné aux groupes Risk Manager et Comité (jamais à l'Audit, q157), rattrapage ci-dessous.
-- Idempotente : IF NOT EXISTS, UPDATE sans doublon.

CREATE TABLE IF NOT EXISTS self_validation_policy_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  requested_policy text NOT NULL CHECK (requested_policy IN ('REFUSE', 'DOUBLE_CONFIRMATION')),
  reason           text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_by       uuid NULL,
  decided_at       timestamptz NULL,
  decision_reason  text NULL CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 1 AND 500),
  CONSTRAINT svpr_requested_by_tenant_fk FOREIGN KEY (tenant_id, requested_by) REFERENCES users (tenant_id, id),
  CONSTRAINT svpr_decided_by_tenant_fk FOREIGN KEY (tenant_id, decided_by) REFERENCES users (tenant_id, id),
  CONSTRAINT svpr_maker_checker_check CHECK (decided_by IS NULL OR decided_by <> requested_by OR status = 'WITHDRAWN'),
  CONSTRAINT svpr_decision_shape_check CHECK ((status = 'PENDING') = (decided_by IS NULL AND decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS svpr_pending_idx ON self_validation_policy_requests (tenant_id) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION self_validation_policy_requests_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'self_validation_policy_requests: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'self_validation_policy_requests: a request is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.requested_policy IS DISTINCT FROM OLD.requested_policy OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
    RAISE EXCEPTION 'self_validation_policy_requests: the content of a request is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'self_validation_policy_requests: a request is decided once (PENDING -> final), never reopened' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION self_validation_policy_requests_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS self_validation_policy_requests_guard ON self_validation_policy_requests;
CREATE TRIGGER self_validation_policy_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON self_validation_policy_requests
  FOR EACH ROW EXECUTE FUNCTION self_validation_policy_requests_guard();

CREATE OR REPLACE FUNCTION self_validation_policy_requests_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'self_validation_policy_requests cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION self_validation_policy_requests_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS self_validation_policy_requests_truncate_guard ON self_validation_policy_requests;
CREATE TRIGGER self_validation_policy_requests_truncate_guard
  BEFORE TRUNCATE ON self_validation_policy_requests
  FOR EACH STATEMENT EXECUTE FUNCTION self_validation_policy_requests_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON self_validation_policy_requests TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON self_validation_policy_requests FROM grc_app_runtime;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['config.selfvalidation.approve']::text[]))
WHERE system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE') AND deleted_at IS NULL;
