-- q158 (DECISION-078) : assouplir la politique d'auto-validation (REFUSE -> DOUBLE_CONFIRMATION) est confirmé par une
-- seconde personne quand elle existe. Une ligne = une DEMANDE d'assouplissement ; la politique réelle reste
-- configs.self_validation_policy et n'est écrite qu'à l'approbation (ou directement par l'administrateur seul, sans tiers).
--
--   status  PENDING    en attente d'un approbateur (au plus une par tenant)
--           APPLIED    approuvée par une autre personne, politique appliquée
--           REJECTED   refusée par un approbateur (motif obligatoire)
--           WITHDRAWN  remplacée par une nouvelle demande / un changement direct de l'administrateur
-- Maker-checker en base : l'approbateur ou le rejeteur n'est jamais l'auteur (CHECK ; le retrait par l'auteur est permis).
-- Aucune suppression (REVOKE DELETE/TRUNCATE). Aucune fonction trigger.
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

GRANT SELECT, INSERT, UPDATE ON self_validation_policy_requests TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON self_validation_policy_requests FROM grc_app_runtime;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['config.selfvalidation.approve']::text[]))
WHERE system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE') AND deleted_at IS NULL;
