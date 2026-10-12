-- Rollback of 059_risk_framework_branching.sql (B-6b).
--
-- !! DESTRUCTIF : retire les colonnes d'instantané de risk_evaluations (version du Dispositif, copies des seuils
-- !! Comité) et les huit paramètres q91 de risk_framework_versions. À ne pas jouer une fois des évaluations créées
-- !! sous un Dispositif ou des versions saisies avec des valeurs q91 non par défaut, sans export préalable.
--
-- La garde risk_framework_versions_guard() est d'abord restaurée dans sa version de 056, AVEC
-- SET search_path = pg_catalog, public, pg_temp (piège F-B6a-14 : restaurer sans search_path rouvrirait F-B6a-11).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

CREATE OR REPLACE FUNCTION risk_framework_versions_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  same_content boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_framework_versions: DELETE is not permitted' USING ERRCODE = '42501';
  END IF;

  -- Tout sauf le statut, updated_at et les colonnes d'archivage / d'activation.
  same_content := (NEW.id, NEW.tenant_id, NEW.framework_id, NEW.version_number, NEW.rating_scale_id,
                   NEW.default_evaluation_mode, NEW.committee_evaluation_min_score, NEW.committee_evaluation_enforced,
                   NEW.committee_treatment_min_score, NEW.appetite_thresholds, NEW.change_approver,
                   NEW.self_proposal_allowed, NEW.created_by, NEW.last_edited_by, NEW.created_at)
                  IS NOT DISTINCT FROM
                  (OLD.id, OLD.tenant_id, OLD.framework_id, OLD.version_number, OLD.rating_scale_id,
                   OLD.default_evaluation_mode, OLD.committee_evaluation_min_score, OLD.committee_evaluation_enforced,
                   OLD.committee_treatment_min_score, OLD.appetite_thresholds, OLD.change_approver,
                   OLD.self_proposal_allowed, OLD.created_by, OLD.last_edited_by, OLD.created_at);

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'ARCHIVED') THEN
      RAISE EXCEPTION 'risk_framework_versions: a draft cannot become %', NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.activation_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation_request_id can only be set by an activation' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ARCHIVED' AND (NEW.archived_at IS NULL OR NEW.archived_by IS NULL OR NEW.archive_reason IS NULL) THEN
      RAISE EXCEPTION 'risk_framework_versions: archiving requires archived_at, archived_by and archive_reason' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING_APPROVAL' THEN
    IF NEW.status NOT IN ('DRAFT', 'ACTIVE') OR NOT same_content THEN
      RAISE EXCEPTION 'risk_framework_versions: a pending version is frozen' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'DRAFT' AND NEW.activation_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation_request_id can only be set by an activation' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
      IF NEW.activated_at IS NULL THEN
        RAISE EXCEPTION 'risk_framework_versions: activation requires activated_at' USING ERRCODE = '42501';
      END IF;
      -- F-B6a-06 : demande d'activation de CETTE version, APPROVED par un tiers, hors BOOTSTRAP.
      IF NEW.activation_request_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM risk_framework_change_requests r
           WHERE r.id = NEW.activation_request_id
             AND r.tenant_id = NEW.tenant_id
             AND r.framework_id = NEW.framework_id
             AND r.version_id = NEW.id
             AND r.kind = 'ACTIVATE_VERSION'
             AND r.status = 'APPROVED'
             AND r.decided_by IS NOT NULL
             AND r.decided_by <> r.requested_by
             AND r.decision_regime IN ('NORMAL', 'FALLBACK')
         ) THEN
        RAISE EXCEPTION 'risk_framework_versions: activation requires an APPROVED ACTIVATE_VERSION request for this version, decided by a third party (not BOOTSTRAP)' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ACTIVE : seule la transition vers ARCHIVED est permise (activation_request_id immuable) ; ARCHIVED : rien.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND same_content
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activation_request_id IS NOT DISTINCT FROM OLD.activation_request_id
     AND NEW.archived_at IS NOT NULL AND NEW.archived_by IS NOT NULL AND NEW.archive_reason IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'risk_framework_versions: a % version is immutable', OLD.status USING ERRCODE = '42501';
END;
$$;

ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS committee_vote_custom;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS committee_vote_rule;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS mastery_authoritative_source;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS hybrid_policy_enabled;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS delegation_max_days;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS delegate_executor_cumul_allowed;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS risk_owner_executor_cumul_allowed;
ALTER TABLE risk_framework_versions DROP COLUMN IF EXISTS low_criticality_threshold;

DROP INDEX IF EXISTS risk_evaluations_framework_version_idx;
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS committee_treatment_min_score;
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS committee_evaluation_enforced;
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS committee_evaluation_min_score;
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS risk_framework_version_id;

DELETE FROM schema_migrations WHERE filename = '059_risk_framework_branching.sql';

COMMIT;
