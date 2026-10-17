-- Rollback of 061_risk_evaluation_insert_guard.sql : retire la garde INSERT, les FK composites et les UNIQUE (tenant_id, id),
-- et restaure la garde UPDATE de 060 (copie du corps de 060 : si 060 change, resynchroniser ; search_path conservé).
-- Non destructif pour les données. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DROP TRIGGER IF EXISTS risk_evaluations_snapshot_insert_guard ON risk_evaluations;
DROP FUNCTION IF EXISTS risk_evaluations_snapshot_insert_guard();

CREATE OR REPLACE FUNCTION risk_evaluations_snapshot_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (OLD.risk_framework_version_id IS NOT NULL AND NEW.risk_framework_version_id IS DISTINCT FROM OLD.risk_framework_version_id)
     OR (OLD.committee_evaluation_min_score IS NOT NULL AND NEW.committee_evaluation_min_score IS DISTINCT FROM OLD.committee_evaluation_min_score)
     OR (OLD.committee_evaluation_enforced IS NOT NULL AND NEW.committee_evaluation_enforced IS DISTINCT FROM OLD.committee_evaluation_enforced)
     OR (OLD.committee_treatment_min_score IS NOT NULL AND NEW.committee_treatment_min_score IS DISTINCT FROM OLD.committee_treatment_min_score)
     OR (OLD.rating_scale_id IS NOT NULL AND NEW.rating_scale_id IS DISTINCT FROM OLD.rating_scale_id) THEN
    RAISE EXCEPTION 'risk_evaluations: the framework snapshot is frozen once set' USING ERRCODE = '42501';
  END IF;
  IF (OLD.risk_framework_version_id IS NULL AND NEW.risk_framework_version_id IS NOT NULL)
     OR (OLD.committee_evaluation_min_score IS NULL AND NEW.committee_evaluation_min_score IS NOT NULL)
     OR (OLD.committee_evaluation_enforced IS NULL AND NEW.committee_evaluation_enforced IS NOT NULL)
     OR (OLD.committee_treatment_min_score IS NULL AND NEW.committee_treatment_min_score IS NOT NULL) THEN
    RAISE EXCEPTION 'risk_evaluations: the framework snapshot can only be set at creation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION risk_evaluations_snapshot_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS risk_evaluations_snapshot_guard ON risk_evaluations;
CREATE TRIGGER risk_evaluations_snapshot_guard
  BEFORE UPDATE OF risk_framework_version_id, committee_evaluation_min_score, committee_evaluation_enforced,
                   committee_treatment_min_score, rating_scale_id
  ON risk_evaluations FOR EACH ROW EXECUTE FUNCTION risk_evaluations_snapshot_guard();

ALTER TABLE risk_evaluations DROP CONSTRAINT IF EXISTS risk_evaluations_rating_scale_tenant_fk;
ALTER TABLE risk_categories DROP CONSTRAINT IF EXISTS risk_categories_parent_tenant_fk;
ALTER TABLE risk_categories DROP CONSTRAINT IF EXISTS risk_categories_tenant_id_key;
ALTER TABLE rating_scales DROP CONSTRAINT IF EXISTS rating_scales_tenant_id_key;

DELETE FROM schema_migrations WHERE filename = '061_risk_evaluation_insert_guard.sql';

COMMIT;
