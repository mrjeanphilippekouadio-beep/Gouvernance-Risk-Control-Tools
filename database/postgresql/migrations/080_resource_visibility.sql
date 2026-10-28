-- 080 — Visibilité configurable des ressources, lot V0 (DECISION-100, -102, -103 ; spec
-- docs/architecture/RM-V1-Visibilite-Ressources-spec.md §2). AUCUN changement de comportement :
-- 1. Colonne `visibility` sur les 5 ressources racines (risks, controls, anomalies, action_plans, kpis) :
--      CLIENT     tout le client (comportement actuel)
--      PERIMETRE  restreint au périmètre (département, propriétaire, N+1, RACI, responsable du processus + liste)
--      NOMINATIF  personnes nommées (liste + propriétaire)
--    Défaut CLIENT : toutes les lignes existantes et toute ligne créée sans la préciser restent visibles comme
--    aujourd'hui. Aucun code n'écrit encore autre chose que CLIENT (V1). Pas de ligne d'audit : rien ne change.
-- 2. Table `resource_access_grants` : la « liste de personnes » (q192). Ajout seul : une ligne = un accès accordé,
--    retiré par `revoked_at` (jamais de DELETE). Le contenu d'un accès est immuable ; seule la révocation, une fois,
--    est permise. `resource_id` n'a pas de FK (cible polymorphe) : le service vérifie l'existence dans le client avant
--    d'insérer (patron EvidenceService). Maker-checker : personne ne s'ajoute soi-même (q194, spec §5).
-- Mêmes garanties que 076 : aucune suppression (REVOKE + trigger), garde TRUNCATE,
-- `search_path = pg_catalog, public, pg_temp` sur chaque définition. Idempotente (IF NOT EXISTS / OR REPLACE).
-- Ne jamais appliquer à la main : passe par `npm run migrate`.

ALTER TABLE risks        ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT', 'PERIMETRE', 'NOMINATIF'));
ALTER TABLE controls     ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT', 'PERIMETRE', 'NOMINATIF'));
ALTER TABLE anomalies    ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT', 'PERIMETRE', 'NOMINATIF'));
ALTER TABLE action_plans ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT', 'PERIMETRE', 'NOMINATIF'));
ALTER TABLE kpis         ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'CLIENT' CHECK (visibility IN ('CLIENT', 'PERIMETRE', 'NOMINATIF'));

CREATE TABLE IF NOT EXISTS resource_access_grants (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  resource_type  text NOT NULL CHECK (resource_type IN ('RISK', 'CONTROL', 'ANOMALY', 'ACTION_PLAN', 'KPI')),
  resource_id    uuid NOT NULL,
  user_id        uuid NOT NULL,
  granted_by     uuid NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  grant_reason   text NOT NULL CHECK (char_length(btrim(grant_reason)) BETWEEN 1 AND 500),
  revoked_by     uuid NULL,
  revoked_at     timestamptz NULL,
  revoke_reason  text NULL CHECK (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 1 AND 500),
  CONSTRAINT rag_user_tenant_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT rag_granted_by_tenant_fk FOREIGN KEY (tenant_id, granted_by) REFERENCES users (tenant_id, id),
  CONSTRAINT rag_revoked_by_tenant_fk FOREIGN KEY (tenant_id, revoked_by) REFERENCES users (tenant_id, id),
  CONSTRAINT rag_no_self_grant_check CHECK (granted_by <> user_id),
  CONSTRAINT rag_revocation_shape_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL AND revoke_reason IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_active_idx
  ON resource_access_grants (tenant_id, resource_type, resource_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS rag_user_idx ON resource_access_grants (tenant_id, user_id) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION resource_access_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'resource_access_grants: rows are never deleted (revoke with revoked_at)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'resource_access_grants: an access is inserted active' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'resource_access_grants: the content of an access is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION resource_access_grants_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS resource_access_grants_guard ON resource_access_grants;
CREATE TRIGGER resource_access_grants_guard
  BEFORE INSERT OR UPDATE OR DELETE ON resource_access_grants
  FOR EACH ROW EXECUTE FUNCTION resource_access_grants_guard();

CREATE OR REPLACE FUNCTION resource_access_grants_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'resource_access_grants cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION resource_access_grants_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS resource_access_grants_truncate_guard ON resource_access_grants;
CREATE TRIGGER resource_access_grants_truncate_guard
  BEFORE TRUNCATE ON resource_access_grants
  FOR EACH STATEMENT EXECUTE FUNCTION resource_access_grants_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON resource_access_grants TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON resource_access_grants FROM grc_app_runtime;
