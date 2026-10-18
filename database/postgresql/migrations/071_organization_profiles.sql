-- D3 (DECISION-074/075/076, RM-V1-Panel-Principes-Gouvernance.md « Révision DECISION-074 » R-2, lot D3) :
-- profil d'organisation (questionnaire de 6 questions) versionné.
--
-- Une ligne = UNE VERSION des réponses. Le contenu (réponses, motif, auteur, date, version du questionnaire) est
-- immuable après l'INSERT ; seules les colonnes de décision et le statut changent, et seulement le long des
-- transitions PENDING -> ACTIVE | REJECTED et ACTIVE -> SUPERSEDED. Aucune suppression (trigger + REVOKE), pas de
-- TRUNCATE. La taille (TPE / PME / grande entreprise) n'est JAMAIS stockée : elle est recalculée côté serveur à chaque
-- lecture (fonction pure classifyOrganization), donc elle suit la règle en vigueur et les comptes observés.
--
--   status  PENDING     soumise, en attente de la seconde confirmation (baisse de taille, tiers existant)
--           ACTIVE      en vigueur (au plus une par tenant)
--           SUPERSEDED  remplacée par une version plus récente
--           REJECTED    refusée par un tiers (motif obligatoire)
--   regime  NULL        version sans exception de gouvernance (ou encore en attente / rejetée)
--           ALONE       baisse de taille appliquée sans seconde validation (aucun tiers) : audit marqué
--           CONFIRMED   confirmée par un tiers (decided_by <> submitted_by, garanti par CHECK)
--
-- Toutes les fonctions de trigger épinglent search_path = pg_catalog, public, pg_temp (F-B6a-11, migration 058).
-- Permissions : orgprofile.read / submit / approve (RM-V1 R-7), rattrapage des tenants existants en fin de fichier.
-- Idempotente : IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS, UPDATE sans doublon.

CREATE TABLE IF NOT EXISTS organization_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  version               integer NOT NULL CHECK (version >= 1),
  questionnaire_version text NOT NULL CHECK (char_length(questionnaire_version) BETWEEN 1 AND 40),
  answers               jsonb NOT NULL CHECK (jsonb_typeof(answers) = 'object'),
  reason                text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status                text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  regime                text NULL CHECK (regime IN ('ALONE', 'CONFIRMED')),
  submitted_by          uuid NOT NULL REFERENCES users (id),
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  decided_by            uuid NULL REFERENCES users (id),
  decided_at            timestamptz NULL,
  decision_reason       text NULL CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 1 AND 500),
  CONSTRAINT organization_profiles_version_unique UNIQUE (tenant_id, version),
  -- maker-checker en base : l'auteur d'une soumission ne la décide jamais
  CONSTRAINT organization_profiles_maker_checker_check CHECK (decided_by IS NULL OR decided_by <> submitted_by),
  CONSTRAINT organization_profiles_pending_shape_check CHECK (
    status <> 'PENDING' OR (decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL AND regime IS NULL)),
  CONSTRAINT organization_profiles_rejected_shape_check CHECK (
    status <> 'REJECTED' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL AND regime IS NULL)),
  CONSTRAINT organization_profiles_active_shape_check CHECK (
    status NOT IN ('ACTIVE', 'SUPERSEDED')
    OR ((decided_by IS NOT NULL) = COALESCE(regime = 'CONFIRMED', false) AND (decided_by IS NULL OR decided_at IS NOT NULL)))
);

CREATE UNIQUE INDEX IF NOT EXISTS organization_profiles_active_idx
  ON organization_profiles (tenant_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS organization_profiles_pending_idx
  ON organization_profiles (tenant_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS organization_profiles_tenant_version_idx
  ON organization_profiles (tenant_id, version DESC);

-- Immuabilité : pas de DELETE ; le contenu ne change jamais ; transitions de statut limitées ; la décision est posée une fois.
CREATE OR REPLACE FUNCTION organization_profiles_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'organization_profiles: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.questionnaire_version IS DISTINCT FROM OLD.questionnaire_version
     OR NEW.answers IS DISTINCT FROM OLD.answers
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'organization_profiles: the content of a version is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE', 'REJECTED'))
            OR (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')) THEN
      RAISE EXCEPTION 'organization_profiles: transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = '42501';
    END IF;
    -- supersession : seul le statut change
    IF OLD.status = 'ACTIVE' AND (NEW.regime IS DISTINCT FROM OLD.regime OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
        OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason) THEN
      RAISE EXCEPTION 'organization_profiles: a decision is set once' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.regime IS DISTINCT FROM OLD.regime OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
    RAISE EXCEPTION 'organization_profiles: a decision is set once, with the status transition' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION organization_profiles_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS organization_profiles_guard ON organization_profiles;
CREATE TRIGGER organization_profiles_guard
  BEFORE UPDATE OR DELETE ON organization_profiles
  FOR EACH ROW EXECUTE FUNCTION organization_profiles_guard();

CREATE OR REPLACE FUNCTION organization_profiles_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'organization_profiles cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION organization_profiles_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS organization_profiles_truncate_guard ON organization_profiles;
CREATE TRIGGER organization_profiles_truncate_guard
  BEFORE TRUNCATE ON organization_profiles
  FOR EACH STATEMENT EXECUTE FUNCTION organization_profiles_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON organization_profiles TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON organization_profiles FROM grc_app_runtime;

-- Rattrapage des droits (RM-V1 R-7). Groupes fixes : RM lit, soumet et confirme ; Comité et Audit lisent et confirment.
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['orgprofile.read', 'orgprofile.submit', 'orgprofile.approve']::text[]))
WHERE system_group = 'RISK_MANAGER' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['orgprofile.read', 'orgprofile.approve']::text[]))
WHERE system_group IN ('RISK_COMMITTEE', 'AUDIT') AND deleted_at IS NULL;

-- Administrateurs (rôles hors groupes fixes portant une permission de ADMIN_PERMISSIONS) : lecture + soumission.
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['orgprofile.read', 'orgprofile.submit']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];

-- Attributions directes historiques (users.roles).
UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['orgprofile.read', 'orgprofile.submit']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];
