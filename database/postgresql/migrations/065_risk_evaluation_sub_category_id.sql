-- q145 / F-FW-02 : l'évaluation d'un risque désigne sa sous-catégorie par id (référentiel risk_categories), et le seuil
-- d'appétence applicable est retrouvé par cet id.
--
-- 1. risk_evaluations.sub_category_id uuid NULL. Jamais rempli rétroactivement : les évaluations antérieures gardent
--    leur libellé libre (colonne sub_category inchangée, c'est l'instantané lisible) et un id NULL ; l'historique n'est pas réécrit.
-- 2. FK composite (tenant_id, sub_category_id) -> risk_categories (tenant_id, id) (UNIQUE posée par 061), MATCH SIMPLE
--    (ignorée si NULL), NOT VALID : les nouvelles écritures sont contrôlées, aucune ligne existante ne bloque.
-- 3. Garde BEFORE UPDATE : sub_category et sub_category_id sont figés (aucun chemin applicatif ne les modifie ; interdit aussi
--    NULL -> valeur, ce serait un rattachement fabriqué après coup). SQLSTATE 42501.
--    SET search_path = pg_catalog, public, pg_temp (inline + ALTER, F-B6a-11).
-- Pas de DELETE. Idempotente : IF NOT EXISTS / test pg_constraint, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

ALTER TABLE risk_evaluations ADD COLUMN IF NOT EXISTS sub_category_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_evaluations_sub_category_tenant_fk' AND conrelid = 'risk_evaluations'::regclass) THEN
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_sub_category_tenant_fk
      FOREIGN KEY (tenant_id, sub_category_id) REFERENCES risk_categories (tenant_id, id) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION risk_evaluations_sub_category_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.sub_category IS DISTINCT FROM OLD.sub_category OR NEW.sub_category_id IS DISTINCT FROM OLD.sub_category_id THEN
    RAISE EXCEPTION 'risk_evaluations: the sub-category is frozen at creation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION risk_evaluations_sub_category_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS risk_evaluations_sub_category_guard ON risk_evaluations;
CREATE TRIGGER risk_evaluations_sub_category_guard
  BEFORE UPDATE OF sub_category, sub_category_id ON risk_evaluations
  FOR EACH ROW EXECUTE FUNCTION risk_evaluations_sub_category_guard();
