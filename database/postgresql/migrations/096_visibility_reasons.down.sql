-- Rollback de 096_visibility_reasons.sql : restitue les textes des tables de droits (motifs déplacés par la migration), reprend les
-- gardes 087 (resource_access_grants) et 084 (sensitive_view_grants), puis supprime les références, la table et sa garde.
-- Refus (comme 095 pour ses marques) : si une ligne de audit_log porte un reason_ref, ou si un motif a été effacé, le rollback
-- perdrait la trace d'un motif (audit_log est append-only : on ne peut pas y remettre le texte).
-- Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f` (sans -1).
BEGIN;

DO $$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('public.visibility_reasons') IS NOT NULL THEN
    EXECUTE 'SELECT (SELECT count(*) FROM public.audit_log WHERE reason_ref IS NOT NULL) + (SELECT count(*) FROM public.visibility_reasons WHERE erased_at IS NOT NULL)' INTO n;
  END IF;
  IF n > 0 THEN
    RAISE EXCEPTION '096 down refused: audit_log rows reference a visibility reason, or a reason was erased (the text would be lost)' USING ERRCODE = '55000';
  END IF;
END $$;

ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard;
ALTER TABLE sensitive_view_grants DISABLE TRIGGER sensitive_view_grants_guard;

ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_reason_text_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_reason_text_check;
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_revocation_shape_check;
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_grant_reason_present_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_reject_reason_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_revoke_shape_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_reason_present_check;

-- Rejouable sur une base déjà redescendue (QA-L2A-03) : la restitution ne s'exécute que si la table existe encore (SQL dynamique).
DO $$
BEGIN
  IF to_regclass('public.visibility_reasons') IS NOT NULL THEN
    EXECUTE 'UPDATE public.resource_access_grants g SET grant_reason = r.text FROM public.visibility_reasons r WHERE g.grant_reason_ref = r.id AND g.tenant_id = r.tenant_id';
    EXECUTE 'UPDATE public.resource_access_grants g SET revoke_reason = r.text FROM public.visibility_reasons r WHERE g.revoke_reason_ref = r.id AND g.tenant_id = r.tenant_id';
    EXECUTE 'UPDATE public.sensitive_view_grants g SET reason = r.text FROM public.visibility_reasons r WHERE g.reason_ref = r.id AND g.tenant_id = r.tenant_id';
    EXECUTE 'UPDATE public.sensitive_view_grants g SET decision_reason = r.text FROM public.visibility_reasons r WHERE g.decision_reason_ref = r.id AND g.tenant_id = r.tenant_id';
    EXECUTE 'UPDATE public.sensitive_view_grants g SET revoke_reason = r.text FROM public.visibility_reasons r WHERE g.revoke_reason_ref = r.id AND g.tenant_id = r.tenant_id';
  END IF;
END $$;

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
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at > clock_timestamp() + interval '30 days' THEN
      RAISE EXCEPTION 'resource_access_grants: an access lasts 30 days at most' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'resource_access_grants: the content of an access is immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored' USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    -- Echéance posée ou renouvelée sur un accès vivant : jamais retirée, jamais au-delà de 30 jours.
    -- SEC-V5-03 : l'échéance d'un accès vivant ne peut que s'allonger (raccourcir = révoquer, avec auteur et motif).
    IF NEW.expires_at IS NULL OR NEW.expires_at > clock_timestamp() + interval '30 days'
       OR (OLD.expires_at IS NOT NULL AND NEW.expires_at < OLD.expires_at)
       OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'resource_access_grants: an access is revoked once, never restored; its expiry is only lengthened, never removed nor beyond 30 days' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- Révocation : l'échéance ne bouge pas.
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'resource_access_grants: a revocation does not change the expiry' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION resource_access_grants_guard() SET search_path = pg_catalog, public, pg_temp;

CREATE OR REPLACE FUNCTION sensitive_view_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sensitive_view_grants: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL
       OR NEW.access_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'sensitive_view_grants: a grant is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'sensitive_view_grants: the content of a grant is immutable' USING ERRCODE = '42501';
  END IF;
  -- q221 : l'échéance d'accès se pose à la confirmation seulement, puis ne bouge plus.
  IF NEW.access_expires_at IS DISTINCT FROM OLD.access_expires_at AND NOT (OLD.status = 'PENDING' AND NEW.status = 'APPROVED') THEN
    RAISE EXCEPTION 'sensitive_view_grants: the access expiry is set at the confirmation only' USING ERRCODE = '42501';
  END IF;
  -- PENDING -> APPROVED | REJECTED | REVOKED ; APPROVED -> REVOKED (the decision stays) ; nothing else.
  IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'REVOKED'))
          OR (OLD.status = 'APPROVED' AND NEW.status = 'REVOKED'
              AND NEW.decided_by IS NOT DISTINCT FROM OLD.decided_by AND NEW.decided_at IS NOT DISTINCT FROM OLD.decided_at
              AND NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason)) THEN
    RAISE EXCEPTION 'sensitive_view_grants: forbidden transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sensitive_view_grants_guard() SET search_path = pg_catalog, public, pg_temp;

ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard;
ALTER TABLE sensitive_view_grants ENABLE TRIGGER sensitive_view_grants_guard;

ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_grant_reason_ref_fk;
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_revoke_reason_ref_fk;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_reason_ref_fk;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_decision_reason_ref_fk;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_revoke_reason_ref_fk;
ALTER TABLE resource_access_grants DROP COLUMN IF EXISTS grant_reason_ref;
ALTER TABLE resource_access_grants DROP COLUMN IF EXISTS revoke_reason_ref;
ALTER TABLE sensitive_view_grants DROP COLUMN IF EXISTS reason_ref;
ALTER TABLE sensitive_view_grants DROP COLUMN IF EXISTS decision_reason_ref;
ALTER TABLE sensitive_view_grants DROP COLUMN IF EXISTS revoke_reason_ref;

ALTER TABLE resource_access_grants ALTER COLUMN grant_reason SET NOT NULL;
ALTER TABLE sensitive_view_grants ALTER COLUMN reason SET NOT NULL;
ALTER TABLE resource_access_grants ADD CONSTRAINT rag_revocation_shape_check
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL));
ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_reject_reason_check CHECK (status <> 'REJECTED' OR decision_reason IS NOT NULL);
ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_revoke_shape_check
  CHECK ((status = 'REVOKED') = (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL));

ALTER TABLE audit_log DROP COLUMN IF EXISTS reason_ref;
DROP TRIGGER IF EXISTS visibility_reasons_truncate_guard ON visibility_reasons;
DROP TRIGGER IF EXISTS visibility_reasons_guard ON visibility_reasons;
DROP TABLE IF EXISTS visibility_reasons;
DROP FUNCTION IF EXISTS visibility_reasons_truncate_guard();
DROP FUNCTION IF EXISTS visibility_reasons_guard();

DELETE FROM schema_migrations WHERE filename = '096_visibility_reasons.sql';
COMMIT;
