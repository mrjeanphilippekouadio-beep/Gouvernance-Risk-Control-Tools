-- Lot D5 (DECISION-074/078, RM-V1-Panel-Principes-Gouvernance.md, lignes 3 et 12 du tableau R-1) :
-- revue par un tiers d'une action sans seconde validation, et acceptation datée d'un principe non respecté.
--
-- governance_exception_reviews : AJOUT SEUL (aucun UPDATE, aucun DELETE, pas de TRUNCATE). Une revue ne s'annule pas.
--   outcome REVIEWED   = un tiers a pris connaissance de l'action et la relit (le panel passe l'objet à « revu par un tiers »)
--           CONTESTED  = contestation (q157 : l'Audit est prévenu de chaque baisse de taille et peut la contester ; il ne décide
--                        jamais). Une contestation ne change AUCUN état métier : elle prévient le Risk Manager et le Comité.
--   Écart au plan : l'unicité est (tenant_id, audit_log_id, reviewed_by) et non (tenant_id, audit_log_id), pour que l'Audit
--   puisse contester une action que le Risk Manager a déjà relue (et inversement). Une personne ne revoit une entrée qu'une fois.
--   Le trigger d'insertion applique en base : l'entrée d'audit existe dans le même tenant, et reviewed_by <> auteur de l'entrée.
--
-- governance_principle_acceptances : acceptation datée d'un principe non respecté (q138), contenu immuable après l'INSERT.
--   status PENDING (attend la seconde confirmation) -> ACTIVE (confirmée, regime CONFIRMED) | REJECTED (refusée par un tiers)
--          PENDING | ACTIVE -> REVOKED (fin anticipée, ou remplacement d'une acceptation échue)
--   regime ALONE = acceptée sans seconde validation (aucun tiers) ; CONFIRMED = confirmée par quelqu'un d'autre que l'acceptant.
--   L'expiration n'est PAS un état stocké : expires_at < now() => le principe redevient « non respecté » à la lecture.
--   Une ligne ne naît jamais confirmée : INSERT en PENDING, ou en ACTIVE/ALONE seulement ; la confirmation passe par l'UPDATE.
--
-- Pour les deux tables : tenant_id, FK COMPOSITES (tenant_id, <utilisateur>) -> users (tenant_id, id) (UNIQUE ajoutée par
-- 069 ; recréée ici si absente), trigger de garde avec search_path = pg_catalog, public, pg_temp (pg_temp en dernier,
-- F-B6a-11), garde TRUNCATE, REVOKE DELETE/TRUNCATE au rôle d'exécution.
-- Permissions (R-7) : governanceexception.review, governanceprinciple.accept, .acceptance.confirm, .acceptance.revoke,
-- rattrapage en fin de fichier. Écart au plan : le groupe Audit ne reçoit PAS .acceptance.confirm (q157, l'Audit ne décide jamais).
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_id_key' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Revues
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS governance_exception_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants (id),
  audit_log_id uuid NOT NULL REFERENCES audit_log (id),
  outcome      text NOT NULL CHECK (outcome IN ('REVIEWED', 'CONTESTED')),
  reviewed_by  uuid NOT NULL,
  reviewed_at  timestamptz NOT NULL DEFAULT now(),
  comment      text NOT NULL CHECK (char_length(btrim(comment)) BETWEEN 1 AND 500),
  CONSTRAINT governance_exception_reviews_reviewed_by_tenant_fk FOREIGN KEY (tenant_id, reviewed_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_exception_reviews_once_per_reviewer UNIQUE (tenant_id, audit_log_id, reviewed_by)
);

CREATE INDEX IF NOT EXISTS governance_exception_reviews_entry_idx
  ON governance_exception_reviews (tenant_id, audit_log_id);

CREATE OR REPLACE FUNCTION governance_exception_reviews_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  entry_tenant uuid;
  entry_author uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'governance_exception_reviews: rows are append-only' USING ERRCODE = '42501';
  END IF;
  SELECT a.tenant_id, a.user_id INTO entry_tenant, entry_author FROM audit_log a WHERE a.id = NEW.audit_log_id;
  IF entry_tenant IS NULL OR entry_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'governance_exception_reviews: unknown audit entry for this tenant' USING ERRCODE = '42501';
  END IF;
  -- maker-checker en base : l'auteur de l'action ne la relit jamais
  IF entry_author = NEW.reviewed_by THEN
    RAISE EXCEPTION 'governance_exception_reviews: the author of an action cannot review it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION governance_exception_reviews_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_exception_reviews_guard ON governance_exception_reviews;
CREATE TRIGGER governance_exception_reviews_guard
  BEFORE INSERT OR UPDATE OR DELETE ON governance_exception_reviews
  FOR EACH ROW EXECUTE FUNCTION governance_exception_reviews_guard();

CREATE OR REPLACE FUNCTION governance_exception_reviews_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'governance_exception_reviews cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION governance_exception_reviews_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_exception_reviews_truncate_guard ON governance_exception_reviews;
CREATE TRIGGER governance_exception_reviews_truncate_guard
  BEFORE TRUNCATE ON governance_exception_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION governance_exception_reviews_truncate_guard();

GRANT SELECT, INSERT ON governance_exception_reviews TO grc_app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON governance_exception_reviews FROM grc_app_runtime;

-- ---------------------------------------------------------------------------------------------------------------
-- Acceptations de principes
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS governance_principle_acceptances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants (id),
  principle_id       text NOT NULL CHECK (principle_id ~ '^[A-Z]+(-[A-Z0-9]+)+$' AND char_length(principle_id) <= 40),
  catalog_version    text NOT NULL CHECK (char_length(catalog_version) BETWEEN 1 AND 40),
  offenders_snapshot jsonb NOT NULL CHECK (jsonb_typeof(offenders_snapshot) = 'array'),
  reason             text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  expires_at         timestamptz NOT NULL,
  status             text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED')),
  regime             text NULL CHECK (regime IN ('ALONE', 'CONFIRMED')),
  accepted_by        uuid NOT NULL,
  accepted_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_by       uuid NULL,
  confirmed_at       timestamptz NULL,
  ended_by           uuid NULL,
  ended_at           timestamptz NULL,
  end_reason         text NULL CHECK (end_reason IS NULL OR char_length(btrim(end_reason)) BETWEEN 1 AND 500),
  CONSTRAINT governance_principle_acceptances_accepted_by_tenant_fk FOREIGN KEY (tenant_id, accepted_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_principle_acceptances_confirmed_by_tenant_fk FOREIGN KEY (tenant_id, confirmed_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_principle_acceptances_ended_by_tenant_fk FOREIGN KEY (tenant_id, ended_by) REFERENCES users (tenant_id, id),
  CONSTRAINT governance_principle_acceptances_expiry_check CHECK (expires_at > accepted_at),
  -- maker-checker en base : l'acceptant ne confirme ni ne refuse sa propre acceptation
  CONSTRAINT governance_principle_acceptances_confirmer_check CHECK (confirmed_by IS NULL OR confirmed_by <> accepted_by),
  CONSTRAINT governance_principle_acceptances_confirmed_pair_check CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
  CONSTRAINT governance_principle_acceptances_ended_triple_check CHECK (
    (ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
    OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND end_reason IS NOT NULL)),
  CONSTRAINT governance_principle_acceptances_pending_shape_check CHECK (
    status <> 'PENDING' OR (regime IS NULL AND confirmed_by IS NULL AND ended_by IS NULL)),
  CONSTRAINT governance_principle_acceptances_active_shape_check CHECK (
    status <> 'ACTIVE' OR (ended_by IS NULL AND (
      (regime = 'ALONE' AND confirmed_by IS NULL) OR (regime = 'CONFIRMED' AND confirmed_by IS NOT NULL)))),
  CONSTRAINT governance_principle_acceptances_rejected_shape_check CHECK (
    status <> 'REJECTED' OR (regime IS NULL AND confirmed_by IS NULL AND ended_by IS NOT NULL AND ended_by <> accepted_by)),
  CONSTRAINT governance_principle_acceptances_revoked_shape_check CHECK (
    status <> 'REVOKED' OR (ended_by IS NOT NULL
      AND ((regime IS NULL AND confirmed_by IS NULL) OR (regime = 'ALONE' AND confirmed_by IS NULL) OR (regime = 'CONFIRMED' AND confirmed_by IS NOT NULL))))
);

-- Une acceptation en vigueur ou en attente par principe et par tenant.
CREATE UNIQUE INDEX IF NOT EXISTS governance_principle_acceptances_open_idx
  ON governance_principle_acceptances (tenant_id, principle_id) WHERE status IN ('PENDING', 'ACTIVE');
CREATE INDEX IF NOT EXISTS governance_principle_acceptances_tenant_idx
  ON governance_principle_acceptances (tenant_id, accepted_at DESC);

CREATE OR REPLACE FUNCTION governance_principle_acceptances_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'governance_principle_acceptances: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PENDING', 'ACTIVE') OR (NEW.regime IS NOT NULL AND NEW.regime <> 'ALONE')
       OR NEW.confirmed_by IS NOT NULL OR NEW.ended_by IS NOT NULL OR NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'governance_principle_acceptances: an acceptance cannot be inserted already confirmed, ended or expired' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.principle_id IS DISTINCT FROM OLD.principle_id OR NEW.catalog_version IS DISTINCT FROM OLD.catalog_version
     OR NEW.offenders_snapshot IS DISTINCT FROM OLD.offenders_snapshot OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'governance_principle_acceptances: the content of an acceptance is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('REJECTED', 'REVOKED') OR NEW.status = OLD.status THEN
    RAISE EXCEPTION 'governance_principle_acceptances: an acceptance changes status once, along an allowed transition' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'PENDING' AND NEW.status = 'ACTIVE' THEN
    -- confirmation : seule une acceptation encore en cours de validité se confirme
    IF NEW.regime IS DISTINCT FROM 'CONFIRMED' OR NEW.ended_by IS NOT NULL OR NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'governance_principle_acceptances: invalid confirmation' USING ERRCODE = '42501';
    END IF;
  ELSIF (OLD.status = 'PENDING' AND NEW.status IN ('REJECTED', 'REVOKED')) OR (OLD.status = 'ACTIVE' AND NEW.status = 'REVOKED') THEN
    IF NEW.regime IS DISTINCT FROM OLD.regime OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
      RAISE EXCEPTION 'governance_principle_acceptances: the confirmation is set once' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'governance_principle_acceptances: transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION governance_principle_acceptances_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_principle_acceptances_guard ON governance_principle_acceptances;
CREATE TRIGGER governance_principle_acceptances_guard
  BEFORE INSERT OR UPDATE OR DELETE ON governance_principle_acceptances
  FOR EACH ROW EXECUTE FUNCTION governance_principle_acceptances_guard();

CREATE OR REPLACE FUNCTION governance_principle_acceptances_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'governance_principle_acceptances cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION governance_principle_acceptances_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS governance_principle_acceptances_truncate_guard ON governance_principle_acceptances;
CREATE TRIGGER governance_principle_acceptances_truncate_guard
  BEFORE TRUNCATE ON governance_principle_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION governance_principle_acceptances_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON governance_principle_acceptances TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON governance_principle_acceptances FROM grc_app_runtime;

-- ---------------------------------------------------------------------------------------------------------------
-- Rattrapage des droits (RM-V1 R-7), tenants existants.
--   Risk Manager : relit, accepte, confirme, met fin. Comité : relit, confirme, met fin. Audit : relit / conteste, met fin
--   (jamais de confirmation, q157). Administrateurs (rôles hors groupes fixes portant une permission de ADMIN_PERMISSIONS) :
--   acceptent et mettent fin. Attributions directes historiques (users.roles) : idem.
-- ---------------------------------------------------------------------------------------------------------------
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'governanceexception.review', 'governanceprinciple.accept', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke']::text[]))
WHERE system_group = 'RISK_MANAGER' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'governanceexception.review', 'governanceprinciple.acceptance.confirm', 'governanceprinciple.acceptance.revoke']::text[]))
WHERE system_group = 'RISK_COMMITTEE' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'governanceexception.review', 'governanceprinciple.acceptance.revoke']::text[]))
WHERE system_group = 'AUDIT' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['governanceprinciple.accept', 'governanceprinciple.acceptance.revoke']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage'
  ]::text[];

UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['governanceprinciple.accept', 'governanceprinciple.acceptance.revoke']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage'
  ]::text[];
