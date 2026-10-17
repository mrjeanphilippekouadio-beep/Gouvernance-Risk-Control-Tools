-- F-B6b-06 / F-B6b-07 / F-CAT-02 (partie DB).
--
-- 1. F-B6b-06 : 060 ne gardait que l'UPDATE. Garde BEFORE INSERT sur risk_evaluations : l'instantané doit être
--    exactement ce que PostgresRiskEvaluationRepository.create écrit.
--    - risk_framework_version_id NULL (évaluation « legacy » sans Dispositif) : tout l'instantané doit être NULL
--      (rating_scale_id, rating_scale_version, 3x committee_*).
--    - risk_framework_version_id renseigné : la version existe dans le tenant de la ligne, est ACTIVE (le service
--      résout getActiveVersion), et rating_scale_id, rating_scale_version (= rating_scales.version de cette échelle) et
--      les trois seuils Comité sont identiques à ceux de la version. Sinon SQLSTATE 42501.
-- 2. F-B6b-07 : UNIQUE (tenant_id, id) sur rating_scales + FK composite NOT VALID (tenant_id, rating_scale_id) ;
--    rating_scale_version rejoint les colonnes gelées du trigger UPDATE de 060 (non NULL => immuable ;
--    NULL -> valeur reste permis, comme rating_scale_id : recordInherentScoring les pose ensemble).
-- 3. F-CAT-02 : UNIQUE (tenant_id, id) sur risk_categories + FK composite NOT VALID (tenant_id, parent_id).
--    La FK simple parent_id de 024 est conservée.
-- Toutes les fonctions : SET search_path = pg_catalog, public, pg_temp (inline + ALTER, F-B6a-11).
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rating_scales_tenant_id_key' AND conrelid = 'rating_scales'::regclass) THEN
    ALTER TABLE rating_scales ADD CONSTRAINT rating_scales_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_evaluations_rating_scale_tenant_fk' AND conrelid = 'risk_evaluations'::regclass) THEN
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_rating_scale_tenant_fk
      FOREIGN KEY (tenant_id, rating_scale_id) REFERENCES rating_scales (tenant_id, id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_categories_tenant_id_key' AND conrelid = 'risk_categories'::regclass) THEN
    ALTER TABLE risk_categories ADD CONSTRAINT risk_categories_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_categories_parent_tenant_fk' AND conrelid = 'risk_categories'::regclass) THEN
    ALTER TABLE risk_categories ADD CONSTRAINT risk_categories_parent_tenant_fk
      FOREIGN KEY (tenant_id, parent_id) REFERENCES risk_categories (tenant_id, id) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION risk_evaluations_snapshot_insert_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v risk_framework_versions%ROWTYPE;
  scale_version text;
BEGIN
  IF NEW.risk_framework_version_id IS NULL THEN
    IF NEW.rating_scale_id IS NOT NULL OR NEW.rating_scale_version IS NOT NULL
       OR NEW.committee_evaluation_min_score IS NOT NULL OR NEW.committee_evaluation_enforced IS NOT NULL
       OR NEW.committee_treatment_min_score IS NOT NULL THEN
      RAISE EXCEPTION 'risk_evaluations: a snapshot requires a framework version' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v FROM risk_framework_versions WHERE tenant_id = NEW.tenant_id AND id = NEW.risk_framework_version_id;
  -- Two messages on purpose (F-REF-04): only "must be ACTIVE" is a retryable race for the application (409);
  -- a version outside the tenant is an isolation bug and must stay a logged 500.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'risk_evaluations: the framework version does not belong to the tenant' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'risk_evaluations: the framework version must be ACTIVE' USING ERRCODE = '42501';
  END IF;
  SELECT s.version INTO scale_version FROM rating_scales s WHERE s.tenant_id = NEW.tenant_id AND s.id = v.rating_scale_id;
  IF NEW.rating_scale_id IS DISTINCT FROM v.rating_scale_id
     OR NEW.rating_scale_version IS DISTINCT FROM scale_version
     OR NEW.committee_evaluation_min_score IS DISTINCT FROM v.committee_evaluation_min_score
     OR NEW.committee_evaluation_enforced IS DISTINCT FROM v.committee_evaluation_enforced
     OR NEW.committee_treatment_min_score IS DISTINCT FROM v.committee_treatment_min_score THEN
    RAISE EXCEPTION 'risk_evaluations: the snapshot does not match the framework version' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION risk_evaluations_snapshot_insert_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS risk_evaluations_snapshot_insert_guard ON risk_evaluations;
CREATE TRIGGER risk_evaluations_snapshot_insert_guard
  BEFORE INSERT ON risk_evaluations FOR EACH ROW EXECUTE FUNCTION risk_evaluations_snapshot_insert_guard();

-- Garde UPDATE de 060 + gel de rating_scale_version (le SET search_path est répété : F-B6a-11).
CREATE OR REPLACE FUNCTION risk_evaluations_snapshot_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (OLD.risk_framework_version_id IS NOT NULL AND NEW.risk_framework_version_id IS DISTINCT FROM OLD.risk_framework_version_id)
     OR (OLD.committee_evaluation_min_score IS NOT NULL AND NEW.committee_evaluation_min_score IS DISTINCT FROM OLD.committee_evaluation_min_score)
     OR (OLD.committee_evaluation_enforced IS NOT NULL AND NEW.committee_evaluation_enforced IS DISTINCT FROM OLD.committee_evaluation_enforced)
     OR (OLD.committee_treatment_min_score IS NOT NULL AND NEW.committee_treatment_min_score IS DISTINCT FROM OLD.committee_treatment_min_score)
     OR (OLD.rating_scale_id IS NOT NULL AND NEW.rating_scale_id IS DISTINCT FROM OLD.rating_scale_id)
     OR (OLD.rating_scale_version IS NOT NULL AND NEW.rating_scale_version IS DISTINCT FROM OLD.rating_scale_version) THEN
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
                   committee_treatment_min_score, rating_scale_id, rating_scale_version
  ON risk_evaluations FOR EACH ROW EXECUTE FUNCTION risk_evaluations_snapshot_guard();
