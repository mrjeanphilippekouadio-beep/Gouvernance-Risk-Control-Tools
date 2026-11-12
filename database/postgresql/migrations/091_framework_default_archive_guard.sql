-- B-13 (DECISION-124, DECISION-127) — gardes en base du Dispositif par défaut et de l'archivage d'un Dispositif ; ferme R-02 (SEC-b6c).
-- Ne jamais appliquer à la main : passe par `npm run migrate`.
--
-- Objet
--   (a) risk_frameworks : un nouveau Dispositif naît non par défaut et non archivé. `is_default` ne passe à true que dans
--       la transaction qui approuve (decided_at = now()) soit une demande SET_DEFAULT pour ce Dispositif, soit une demande
--       ACTIVATE_VERSION pour ce Dispositif (premier Dispositif activé du tenant, spec §4 étape 5). `is_default` ne passe à
--       false que dans la transaction qui approuve une demande SET_DEFAULT du tenant (le défaut est alors remplacé) ou
--       qui archive (jamais : voir ci-dessous). Un Dispositif archivé est figé (pas de désarchivage, pas de défaut).
--   (b) Archivage d'un Dispositif (archived_at NULL -> non NULL) : jamais le défaut, archived_by et archive_reason
--       renseignés (motif non vide), aucun processus vivant (deleted_at IS NULL) qui lui est rattaché. Le tenant d'un
--       Dispositif ne change pas.
--   (c) risk_framework_change_requests : une demande SET_DEFAULT naît avec un Dispositif du tenant de la demande
--       (suite de 088, qui ne couvrait que ASSIGN_PROCESS).
--   (d) R-02 (SEC-b6c) : processes.risk_framework_id ne repasse à NULL que si le processus est supprimé (soft delete,
--       deleted_at renseigné dans la même écriture). Une remise à NULL « à la main » changerait la méthode applicable
--       sans approbation ; le détachement n'est pas une action (l'archivage d'un Dispositif refuse un rattachement vivant).
--
-- Compatibilité (vérifiée contre PostgresRiskFrameworkRepository) : activate() passe la demande à APPROVED
-- (decided_at = now()) AVANT de poser is_default ; decideDefault fait de même et retire l'ancien défaut d'abord ;
-- archiveFramework archive les versions, puis le Dispositif, sans toucher aux processus ; le brouillon de reprise de 055
-- et createWithDraft insèrent is_default = false. Les lignes existantes ne sont pas revalidées (triggers sur écritures).
-- Toute fonction fixe son search_path, pg_temp en dernier (F-B6a-11, 058). Idempotente : CREATE OR REPLACE FUNCTION,
-- DROP TRIGGER IF EXISTS puis CREATE TRIGGER.

CREATE OR REPLACE FUNCTION risk_frameworks_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_default OR NEW.archived_at IS NOT NULL OR NEW.archived_by IS NOT NULL OR NEW.archive_reason IS NOT NULL THEN
      RAISE EXCEPTION 'risk_frameworks: a Dispositif is created neither default nor archived' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'risk_frameworks: a Dispositif cannot change tenant' USING ERRCODE = '42501';
  END IF;

  IF OLD.archived_at IS NOT NULL THEN
    IF NEW.is_default OR (NEW.archived_at, NEW.archived_by, NEW.archive_reason)
         IS DISTINCT FROM (OLD.archived_at, OLD.archived_by, OLD.archive_reason) THEN
      RAISE EXCEPTION 'risk_frameworks: an archived Dispositif is frozen' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.archived_at IS NOT NULL THEN
    IF NEW.is_default OR OLD.is_default THEN
      RAISE EXCEPTION 'risk_frameworks: the default Dispositif cannot be archived' USING ERRCODE = '42501';
    END IF;
    IF NEW.archived_by IS NULL OR NEW.archive_reason IS NULL OR length(btrim(NEW.archive_reason)) = 0 THEN
      RAISE EXCEPTION 'risk_frameworks: archiving requires archived_by and a reason' USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM processes p WHERE p.tenant_id = NEW.tenant_id AND p.risk_framework_id = NEW.id AND p.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'risk_frameworks: a Dispositif with attached processes cannot be archived' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.archived_by IS NOT NULL OR NEW.archive_reason IS NOT NULL THEN
    RAISE EXCEPTION 'risk_frameworks: archive fields require archived_at' USING ERRCODE = '42501';
  END IF;

  IF NEW.is_default AND NOT OLD.is_default THEN
    IF NOT EXISTS (
      SELECT 1 FROM risk_framework_change_requests r
      WHERE r.tenant_id = NEW.tenant_id AND r.framework_id = NEW.id AND r.status = 'APPROVED' AND r.decided_at = now()
        AND r.kind IN ('SET_DEFAULT', 'ACTIVATE_VERSION')
    ) THEN
      RAISE EXCEPTION 'risk_frameworks: is_default requires a SET_DEFAULT or ACTIVATE_VERSION request approved in this transaction' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.is_default AND NOT NEW.is_default THEN
    IF NOT EXISTS (
      SELECT 1 FROM risk_framework_change_requests r
      WHERE r.tenant_id = NEW.tenant_id AND r.framework_id <> NEW.id AND r.status = 'APPROVED' AND r.decided_at = now()
        AND r.kind = 'SET_DEFAULT'
    ) THEN
      RAISE EXCEPTION 'risk_frameworks: the default is only replaced by an approved SET_DEFAULT request in this transaction' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS risk_frameworks_guard ON risk_frameworks;
CREATE TRIGGER risk_frameworks_guard
  BEFORE INSERT OR UPDATE OF tenant_id, is_default, archived_at, archived_by, archive_reason ON risk_frameworks
  FOR EACH ROW EXECUTE FUNCTION risk_frameworks_guard();

-- (c) 088 + SET_DEFAULT.
CREATE OR REPLACE FUNCTION risk_framework_assign_tenant_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW.kind = 'ASSIGN_PROCESS' THEN
    IF NOT EXISTS (SELECT 1 FROM processes p WHERE p.id = NEW.process_id AND p.tenant_id = NEW.tenant_id)
       OR NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.id = NEW.framework_id AND f.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'risk_framework_change_requests: the process and the Dispositif of an assignment must belong to the tenant of the request' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.kind = 'SET_DEFAULT' THEN
    IF NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.id = NEW.framework_id AND f.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'risk_framework_change_requests: the Dispositif of a default change must belong to the tenant of the request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- (d) 088 + R-02 : NOT NULL -> NULL seulement pour un processus supprimé (soft delete).
CREATE OR REPLACE FUNCTION processes_framework_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.risk_framework_id IS NOT NULL THEN
      RAISE EXCEPTION 'processes: risk_framework_id cannot be set at insert; it is written by an approved ASSIGN_PROCESS request' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- R-03 (retest A10): a process carrying a Dispositif cannot change tenant (it would keep another tenant's Dispositif).
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id AND NEW.risk_framework_id IS NOT NULL THEN
    RAISE EXCEPTION 'processes: a process attached to a Dispositif cannot change tenant' USING ERRCODE = '42501';
  END IF;
  -- R-02 (SEC-b6c): detaching changes the applicable method without approval; only a deleted process may lose its Dispositif.
  IF OLD.risk_framework_id IS NOT NULL AND NEW.risk_framework_id IS NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'processes: risk_framework_id cannot be cleared on a live process' USING ERRCODE = '42501';
  END IF;
  IF NEW.risk_framework_id IS NOT DISTINCT FROM OLD.risk_framework_id OR NEW.risk_framework_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM risk_frameworks f WHERE f.id = NEW.risk_framework_id AND f.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'processes: the Dispositif must belong to the tenant of the process' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM risk_framework_change_requests r
    WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'ASSIGN_PROCESS' AND r.status = 'APPROVED'
      AND r.process_id = NEW.id AND r.framework_id = NEW.risk_framework_id AND r.decided_at = now()
  ) THEN
    RAISE EXCEPTION 'processes: risk_framework_id requires an ASSIGN_PROCESS request approved in this transaction' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
