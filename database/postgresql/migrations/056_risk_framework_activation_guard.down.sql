-- Rollback of 056_risk_framework_activation_guard.sql (F-B6a-06).
--
-- Restaure la garde de 055 (sans contrôle d'activation) et retire FK, index, CHECK BOOTSTRAP et clé unique.
-- Non destructif pour les données (aucune ligne supprimée). Afterwards, 055 reste appliquée.
-- Le fichier gère sa transaction : l'exécuter avec `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

ALTER TABLE risk_framework_versions DROP CONSTRAINT IF EXISTS risk_framework_versions_activation_request_fk;
ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_no_bootstrap_check;
DROP INDEX IF EXISTS risk_framework_versions_activation_request_idx;
DROP INDEX IF EXISTS risk_framework_change_requests_link_key;

CREATE OR REPLACE FUNCTION risk_framework_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.status = 'ARCHIVED' AND (NEW.archived_at IS NULL OR NEW.archived_by IS NULL OR NEW.archive_reason IS NULL) THEN
      RAISE EXCEPTION 'risk_framework_versions: archiving requires archived_at, archived_by and archive_reason' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING_APPROVAL' THEN
    IF NEW.status NOT IN ('DRAFT', 'ACTIVE') OR NOT same_content THEN
      RAISE EXCEPTION 'risk_framework_versions: a pending version is frozen' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ACTIVE' AND NEW.activated_at IS NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation requires activated_at' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ACTIVE : seule la transition vers ARCHIVED est permise ; ARCHIVED : rien.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND same_content
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activation_request_id IS NOT DISTINCT FROM OLD.activation_request_id
     AND NEW.archived_at IS NOT NULL AND NEW.archived_by IS NOT NULL AND NEW.archive_reason IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'risk_framework_versions: a % version is immutable', OLD.status USING ERRCODE = '42501';
END;
$$;

DELETE FROM schema_migrations WHERE filename = '056_risk_framework_activation_guard.sql';

COMMIT;
