-- B-6a (RM V1, docs/architecture/RM-V1-B6-Dispositif-spec.md §12): the Dispositif.
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
-- Idempotente et rejouable : CREATE ... IF NOT EXISTS, contraintes testées dans pg_constraint,
-- CREATE OR REPLACE FUNCTION puis DROP TRIGGER IF EXISTS / CREATE TRIGGER, INSERT ... WHERE NOT EXISTS.
-- Aucun nom de colonne ou de contrainte existant n'est deviné : colonnes vérifiées dans
-- 012 (processes.level), 017/032 (risk_appetites), 018 (rating_scales), 024/030/045 (configs), 049 (roles.system_group).
--
-- Tables : risk_frameworks (identité), risk_framework_versions (versions immuables une fois
-- activées), risk_framework_change_requests (append-only : PENDING -> une décision).
-- Jamais de DELETE sur ces tables (REVOKE + triggers).

-- 1. Tables -----------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS risk_frameworks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description     text,
  is_default      boolean NOT NULL DEFAULT false,
  -- NULL = créé par la migration (brouillon de reprise).
  created_by      uuid REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  archived_by     uuid REFERENCES users (id),
  archive_reason  text
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_frameworks_tenant_name_idx
  ON risk_frameworks (tenant_id, lower(name)) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS risk_frameworks_tenant_default_idx
  ON risk_frameworks (tenant_id) WHERE is_default AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS risk_framework_versions (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       uuid NOT NULL REFERENCES tenants (id),
  framework_id                    uuid NOT NULL REFERENCES risk_frameworks (id),
  version_number                  integer NOT NULL CHECK (version_number >= 1),
  status                          text NOT NULL DEFAULT 'DRAFT'
                                    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'ARCHIVED')),
  rating_scale_id                 uuid NOT NULL REFERENCES rating_scales (id),
  default_evaluation_mode         text NOT NULL DEFAULT 'CLASSIQUE'
                                    CHECK (default_evaluation_mode IN ('CLASSIQUE', 'PARTICIPATIF')),
  committee_evaluation_min_score  integer NOT NULL CHECK (committee_evaluation_min_score BETWEEN 1 AND 36),
  committee_evaluation_enforced   boolean NOT NULL DEFAULT true,
  committee_treatment_min_score   integer CHECK (committee_treatment_min_score IS NULL OR committee_treatment_min_score BETWEEN 1 AND 36),
  appetite_thresholds             jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(appetite_thresholds) = 'array'),
  change_approver                 text NOT NULL DEFAULT 'RISK_MANAGER'
                                    CHECK (change_approver IN ('RISK_MANAGER', 'AUDIT', 'COMMITTEE', 'AUDIT_AND_COMMITTEE')),
  self_proposal_allowed           boolean NOT NULL DEFAULT false,
  -- NULL = créé par la migration.
  created_by                      uuid REFERENCES users (id),
  last_edited_by                  uuid REFERENCES users (id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  activated_at                    timestamptz,
  -- Pas de FK : risk_framework_change_requests référence déjà cette table (dépendance circulaire).
  activation_request_id           uuid,
  archived_at                     timestamptz,
  archived_by                     uuid REFERENCES users (id),
  archive_reason                  text,
  UNIQUE (framework_id, version_number)
);

-- Au plus une version ouverte (brouillon ou en attente) et au plus une version active par Dispositif.
CREATE UNIQUE INDEX IF NOT EXISTS risk_framework_versions_open_idx
  ON risk_framework_versions (framework_id) WHERE status IN ('DRAFT', 'PENDING_APPROVAL');
CREATE UNIQUE INDEX IF NOT EXISTS risk_framework_versions_active_idx
  ON risk_framework_versions (framework_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS risk_framework_versions_tenant_idx
  ON risk_framework_versions (tenant_id, framework_id);
CREATE INDEX IF NOT EXISTS risk_framework_versions_scale_idx
  ON risk_framework_versions (rating_scale_id);

CREATE TABLE IF NOT EXISTS risk_framework_change_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants (id),
  kind                 text NOT NULL CHECK (kind IN ('ACTIVATE_VERSION', 'ASSIGN_PROCESS', 'SET_DEFAULT')),
  framework_id         uuid NOT NULL REFERENCES risk_frameworks (id),
  version_id           uuid REFERENCES risk_framework_versions (id),
  process_id           uuid REFERENCES processes (id),
  previous_value       jsonb,
  reason               text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status               text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  requested_by         uuid NOT NULL REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_by           uuid REFERENCES users (id),
  decided_at           timestamptz,
  decision_comment     text,
  decision_regime      text CHECK (decision_regime IN ('NORMAL', 'FALLBACK', 'BOOTSTRAP')),
  decider_group        text CHECK (decider_group IN ('RISK_MANAGER', 'AUDIT', 'COMMITTEE')),
  ratification_status  text CHECK (ratification_status = 'PENDING'),
  -- Cohérence entre le type de demande et ses colonnes.
  CONSTRAINT risk_framework_change_requests_kind_check CHECK (
    (kind = 'ACTIVATE_VERSION' AND version_id IS NOT NULL AND process_id IS NULL)
    OR (kind = 'ASSIGN_PROCESS' AND process_id IS NOT NULL)
    OR (kind = 'SET_DEFAULT' AND process_id IS NULL)
  ),
  -- PENDING : rien de décidé. WITHDRAWN : retrait par le demandeur (pas de décideur). APPROVED/REJECTED : un tiers.
  CONSTRAINT risk_framework_change_requests_decision_check CHECK (
    (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL AND decision_regime IS NULL)
    OR (status = 'WITHDRAWN' AND decided_by IS NULL AND decided_at IS NOT NULL AND decision_regime IS NULL)
    OR (status IN ('APPROVED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_regime IS NOT NULL)
  ),
  -- Maker-checker en base : le décideur n'est jamais le demandeur (sauf l'amorçage BOOTSTRAP, B-6d).
  CONSTRAINT risk_framework_change_requests_maker_checker CHECK (
    decided_by IS NULL OR decided_by <> requested_by OR decision_regime = 'BOOTSTRAP'
  )
);

-- Une seule demande PENDING par (Dispositif, type, processus).
CREATE UNIQUE INDEX IF NOT EXISTS risk_framework_change_requests_pending_idx
  ON risk_framework_change_requests (framework_id, kind, COALESCE(process_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS risk_framework_change_requests_tenant_idx
  ON risk_framework_change_requests (tenant_id, status);

-- 2. processes.risk_framework_id (écrit à partir de B-6c seulement) ------------------------------

ALTER TABLE processes ADD COLUMN IF NOT EXISTS risk_framework_id uuid REFERENCES risk_frameworks (id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'processes_risk_framework_level_check'
      AND conrelid = 'processes'::regclass
  ) THEN
    ALTER TABLE processes ADD CONSTRAINT processes_risk_framework_level_check
      CHECK (risk_framework_id IS NULL OR level = 'PROCESS');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS processes_tenant_risk_framework_idx ON processes (tenant_id, risk_framework_id);

-- 3. Immuabilité (spec §6) -----------------------------------------------------------------------

-- TRUNCATE refusé sur les trois tables.
CREATE OR REPLACE FUNCTION risk_framework_truncate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'risk framework tables cannot be truncated' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION risk_framework_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  same_content boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_framework_versions: DELETE is not permitted' USING ERRCODE = '42501';
  END IF;

  -- Tout sauf le statut, updated_at et les colonnes d'archivage / d'activation.
  same_content := (NEW.id, NEW.tenant_id, NEW.framework_id, NEW.version_number, NEW.rating_scale_id,
                   NEW.default_evaluation_mode, NEW.committee_evaluation_min_score, NEW.committee_evaluation_enforced,
                   NEW.committee_treatment_min_score, NEW.appetite_thresholds, NEW.change_approver,
                   NEW.self_proposal_allowed, NEW.created_by, NEW.last_edited_by, NEW.created_at)
                  IS NOT DISTINCT FROM
                  (OLD.id, OLD.tenant_id, OLD.framework_id, OLD.version_number, OLD.rating_scale_id,
                   OLD.default_evaluation_mode, OLD.committee_evaluation_min_score, OLD.committee_evaluation_enforced,
                   OLD.committee_treatment_min_score, OLD.appetite_thresholds, OLD.change_approver,
                   OLD.self_proposal_allowed, OLD.created_by, OLD.last_edited_by, OLD.created_at);

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'ARCHIVED') THEN
      RAISE EXCEPTION 'risk_framework_versions: a draft cannot become %', NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ARCHIVED' AND (NEW.archived_at IS NULL OR NEW.archived_by IS NULL OR NEW.archive_reason IS NULL) THEN
      RAISE EXCEPTION 'risk_framework_versions: archiving requires archived_at, archived_by and archive_reason' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'PENDING_APPROVAL' THEN
    IF NEW.status NOT IN ('DRAFT', 'ACTIVE') OR NOT same_content THEN
      RAISE EXCEPTION 'risk_framework_versions: a pending version is frozen' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ACTIVE' AND NEW.activated_at IS NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation requires activated_at' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- ACTIVE : seule la transition vers ARCHIVED est permise ; ARCHIVED : rien.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND same_content
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activation_request_id IS NOT DISTINCT FROM OLD.activation_request_id
     AND NEW.archived_at IS NOT NULL AND NEW.archived_by IS NOT NULL AND NEW.archive_reason IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'risk_framework_versions: a % version is immutable', OLD.status USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS risk_framework_versions_guard ON risk_framework_versions;
CREATE TRIGGER risk_framework_versions_guard
  BEFORE UPDATE OR DELETE ON risk_framework_versions
  FOR EACH ROW EXECUTE FUNCTION risk_framework_versions_guard();

DROP TRIGGER IF EXISTS risk_framework_versions_truncate_guard ON risk_framework_versions;
CREATE TRIGGER risk_framework_versions_truncate_guard
  BEFORE TRUNCATE ON risk_framework_versions
  FOR EACH STATEMENT EXECUTE FUNCTION risk_framework_truncate_guard();

-- Demandes : pas de DELETE ; seule la transition PENDING -> décision, identité de la demande inchangée.
CREATE OR REPLACE FUNCTION risk_framework_change_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'risk_framework_change_requests is append-only: DELETE is not permitted' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status = 'PENDING' THEN
    RAISE EXCEPTION 'risk_framework_change_requests is append-only: only PENDING -> a decision is permitted' USING ERRCODE = '42501';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.kind, NEW.framework_id, NEW.version_id, NEW.process_id, NEW.previous_value,
      NEW.reason, NEW.requested_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.tenant_id, OLD.kind, OLD.framework_id, OLD.version_id, OLD.process_id, OLD.previous_value,
      OLD.reason, OLD.requested_by, OLD.created_at) THEN
    RAISE EXCEPTION 'risk_framework_change_requests: the content of a request cannot change' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS risk_framework_change_requests_guard ON risk_framework_change_requests;
CREATE TRIGGER risk_framework_change_requests_guard
  BEFORE UPDATE OR DELETE ON risk_framework_change_requests
  FOR EACH ROW EXECUTE FUNCTION risk_framework_change_requests_guard();

DROP TRIGGER IF EXISTS risk_framework_change_requests_truncate_guard ON risk_framework_change_requests;
CREATE TRIGGER risk_framework_change_requests_truncate_guard
  BEFORE TRUNCATE ON risk_framework_change_requests
  FOR EACH STATEMENT EXECUTE FUNCTION risk_framework_truncate_guard();

-- Une échelle référencée par une version non-brouillon est figée (contenu et suppression douce).
-- status, activated_at et archived_at restent modifiables : ils servent le miroir de statut.
CREATE OR REPLACE FUNCTION rating_scales_framework_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS rating_scales_framework_freeze ON rating_scales;
CREATE TRIGGER rating_scales_framework_freeze
  BEFORE UPDATE ON rating_scales
  FOR EACH ROW EXECUTE FUNCTION rating_scales_framework_freeze();

-- 4. GRANT explicites (en plus des privilèges par défaut de 043) : jamais de DELETE / TRUNCATE -------

GRANT SELECT, INSERT, UPDATE ON risk_frameworks, risk_framework_versions, risk_framework_change_requests TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON risk_frameworks, risk_framework_versions, risk_framework_change_requests FROM grc_app_runtime;

-- 5. Droits des groupes fixes (sans doublon) ----------------------------------------------------------

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY[
  'riskframework.read', 'riskframework.create', 'riskframework.update',
  'riskframework.activate', 'riskframework.archive', 'riskframework.process.assign'
]::text[]))
WHERE system_group = 'RISK_MANAGER' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['riskframework.read']::text[]))
WHERE system_group IN ('RISK_COMMITTEE', 'AUDIT') AND deleted_at IS NULL;

-- 6. Brouillon de reprise ------------------------------------------------------------------------------
-- Pour chaque tenant SANS Dispositif mais AVEC une échelle ACTIVE non supprimée : un « Dispositif initial »
-- (non par défaut, created_by NULL) et sa version 1 en DRAFT. Rien n'est activé : la première activation reste
-- un acte d'un membre Risk Manager. Un seuil hérité supérieur à n² est recopié tel quel ; la demande
-- d'activation le refusera avec un message clair.

DO $$
DECLARE
  r record;
  fw uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (s.tenant_id)
           s.tenant_id, s.id AS scale_id, s.probability_levels, s.impact_levels
    FROM rating_scales s
    WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.tenant_id = s.tenant_id)
    ORDER BY s.tenant_id, s.activated_at DESC NULLS LAST, s.created_at DESC
  LOOP
    INSERT INTO risk_frameworks (tenant_id, name, description, is_default, created_by)
    VALUES (r.tenant_id, 'Dispositif initial',
            'Repris de la méthodologie en vigueur avant le Dispositif. À vérifier puis à activer.', false, NULL)
    RETURNING id INTO fw;

    INSERT INTO risk_framework_versions
      (tenant_id, framework_id, version_number, status, rating_scale_id, default_evaluation_mode,
       committee_evaluation_min_score, committee_evaluation_enforced, committee_treatment_min_score,
       appetite_thresholds, change_approver, self_proposal_allowed, created_by, last_edited_by)
    SELECT r.tenant_id, fw, 1, 'DRAFT', r.scale_id,
           COALESCE(c.evaluation_mode, 'CLASSIQUE'),
           COALESCE(c.committee_evaluation_min_score,
                    GREATEST(1, LEAST(36, (r.probability_levels * r.impact_levels * 15) / 25))),
           COALESCE(c.committee_evaluation_enforced, true),
           c.committee_treatment_min_score,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'subCategory', a.sub_category,
                       'subCategoryId', a.sub_category_id,
                       'entity', a.entity,
                       'threshold', a.threshold,
                       'description', a.description)
                     ORDER BY a.sub_category, a.entity)
                     FROM risk_appetites a
                     WHERE a.tenant_id = r.tenant_id AND a.active AND a.deleted_at IS NULL),
                    '[]'::jsonb),
           'RISK_MANAGER', false, NULL, NULL
    FROM (SELECT 1) AS one
    LEFT JOIN configs c ON c.tenant_id = r.tenant_id;
  END LOOP;
END $$;
