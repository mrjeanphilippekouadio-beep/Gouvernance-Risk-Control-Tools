-- B-6b — branchement du Dispositif : instantané F-8 sur l'évaluation + paramètres q91 sur la version.
-- Spec : docs/architecture/RM-V1-B6-Dispositif-spec.md §2.2, §8.1, §12.2. Ne jamais appliquer à la main : passe par `npm run migrate`.
--
-- 1. risk_evaluations : risk_framework_version_id (FK, NULL = évaluation antérieure au Dispositif) et copie
--    des trois seuils Comité. Remplissage des lignes existantes depuis `configs` (à défaut : floor(P*I*15/25),
--    au moins 1, obligation true, seuil de traitement NULL). risk_framework_version_id reste NULL : aucune
--    version n'était active quand ces évaluations ont été créées (on n'affirme pas une méthodologie
--    qu'on ne peut pas prouver). Les colonnes restent nullables (une insertion hors service sans seuils ne casse rien).
-- 2. risk_framework_versions : huit paramètres q91 (contrat §10). Chaque valeur par défaut = le comportement
--    implicite antérieur / le défaut du contrat. low_criticality_threshold reste NULL sur les versions
--    existantes, y compris ACTIVE : B-5 doit traiter NULL de façon fermée (tout cumul RO + Exécuteur passe
--    alors par l'exception approuvée). ADD COLUMN ... DEFAULT ne déclenche pas le trigger de ligne.
-- 3. risk_framework_versions_guard() redéfinie (CREATE OR REPLACE) : la version de 056 (contrôle d'activation
--    compris) avec les huit colonnes ajoutées à same_content, sinon elles seraient modifiables sur une version ACTIVE.
--    SET search_path = pg_catalog, public, pg_temp REPRIS (F-B6a-11, 058).
--
-- Idempotente : IF NOT EXISTS, contraintes testées dans pg_constraint (noms explicites), CREATE OR REPLACE.

-- 1. risk_evaluations ------------------------------------------------------------------------------

ALTER TABLE risk_evaluations ADD COLUMN IF NOT EXISTS risk_framework_version_id uuid REFERENCES risk_framework_versions (id);
ALTER TABLE risk_evaluations ADD COLUMN IF NOT EXISTS committee_evaluation_min_score integer;
ALTER TABLE risk_evaluations ADD COLUMN IF NOT EXISTS committee_evaluation_enforced boolean;
ALTER TABLE risk_evaluations ADD COLUMN IF NOT EXISTS committee_treatment_min_score integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_evaluations_committee_eval_min_range_check' AND conrelid = 'risk_evaluations'::regclass) THEN
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_committee_eval_min_range_check
      CHECK (committee_evaluation_min_score IS NULL OR committee_evaluation_min_score BETWEEN 1 AND 36);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_evaluations_committee_treat_min_range_check' AND conrelid = 'risk_evaluations'::regclass) THEN
    ALTER TABLE risk_evaluations ADD CONSTRAINT risk_evaluations_committee_treat_min_range_check
      CHECK (committee_treatment_min_score IS NULL OR committee_treatment_min_score BETWEEN 1 AND 36);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS risk_evaluations_framework_version_idx
  ON risk_evaluations (risk_framework_version_id) WHERE risk_framework_version_id IS NOT NULL;

-- Remplissage (lignes dont l'instantané est vide uniquement).
UPDATE risk_evaluations e
SET committee_evaluation_min_score = COALESCE(
      (SELECT c.committee_evaluation_min_score FROM configs c WHERE c.tenant_id = e.tenant_id),
      GREATEST(1, floor(COALESCE((SELECT s.probability_levels * s.impact_levels FROM rating_scales s WHERE s.id = e.rating_scale_id), 25) * 15 / 25.0)::int)),
    committee_evaluation_enforced = COALESCE(
      (SELECT c.committee_evaluation_enforced FROM configs c WHERE c.tenant_id = e.tenant_id),
      true),
    committee_treatment_min_score = (SELECT c.committee_treatment_min_score FROM configs c WHERE c.tenant_id = e.tenant_id)
WHERE e.committee_evaluation_min_score IS NULL OR e.committee_evaluation_enforced IS NULL;

-- 2. risk_framework_versions : paramètres q91 ------------------------------------------------------

-- Seuil de criticité « faible » : pas de défaut au contrat -> NULL, obligatoire à la demande d'activation (service).
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS low_criticality_threshold integer;
-- true = autorisé jusqu'au seuil « faible », exception approuvée au-delà (défaut du contrat) ; false = cumul interdit.
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS risk_owner_executor_cumul_allowed boolean NOT NULL DEFAULT true;
-- « Le Délégué ne valide pas sa propre exécution » reste un invariant, jamais une colonne.
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS delegate_executor_cumul_allowed boolean NOT NULL DEFAULT true;
-- NULL = durée non fixée par le client (la date de fin d'une délégation reste exigée par B-5).
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS delegation_max_days integer;
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS hybrid_policy_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS mastery_authoritative_source text NOT NULL DEFAULT 'RISK_TEAM';
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS committee_vote_rule text NOT NULL DEFAULT 'DEFAULT';
ALTER TABLE risk_framework_versions ADD COLUMN IF NOT EXISTS committee_vote_custom jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_low_criticality_range_check' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_low_criticality_range_check
      CHECK (low_criticality_threshold IS NULL OR low_criticality_threshold BETWEEN 1 AND 36);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_delegation_days_check' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_delegation_days_check
      CHECK (delegation_max_days IS NULL OR delegation_max_days > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_mastery_source_check' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_mastery_source_check
      CHECK (mastery_authoritative_source IN ('RISK_TEAM', 'FIRST_LINE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_vote_rule_check' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_vote_rule_check
      CHECK (committee_vote_rule IN ('DEFAULT', 'A', 'B', 'C', 'CUSTOM'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_versions_vote_custom_check' AND conrelid = 'risk_framework_versions'::regclass) THEN
    ALTER TABLE risk_framework_versions ADD CONSTRAINT risk_framework_versions_vote_custom_check
      CHECK ((committee_vote_custom IS NULL OR jsonb_typeof(committee_vote_custom) = 'object')
             AND ((committee_vote_rule = 'CUSTOM') = (committee_vote_custom IS NOT NULL)));
  END IF;
END $$;

-- 3. Garde d'immuabilité (056 + les huit colonnes q91 + search_path) -------------------------------

CREATE OR REPLACE FUNCTION risk_framework_versions_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
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
                   NEW.self_proposal_allowed, NEW.created_by, NEW.last_edited_by, NEW.created_at,
                   NEW.low_criticality_threshold, NEW.risk_owner_executor_cumul_allowed,
                   NEW.delegate_executor_cumul_allowed, NEW.delegation_max_days, NEW.hybrid_policy_enabled,
                   NEW.mastery_authoritative_source, NEW.committee_vote_rule, NEW.committee_vote_custom)
                  IS NOT DISTINCT FROM
                  (OLD.id, OLD.tenant_id, OLD.framework_id, OLD.version_number, OLD.rating_scale_id,
                   OLD.default_evaluation_mode, OLD.committee_evaluation_min_score, OLD.committee_evaluation_enforced,
                   OLD.committee_treatment_min_score, OLD.appetite_thresholds, OLD.change_approver,
                   OLD.self_proposal_allowed, OLD.created_by, OLD.last_edited_by, OLD.created_at,
                   OLD.low_criticality_threshold, OLD.risk_owner_executor_cumul_allowed,
                   OLD.delegate_executor_cumul_allowed, OLD.delegation_max_days, OLD.hybrid_policy_enabled,
                   OLD.mastery_authoritative_source, OLD.committee_vote_rule, OLD.committee_vote_custom);

  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'PENDING_APPROVAL', 'ARCHIVED') THEN
      RAISE EXCEPTION 'risk_framework_versions: a draft cannot become %', NEW.status USING ERRCODE = '42501';
    END IF;
    IF NEW.activation_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation_request_id can only be set by an activation' USING ERRCODE = '42501';
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
    IF NEW.status = 'DRAFT' AND NEW.activation_request_id IS NOT NULL THEN
      RAISE EXCEPTION 'risk_framework_versions: activation_request_id can only be set by an activation' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'ACTIVE' THEN
      IF NEW.activated_at IS NULL THEN
        RAISE EXCEPTION 'risk_framework_versions: activation requires activated_at' USING ERRCODE = '42501';
      END IF;
      -- F-B6a-06 : demande d'activation de CETTE version, APPROVED par un tiers, hors BOOTSTRAP.
      IF NEW.activation_request_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM risk_framework_change_requests r
           WHERE r.id = NEW.activation_request_id
             AND r.tenant_id = NEW.tenant_id
             AND r.framework_id = NEW.framework_id
             AND r.version_id = NEW.id
             AND r.kind = 'ACTIVATE_VERSION'
             AND r.status = 'APPROVED'
             AND r.decided_by IS NOT NULL
             AND r.decided_by <> r.requested_by
             AND r.decision_regime IN ('NORMAL', 'FALLBACK')
         ) THEN
        RAISE EXCEPTION 'risk_framework_versions: activation requires an APPROVED ACTIVATE_VERSION request for this version, decided by a third party (not BOOTSTRAP)' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- ACTIVE : seule la transition vers ARCHIVED est permise (activation_request_id immuable) ; ARCHIVED : rien.
  IF OLD.status = 'ACTIVE' AND NEW.status = 'ARCHIVED' AND same_content
     AND NEW.activated_at IS NOT DISTINCT FROM OLD.activated_at
     AND NEW.activation_request_id IS NOT DISTINCT FROM OLD.activation_request_id
     AND NEW.archived_at IS NOT NULL AND NEW.archived_by IS NOT NULL AND NEW.archive_reason IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'risk_framework_versions: a % version is immutable', OLD.status USING ERRCODE = '42501';
END;
$$;
