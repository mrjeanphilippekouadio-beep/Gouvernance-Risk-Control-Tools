-- B-6d (spec RM-V1-B6-Dispositif-spec.md §5.4.1, §5.6, §12.3) : amorçage du Dispositif avec un seul Risk Manager
-- (q77, q81, q83, q98, q101, q102) et repli q100 (version ACTIVE héritée dont l'approbateur est Audit/Comité).
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
--   1. tenants.risk_framework_bootstrap_ended_at : fin DÉFINITIVE de l'amorçage (q102), posée par trigger sous
--      verrou du tenant quand un circuit fonctionne (>= 2 membres actifs au groupe Risk Manager, au Comité ou à
--      Audit), remplie pour les tenants déjà dans ce cas, jamais remise à NULL (trigger BEFORE UPDATE, 42501).
--   2. risk_framework_change_requests : fallback_cause (q100) et bootstrap_justification (q83) + CHECK de forme.
--   3. CHECK no_bootstrap (056) remplacé par un CHECK qui BORNE BOOTSTRAP (NOT VALID, comme 056).
--   4. risk_framework_versions_guard() redéfinie : garde de 059 en entier + activation BOOTSTRAP du premier
--      Dispositif tant que la fin n'est pas posée. search_path REPRIS (F-B6a-11, CLAUDE.md).
--
-- Le trigger de fin suit les affectations (user_roles), les réactivations d'utilisateur (users), la réactivation d'un
-- rôle désactivé et le changement de roles.system_group (roles). La CAUSE de la fin (et l'id de la ligne déclencheuse)
-- est mémorisée avec la date : preuve = date + cause + réf. + ROLE_CHANGE correspondant (C-B6d-01).
-- Les valeurs par défaut du contrat (q98) et « RM unique » restent contrôlées dans le service, sous le même verrou.
-- Idempotente : IF NOT EXISTS, DO $$ sur pg_constraint, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.

-- 1. Fin mémorisée ----------------------------------------------------------------------------------

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS risk_framework_bootstrap_ended_at timestamptz NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS risk_framework_bootstrap_end_cause text NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS risk_framework_bootstrap_end_ref uuid NULL;
COMMENT ON COLUMN tenants.risk_framework_bootstrap_ended_at IS
  'fin définitive de l''amorçage du Dispositif, q102 ; posée par trigger, jamais remise à NULL';
COMMENT ON COLUMN tenants.risk_framework_bootstrap_end_cause IS
  'cause de la fin : SECOND_ELIGIBLE_MEMBER, USER_REACTIVATED, ROLE_REACTIVATED, ROLE_GROUP_CHANGED, PRE_EXISTING_AT_MIGRATION (date = celle de la migration, pas celle de la fin réelle)';
COMMENT ON COLUMN tenants.risk_framework_bootstrap_end_ref IS
  'id de la ligne déclencheuse (user_roles, users ou roles selon la cause) ; NULL pour PRE_EXISTING_AT_MIGRATION';

-- Fin, cause et référence sont immuables dès qu'ils sont posés (la cause peut être complétée une fois si elle manque).
CREATE OR REPLACE FUNCTION tenants_bootstrap_end_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.risk_framework_bootstrap_ended_at IS NOT NULL
     AND (NEW.risk_framework_bootstrap_ended_at IS DISTINCT FROM OLD.risk_framework_bootstrap_ended_at
          OR (OLD.risk_framework_bootstrap_end_cause IS NOT NULL
              AND (NEW.risk_framework_bootstrap_end_cause IS DISTINCT FROM OLD.risk_framework_bootstrap_end_cause
                   OR NEW.risk_framework_bootstrap_end_ref IS DISTINCT FROM OLD.risk_framework_bootstrap_end_ref))) THEN
    RAISE EXCEPTION 'tenants: the end of the Dispositif bootstrap is definitive and cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tenants_bootstrap_end_guard ON tenants;
CREATE TRIGGER tenants_bootstrap_end_guard
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_bootstrap_end_guard();

-- Utilisateurs DISTINCTS actifs par groupe fixe (affectation non révoquée, utilisateur non suspendu, rôle non
-- désactivé, même tenant partout) : même règle que isCircuitFunctional / readBootstrapFacts côté code.
CREATE OR REPLACE FUNCTION risk_framework_bootstrap_end_mark() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  t uuid := NEW.tenant_id;
  cause text;
  n_rm int;
  n_cm int;
  n_au int;
BEGIN
  -- (1) déjà terminé : rien à faire.
  IF EXISTS (SELECT 1 FROM tenants WHERE id = t AND risk_framework_bootstrap_ended_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  -- (2) l'événement ne concerne aucun groupe fixe ; la cause suit la table déclencheuse.
  IF TG_TABLE_NAME = 'user_roles' THEN
    cause := 'SECOND_ELIGIBLE_MEMBER';
    IF NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = NEW.role_id AND r.tenant_id = t AND r.deleted_at IS NULL
                   AND r.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT')) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'roles' THEN
    cause := CASE WHEN OLD.deleted_at IS NOT NULL THEN 'ROLE_REACTIVATED' ELSE 'ROLE_GROUP_CHANGED' END;
    IF NEW.deleted_at IS NOT NULL OR NEW.system_group IS NULL
       OR NEW.system_group NOT IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT') THEN
      RETURN NEW;
    END IF;
  ELSE
    cause := 'USER_REACTIVATED';
    IF NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
                   WHERE ur.tenant_id = t AND ur.user_id = NEW.id AND ur.revoked_at IS NULL AND r.deleted_at IS NULL
                   AND r.system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT')) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- (3) verrou du tenant : deux ajouts concurrents sont sérialisés, le second voit le premier (READ COMMITTED).
  -- NO KEY UPDATE (F-B6d-04) : exclusif entre eux, mais compatible avec le KEY SHARE des FK vers tenants
  -- (pas d'interblocage par montée de verrou, pas de blocage des insertions voisines).
  PERFORM 1 FROM tenants WHERE id = t FOR NO KEY UPDATE;
  -- (4) comptage.
  SELECT count(DISTINCT ur.user_id) FILTER (WHERE r.system_group = 'RISK_MANAGER'),
         count(DISTINCT ur.user_id) FILTER (WHERE r.system_group = 'RISK_COMMITTEE'),
         count(DISTINCT ur.user_id) FILTER (WHERE r.system_group = 'AUDIT')
    INTO n_rm, n_cm, n_au
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
  JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
  WHERE ur.tenant_id = t AND ur.revoked_at IS NULL AND r.system_group IS NOT NULL;
  -- (5) un circuit fonctionne (q101, MIN_VOTERS = 2 de q72) : date + cause + ligne déclencheuse (C-B6d-01).
  IF n_rm >= 2 OR n_cm >= 2 OR n_au >= 2 THEN
    UPDATE tenants SET risk_framework_bootstrap_ended_at = now(), risk_framework_bootstrap_end_cause = cause,
                       risk_framework_bootstrap_end_ref = NEW.id
    WHERE id = t AND risk_framework_bootstrap_ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_bootstrap_end_mark_insert ON user_roles;
CREATE TRIGGER user_roles_bootstrap_end_mark_insert
  AFTER INSERT ON user_roles
  FOR EACH ROW WHEN (NEW.revoked_at IS NULL)
  EXECUTE FUNCTION risk_framework_bootstrap_end_mark();

DROP TRIGGER IF EXISTS user_roles_bootstrap_end_mark_update ON user_roles;
CREATE TRIGGER user_roles_bootstrap_end_mark_update
  AFTER UPDATE OF revoked_at ON user_roles
  FOR EACH ROW WHEN (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL)
  EXECUTE FUNCTION risk_framework_bootstrap_end_mark();

DROP TRIGGER IF EXISTS users_bootstrap_end_mark ON users;
CREATE TRIGGER users_bootstrap_end_mark
  AFTER UPDATE OF deleted_at ON users
  FOR EACH ROW WHEN (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION risk_framework_bootstrap_end_mark();

-- Un rôle devient (ou redevient) un groupe fixe actif qui porte peut-être déjà des membres (QA-B6d-02, F-B6d-03).
DROP TRIGGER IF EXISTS roles_bootstrap_end_mark ON roles;
CREATE TRIGGER roles_bootstrap_end_mark
  AFTER UPDATE OF system_group, deleted_at ON roles
  FOR EACH ROW WHEN (NEW.deleted_at IS NULL AND NEW.system_group IS NOT NULL
                     AND (OLD.system_group IS DISTINCT FROM NEW.system_group OR OLD.deleted_at IS NOT NULL))
  EXECUTE FUNCTION risk_framework_bootstrap_end_mark();

-- Remplissage : tenants dont un circuit fonctionne déjà. L'historique des suspensions n'est pas reconstitué : la date
-- est celle de la REPRISE, ce que dit la cause PRE_EXISTING_AT_MIGRATION (pas de ligne déclencheuse).
UPDATE tenants t SET risk_framework_bootstrap_ended_at = now(), risk_framework_bootstrap_end_cause = 'PRE_EXISTING_AT_MIGRATION'
WHERE t.risk_framework_bootstrap_ended_at IS NULL
  AND EXISTS (
    SELECT 1 FROM (
      SELECT r.system_group, count(DISTINCT ur.user_id) AS n
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id AND r.deleted_at IS NULL
      JOIN users u ON u.id = ur.user_id AND u.tenant_id = ur.tenant_id AND u.deleted_at IS NULL
      WHERE ur.tenant_id = t.id AND ur.revoked_at IS NULL AND r.system_group IS NOT NULL
      GROUP BY r.system_group
    ) g WHERE g.n >= 2
  );
-- Rejeu sur une base où une version antérieure de 062 avait posé une fin sans cause.
UPDATE tenants SET risk_framework_bootstrap_end_cause = 'PRE_EXISTING_AT_MIGRATION'
WHERE risk_framework_bootstrap_ended_at IS NOT NULL AND risk_framework_bootstrap_end_cause IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_bootstrap_end_cause_check'
                 AND conrelid = 'tenants'::regclass) THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_bootstrap_end_cause_check
      CHECK ((risk_framework_bootstrap_ended_at IS NULL) = (risk_framework_bootstrap_end_cause IS NULL)
             AND (risk_framework_bootstrap_end_cause IS NULL OR risk_framework_bootstrap_end_cause IN
                  ('SECOND_ELIGIBLE_MEMBER', 'USER_REACTIVATED', 'ROLE_REACTIVATED', 'ROLE_GROUP_CHANGED', 'PRE_EXISTING_AT_MIGRATION')));
  END IF;
END $$;

-- 2. Colonnes des demandes et CHECK de forme ---------------------------------------------------------

ALTER TABLE risk_framework_change_requests ADD COLUMN IF NOT EXISTS fallback_cause text NULL;
ALTER TABLE risk_framework_change_requests ADD COLUMN IF NOT EXISTS bootstrap_justification jsonb NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_change_requests_fallback_cause_value_check'
                 AND conrelid = 'risk_framework_change_requests'::regclass) THEN
    ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_fallback_cause_value_check
      CHECK (fallback_cause IS NULL OR fallback_cause = 'LEGACY_APPROVER_PRE_B12');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_change_requests_fallback_cause_shape_check'
                 AND conrelid = 'risk_framework_change_requests'::regclass) THEN
    ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_fallback_cause_shape_check
      CHECK (fallback_cause IS NULL OR (decision_regime = 'FALLBACK' AND ratification_status = 'PENDING'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_change_requests_bootstrap_just_type_check'
                 AND conrelid = 'risk_framework_change_requests'::regclass) THEN
    ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_bootstrap_just_type_check
      CHECK (bootstrap_justification IS NULL OR jsonb_typeof(bootstrap_justification) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_change_requests_bootstrap_just_regime_check'
                 AND conrelid = 'risk_framework_change_requests'::regclass) THEN
    ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_bootstrap_just_regime_check
      CHECK ((decision_regime IS NOT DISTINCT FROM 'BOOTSTRAP') = (bootstrap_justification IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- 3. BOOTSTRAP : de « interdit » (056) à « borné » ---------------------------------------------------

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_no_bootstrap_check;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'risk_framework_change_requests_bootstrap_shape_check'
                 AND conrelid = 'risk_framework_change_requests'::regclass) THEN
    ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_bootstrap_shape_check
      CHECK (decision_regime IS DISTINCT FROM 'BOOTSTRAP' OR (
        kind = 'ACTIVATE_VERSION' AND status = 'APPROVED' AND decided_by = requested_by
        AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
        AND decision_comment IS NOT NULL AND bootstrap_justification IS NOT NULL
      )) NOT VALID;
  END IF;
END $$;

-- 4. Garde d'immuabilité des versions (059 + activation BOOTSTRAP) -------------------------------------

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
             AND (
               (r.decided_by <> r.requested_by AND r.decision_regime IN ('NORMAL', 'FALLBACK'))
               -- B-6d (q77, q81, q102) : l'amorçage, seulement pour le premier Dispositif du tenant, tant que la fin
               -- n'est pas mémorisée. Les autres conditions (RM unique, valeurs du contrat) sont dans le service, sous verrou.
               OR (r.decided_by = r.requested_by AND r.decision_regime = 'BOOTSTRAP'
                   AND NOT EXISTS (SELECT 1 FROM risk_framework_versions o
                                   WHERE o.tenant_id = NEW.tenant_id AND o.id <> NEW.id AND o.activated_at IS NOT NULL)
                   AND EXISTS (SELECT 1 FROM tenants t
                               WHERE t.id = NEW.tenant_id AND t.risk_framework_bootstrap_ended_at IS NULL))
             )
         ) THEN
        RAISE EXCEPTION 'risk_framework_versions: activation requires an APPROVED ACTIVATE_VERSION request for this version, decided by a third party, or by BOOTSTRAP for the first activation of the tenant while the bootstrap is open' USING ERRCODE = '42501';
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
