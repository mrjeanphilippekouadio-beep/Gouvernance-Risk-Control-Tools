-- Rollback de 097_visibility_reasons_retention.sql : reprend la garde 096 de visibility_reasons, retire la permission
-- `retention.purge` des rôles et comptes, supprime le réglage de durée. Les `effect_ended_at` posées (rattrapage et événements
-- de fin) RESTENT : ce sont des faits datés, la garde 096 les accepte. Un motif déjà effacé reste effacé (le texte ne revient pas).
-- Rejouable : aucune table n'est supposée présente sans contrôle `to_regclass`, la fonction se redéfinit par CREATE OR REPLACE.
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.visibility_reasons') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION visibility_reasons_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path = pg_catalog, public, pg_temp AS $g$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'visibility_reasons: rows are never deleted' USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'INSERT' THEN
          IF NEW.text IS NULL OR NEW.erased_at IS NOT NULL THEN
            RAISE EXCEPTION 'visibility_reasons: a reason is inserted with its text, not erased' USING ERRCODE = '42501';
          END IF;
          RETURN NEW;
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
           OR NEW.source IS DISTINCT FROM OLD.source OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'visibility_reasons: the identity of a reason is immutable' USING ERRCODE = '42501';
        END IF;
        IF (NEW.text IS DISTINCT FROM OLD.text AND (OLD.text IS NULL OR NEW.text IS NOT NULL))
           OR (NEW.erased_at IS DISTINCT FROM OLD.erased_at AND OLD.erased_at IS NOT NULL) THEN
          RAISE EXCEPTION 'visibility_reasons: the text is erased once, never restored' USING ERRCODE = '42501';
        END IF;
        IF (OLD.effect_ended_at IS NOT NULL AND (NEW.effect_ended_at IS NULL OR NEW.effect_ended_at < OLD.effect_ended_at))
           OR (OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at IS NULL OR NEW.reviewed_at < OLD.reviewed_at)) THEN
          RAISE EXCEPTION 'visibility_reasons: effect_ended_at and reviewed_at are only set or advanced' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
      END;
      $g$
    $f$;
    EXECUTE 'ALTER FUNCTION visibility_reasons_guard() SET search_path = pg_catalog, public, pg_temp';
  END IF;
END $$;

UPDATE users SET roles = array_remove(roles, 'retention.purge') WHERE 'retention.purge' = ANY(roles);
UPDATE roles SET permissions = array_remove(permissions, 'retention.purge') WHERE 'retention.purge' = ANY(permissions);

-- État antérieur (043 : DELETE accordé par défaut sur toute table).
GRANT DELETE ON configs TO grc_app_runtime;
ALTER TABLE configs DROP COLUMN IF EXISTS visibility_reason_retention_days;

DELETE FROM schema_migrations WHERE filename = '097_visibility_reasons_retention.sql';
COMMIT;
