-- Rollback of 064_rating_scale_abandoned_draft.sql : retour aux définitions de 063 (delete guard) et 055+058 (freeze).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;
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

CREATE OR REPLACE FUNCTION rating_scales_framework_freeze() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF (
       (NEW.name, NEW.version, NEW.probability_levels, NEW.probability_labels, NEW.impact_levels, NEW.impact_labels,
        NEW.criticality_thresholds, NEW.impact_axes, NEW.velocity_levels, NEW.persistence_levels, NEW.mastery_scale)
       IS DISTINCT FROM
       (OLD.name, OLD.version, OLD.probability_levels, OLD.probability_labels, OLD.impact_levels, OLD.impact_labels,
        OLD.criticality_thresholds, OLD.impact_axes, OLD.velocity_levels, OLD.persistence_levels, OLD.mastery_scale)
       OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
     )
     AND EXISTS (SELECT 1 FROM risk_framework_versions v WHERE v.rating_scale_id = OLD.id AND v.status <> 'DRAFT') THEN
    RAISE EXCEPTION 'rating_scales: this scale is referenced by a Dispositif version and is frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION rating_scales_framework_freeze() SET search_path = pg_catalog, public, pg_temp;

DELETE FROM schema_migrations WHERE filename = '064_rating_scale_abandoned_draft.sql';
COMMIT;
