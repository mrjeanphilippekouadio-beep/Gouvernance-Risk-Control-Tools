-- DECISION-071 / q134 (A10 F-063-03) : un brouillon de Dispositif abandonné ne bloque plus la désactivation d'une échelle.
-- « Abandonné » = version ARCHIVED qui n'a jamais été activée (activated_at IS NULL ; l'activation est figée par les gardes
-- 055+, donc une version ACTIVE puis archivée garde son activated_at et continue de bloquer). DRAFT et PENDING_APPROVAL
-- bloquent toujours (063 pour la suppression douce ; 055 gèle déjà le contenu dès PENDING_APPROVAL).
-- Deux fonctions redéfinies : rating_scales_delete_guard (063, 23503) et rating_scales_framework_freeze (055, 42501, qui
-- bloquerait sinon la suppression douce avec une version ARCHIVED, même abandonnée). Triggers inchangés.
-- SET search_path = pg_catalog, public, pg_temp répété (inline + ALTER, F-B6a-11). Idempotente.

CREATE OR REPLACE FUNCTION rating_scales_delete_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM risk_framework_versions v
                  WHERE v.tenant_id = OLD.tenant_id AND v.rating_scale_id = OLD.id
                    AND NOT (v.status = 'ARCHIVED' AND v.activated_at IS NULL)) THEN
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
     AND EXISTS (SELECT 1 FROM risk_framework_versions v
                  WHERE v.rating_scale_id = OLD.id AND v.status <> 'DRAFT'
                    AND NOT (v.status = 'ARCHIVED' AND v.activated_at IS NULL)) THEN
    RAISE EXCEPTION 'rating_scales: this scale is referenced by a Dispositif version and is frozen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION rating_scales_framework_freeze() SET search_path = pg_catalog, public, pg_temp;
