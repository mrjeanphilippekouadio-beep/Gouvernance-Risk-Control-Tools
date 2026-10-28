-- DECISION-095 (q182, q178).
-- 1. q178 : configs.risk_manager_vacancy_max_days, durée maximale d'une vacance du groupe Risk Manager (dernier membre
--    parti sans intérim). Défaut 60 jours, décidé par le PO (DECISION-095) ; modifiable par setGovernanceDelays.
-- 2. q182 : allonger un délai de gouvernance (ou le passer à « non configuré ») est un ASSOUPLISSEMENT : il suit le
--    circuit q158. Une ligne = une DEMANDE ; les délais réels restent sur configs et ne sont écrits qu'à l'approbation
--    (ou directement par l'administrateur seul, sans tiers, marqué config.governancedelays.adminAlone).
--      status  PENDING    en attente d'un approbateur (au plus une par tenant)
--              APPLIED    approuvée par une autre personne, délais appliqués
--              REJECTED   refusée (motif obligatoire)
--              WITHDRAWN  remplacée par une nouvelle demande / un changement direct de l'administrateur
--    requested_delays : objet JSON des seuls délais demandés (clé = nom du délai, valeur = jours ou null).
--    expires_at : fixé à la soumission depuis policy_request_expiry_days (q174, F-SAD-02), jamais recalculé.
--    Approbateur : config.selfvalidation.approve (même circuit que q158, aucun droit nouveau).
-- Mêmes garanties que 072 : maker-checker en CHECK, aucune suppression (REVOKE + trigger), contenu immuable, une seule
-- transition PENDING -> final, garde TRUNCATE, `search_path = pg_catalog, public, pg_temp` sur chaque définition.
-- Idempotente : IF NOT EXISTS / OR REPLACE. Ne jamais appliquer à la main : passe par `npm run migrate`.

ALTER TABLE configs
  ADD COLUMN IF NOT EXISTS risk_manager_vacancy_max_days integer DEFAULT 60 CHECK (risk_manager_vacancy_max_days BETWEEN 1 AND 3650);

CREATE TABLE IF NOT EXISTS governance_delay_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  requested_delays jsonb NOT NULL CHECK (jsonb_typeof(requested_delays) = 'object' AND requested_delays <> '{}'::jsonb),
  reason           text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'WITHDRAWN')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NULL,
  decided_by       uuid NULL,
  decided_at       timestamptz NULL,
  decision_reason  text NULL CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 1 AND 500),
  CONSTRAINT gdr_requested_by_tenant_fk FOREIGN KEY (tenant_id, requested_by) REFERENCES users (tenant_id, id),
  CONSTRAINT gdr_decided_by_tenant_fk FOREIGN KEY (tenant_id, decided_by) REFERENCES users (tenant_id, id),
  CONSTRAINT gdr_maker_checker_check CHECK (decided_by IS NULL OR decided_by <> requested_by OR status = 'WITHDRAWN'),
  CONSTRAINT gdr_decision_shape_check CHECK ((status = 'PENDING') = (decided_by IS NULL AND decided_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS gdr_pending_idx ON governance_delay_requests (tenant_id) WHERE status = 'PENDING';

CREATE OR REPLACE FUNCTION governance_delay_requests_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'governance_delay_requests: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL THEN
      RAISE EXCEPTION 'governance_delay_requests: a request is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.requested_delays IS DISTINCT FROM OLD.requested_delays OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'governance_delay_requests: the content of a request is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'governance_delay_requests: a request is decided once (PENDING -> final), never reopened' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION governance_delay_requests_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_delay_requests_guard ON governance_delay_requests;
CREATE TRIGGER governance_delay_requests_guard
  BEFORE INSERT OR UPDATE OR DELETE ON governance_delay_requests
  FOR EACH ROW EXECUTE FUNCTION governance_delay_requests_guard();

CREATE OR REPLACE FUNCTION governance_delay_requests_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'governance_delay_requests cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION governance_delay_requests_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_delay_requests_truncate_guard ON governance_delay_requests;
CREATE TRIGGER governance_delay_requests_truncate_guard
  BEFORE TRUNCATE ON governance_delay_requests
  FOR EACH STATEMENT EXECUTE FUNCTION governance_delay_requests_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON governance_delay_requests TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON governance_delay_requests FROM grc_app_runtime;
