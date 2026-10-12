-- F-B6b-02 — l'instantané B-6b de risk_evaluations n'était gelé que par l'application.
-- Colonnes gelées : risk_framework_version_id, committee_evaluation_min_score, committee_evaluation_enforced,
-- committee_treatment_min_score, rating_scale_id.
--
-- 1. Cohérence de tenant : UNIQUE (tenant_id, id) sur risk_framework_versions (trivialement vrai, id est la clé primaire)
--    + FK composite (tenant_id, risk_framework_version_id) -> versions (tenant_id, id), MATCH SIMPLE (ignorée si la
--    colonne est NULL). NOT VALID : les nouvelles écritures sont contrôlées, les lignes existantes ne bloquent pas le déploiement
--    (la colonne date de 059 ; VALIDATE CONSTRAINT peut être joué à part). La FK simple de 059 est conservée.
-- 2. Garde BEFORE UPDATE : une colonne non NULL ne change plus (ni autre valeur, ni retour à NULL). NULL -> valeur reste permis
--    UNIQUEMENT pour rating_scale_id (BROUILLON antérieur au Dispositif qui reçoit son échelle au premier scoring inhérent,
--    spec §8.1 : PostgresRiskEvaluationRepository.recordInherentScoring). Pour les quatre autres colonnes NULL -> valeur est refusé :
--    aucun chemin applicatif ne le fait, et ce serait un instantané fabriqué après coup. SQLSTATE 42501.
--    Déclenché seulement quand l'une des cinq colonnes figure dans le SET (UPDATE OF).
--    SET search_path = pg_catalog, public, pg_temp (F-B6a-11 / F-B6a-14).
--
-- Idempotente : IF NOT EXISTS / test pg_constraint, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_tenant_id_key' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_tenant_id_key UNIQUE (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_evaluations_framework_version_tenant_fk' AND conrelid = 'risk_evaluations'::regclass) THEN
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_framework_version_tenant_fk
      FOREIGN KEY (tenant_id, risk_framework_version_id) REFERENCES risk_framework_versions (tenant_id, id) NOT VALID;
  END IF;
END $$;

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
