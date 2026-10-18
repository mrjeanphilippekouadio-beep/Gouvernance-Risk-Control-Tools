-- P2 Codex (PR #186) : « Make scale deletion atomic with draft references ».
-- Course : un auteur de Dispositif passe getById(échelle), la désactivation voit « aucune référence » et soft-delete
-- l'échelle, puis l'auteur insère un brouillon qui la référence (la FK le permet : la ligne physique reste, et le gel
-- de 055 laisse passer les brouillons) => brouillon non activable.
-- Correctif, des deux côtés, sans dépendre d'une lecture MVCC périmée :
--   A. risk_framework_versions BEFORE INSERT / UPDATE OF rating_scale_id : verrouille la ligne d'échelle (FOR SHARE,
--      même tenant) et refuse si elle est supprimée. Le verrou entre en conflit avec l'UPDATE du soft delete.
--   B. rating_scales BEFORE UPDATE : à la suppression douce, refuse si une version (brouillon inclus) la référence.
--      Le trigger ligne s'exécute après l'attente du verrou de ligne, avec un instantané frais (READ COMMITTED) : il voit
--      donc le brouillon que l'auteur concurrent vient de valider.
-- Toutes les fonctions : SET search_path = pg_catalog, public, pg_temp (inline + ALTER, F-B6a-11). Idempotente.

CREATE OR REPLACE FUNCTION risk_framework_versions_scale_alive() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rating_scale_id IS NOT DISTINCT FROM OLD.rating_scale_id THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM rating_scales s
   WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.rating_scale_id AND s.deleted_at IS NULL
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'risk_framework_versions: rating scale % does not exist or was disabled', NEW.rating_scale_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION risk_framework_versions_scale_alive() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS risk_framework_versions_scale_alive ON risk_framework_versions;
CREATE TRIGGER risk_framework_versions_scale_alive
  BEFORE INSERT OR UPDATE OF rating_scale_id ON risk_framework_versions
  FOR EACH ROW EXECUTE FUNCTION risk_framework_versions_scale_alive();

CREATE OR REPLACE FUNCTION rating_scales_delete_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM risk_framework_versions v WHERE v.tenant_id = OLD.tenant_id AND v.rating_scale_id = OLD.id) THEN
    RAISE EXCEPTION 'rating_scales: this scale is referenced by a Dispositif version (draft included) and cannot be disabled'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION rating_scales_delete_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS rating_scales_delete_guard ON rating_scales;
CREATE TRIGGER rating_scales_delete_guard
  BEFORE UPDATE OF deleted_at ON rating_scales
  FOR EACH ROW EXECUTE FUNCTION rating_scales_delete_guard();
