-- 097 — Conservation L2b (q248 B, q249 A, DECISION-120, cadrage 8.4, SEC-L2A-03, PRIV-L2A-02 / C2) : fin d'effet, durée et
-- effacement des motifs de visibilité.
-- 1. configs.visibility_reason_retention_days : durée de conservation d'un motif APRÈS la fin de son effet. 365 par défaut,
--    365 au moins, NULL = jamais effacé. Toute modification (hausse comme baisse) passe par la seconde personne (circuit 076,
--    q249 A) : c'est le service qui l'impose, comme pour les autres délais de gouvernance.
-- 2. Rattrapage (décidé ici, au plus simple) : les motifs liés à des accords DÉJÀ terminés avant 097 (096 laissait NULL) reçoivent
--    `effect_ended_at` = la date de la révocation ou du refus connue. Un accord de lecture élargie dont l'échéance est passée
--    mais jamais refermée n'est pas touché (il garde NULL : jamais effacé tant que rien ne l'a refermé). Le rattrapage tourne
--    AVANT la nouvelle garde (même transaction) : la garde 096 accepte de poser une date de fin sur un motif non effacé.
-- 3. Garde de visibility_reasons reprise EN ENTIER (SEC-L2A-03, PRIV-L2A-02) : à l'INSERT, `created_at` est fixé par la base et
--    `effect_ended_at`, `reviewed_at`, `erased_at` doivent être NULL ; à l'UPDATE, le texte ne s'efface que si la fin d'effet
--    est déjà posée ET si `effect_ended_at` + durée du client est passée (durée NULL = jamais ; client sans ligne de réglage =
--    365, le plancher) ; une date de fin ne précède jamais la création du motif ; toute date posée ou avancée est <= clock_timestamp().
-- 4. Permission `retention.purge` (action terminale, jamais `user.update` ni `config.update`) : rattrapée sur les rôles et
--    comptes qui portent déjà une permission d'administrateur (même critère que 075), car c'est eux qui lançaient la purge 085
--    sous `user.update`. Aucune autre attribution. Elle n'entre PAS dans ADMIN_PERMISSIONS (la détenir ne rend pas administrateur).
-- `search_path` pinné (`pg_temp` en dernier, F-B6a-11) et répété par ALTER FUNCTION. Pas de DELETE. Rejouable.

ALTER TABLE configs ADD COLUMN IF NOT EXISTS visibility_reason_retention_days integer DEFAULT 365
  CHECK (visibility_reason_retention_days BETWEEN 365 AND 3650);

-- Rattrapage 1/2 : accords nominatifs (080/087). Un motif ne se termine que si TOUS les accords qui le citent sont révoqués.
UPDATE visibility_reasons vr SET effect_ended_at = GREATEST(e.ended, vr.created_at)
FROM (
  SELECT r.id, r.tenant_id, max(g.revoked_at) AS ended
  FROM visibility_reasons r
  JOIN resource_access_grants g ON g.tenant_id = r.tenant_id AND (g.grant_reason_ref = r.id OR g.revoke_reason_ref = r.id)
  WHERE r.effect_ended_at IS NULL
  GROUP BY r.id, r.tenant_id
  HAVING bool_and(g.revoked_at IS NOT NULL)
) e
WHERE vr.id = e.id AND vr.tenant_id = e.tenant_id;

-- Rattrapage 2/2 : demandes de lecture élargie refusées ou révoquées (079/084).
UPDATE visibility_reasons vr SET effect_ended_at = GREATEST(e.ended, vr.created_at)
FROM (
  SELECT r.id, r.tenant_id, max(COALESCE(g.revoked_at, g.decided_at)) AS ended
  FROM visibility_reasons r
  JOIN sensitive_view_grants g ON g.tenant_id = r.tenant_id AND r.id IN (g.reason_ref, g.decision_reason_ref, g.revoke_reason_ref)
  WHERE r.effect_ended_at IS NULL AND g.status IN ('REJECTED', 'REVOKED')
  GROUP BY r.id, r.tenant_id
) e
WHERE vr.id = e.id AND vr.tenant_id = e.tenant_id;

CREATE OR REPLACE FUNCTION visibility_reasons_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_days integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'visibility_reasons: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.text IS NULL OR NEW.erased_at IS NOT NULL OR NEW.effect_ended_at IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'visibility_reasons: a reason is inserted with its text, active, never erased nor reviewed' USING ERRCODE = '42501';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'visibility_reasons: the identity of a reason is immutable' USING ERRCODE = '42501';
  END IF;
  -- Le texte s'efface une fois (le CHECK d'effacement impose que erased_at suive) et ne revient jamais.
  IF (NEW.text IS DISTINCT FROM OLD.text AND (OLD.text IS NULL OR NEW.text IS NOT NULL))
     OR (NEW.erased_at IS DISTINCT FROM OLD.erased_at AND OLD.erased_at IS NOT NULL) THEN
    RAISE EXCEPTION 'visibility_reasons: the text is erased once, never restored' USING ERRCODE = '42501';
  END IF;
  -- Fin d'effet et revue : posées ou avancées, jamais reculées ni remises à NULL.
  IF (OLD.effect_ended_at IS NOT NULL AND (NEW.effect_ended_at IS NULL OR NEW.effect_ended_at < OLD.effect_ended_at))
     OR (OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at IS NULL OR NEW.reviewed_at < OLD.reviewed_at)) THEN
    RAISE EXCEPTION 'visibility_reasons: effect_ended_at and reviewed_at are only set or advanced' USING ERRCODE = '42501';
  END IF;
  -- SEC-L2A-03 : aucune date posée dans le futur, et une fin d'effet ne précède pas la création du motif.
  IF (NEW.effect_ended_at IS DISTINCT FROM OLD.effect_ended_at AND (NEW.effect_ended_at > clock_timestamp() OR NEW.effect_ended_at < OLD.created_at))
     OR (NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at AND NEW.reviewed_at > clock_timestamp())
     OR (NEW.erased_at IS DISTINCT FROM OLD.erased_at AND NEW.erased_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'visibility_reasons: a date is never in the future, and the end of effect never precedes the reason' USING ERRCODE = '42501';
  END IF;
  -- PRIV-L2A-02 : effacement fail-closed. Fin d'effet déjà posée (par un ordre antérieur), durée du client écoulée depuis elle.
  IF NEW.text IS NULL AND OLD.text IS NOT NULL THEN
    SELECT c.visibility_reason_retention_days INTO v_days FROM public.configs c WHERE c.tenant_id = OLD.tenant_id;
    IF NOT FOUND THEN
      v_days := 365;
    END IF;
    IF OLD.effect_ended_at IS NULL OR v_days IS NULL
       OR OLD.effect_ended_at + make_interval(days => v_days) > clock_timestamp() THEN
      RAISE EXCEPTION 'visibility_reasons: a reason is erased only once its effect has ended and the retention period has elapsed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION visibility_reasons_guard() SET search_path = pg_catalog, public, pg_temp;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['retention.purge']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage', 'config.governancedelays.set'
  ]::text[];

UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['retention.purge']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage', 'config.governancedelays.set'
  ]::text[];
