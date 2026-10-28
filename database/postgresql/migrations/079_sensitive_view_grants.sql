-- DECISION-101 / DECISION-103 (q188, q189, q200) : voir, dans la matrice des droits, les rôles et comptes de l'Audit et
-- des administrateurs s'active INDIVIDUELLEMENT pour un membre du groupe Risk Manager (droit `role.read.sensitive`),
-- jamais par un rôle. Une ligne = une attribution, demandée par un administrateur (motif), confirmée ou refusée par un
-- membre du Comité ou de l'Audit (rolegroup.audit.validate), jamais par l'auteur ni par le bénéficiaire.
--      status  PENDING   en attente de confirmation (au plus une demande vivante par compte)
--              APPROVED  confirmée : le droit est effectif (lu ici, jamais copié dans roles.permissions)
--              REJECTED  refusée (motif obligatoire)
--              REVOKED   retirée par un administrateur (motif obligatoire), depuis PENDING ou APPROVED
--    expires_at : fixé à la demande depuis policy_request_expiry_days (q174), jamais recalculé ; une demande expirée
--    ne peut plus être confirmée.
-- Mêmes garanties que 076 : maker-checker en CHECK, aucune suppression (REVOKE + trigger), contenu immuable,
-- transitions bornées, garde TRUNCATE, `search_path = pg_catalog, public, pg_temp` sur chaque définition.
-- Idempotente : IF NOT EXISTS / OR REPLACE. Ne jamais appliquer à la main : passe par `npm run migrate`.

CREATE TABLE IF NOT EXISTS sensitive_view_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants (id),
  user_id          uuid NOT NULL,
  reason           text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED')),
  requested_by     uuid NOT NULL,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NULL,
  decided_by       uuid NULL,
  decided_at       timestamptz NULL,
  decision_reason  text NULL CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 1 AND 500),
  revoked_by       uuid NULL,
  revoked_at       timestamptz NULL,
  revoke_reason    text NULL CHECK (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 1 AND 500),
  CONSTRAINT svg_user_tenant_fk FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  CONSTRAINT svg_requested_by_tenant_fk FOREIGN KEY (tenant_id, requested_by) REFERENCES users (tenant_id, id),
  CONSTRAINT svg_decided_by_tenant_fk FOREIGN KEY (tenant_id, decided_by) REFERENCES users (tenant_id, id),
  CONSTRAINT svg_revoked_by_tenant_fk FOREIGN KEY (tenant_id, revoked_by) REFERENCES users (tenant_id, id),
  CONSTRAINT svg_not_for_self_check CHECK (requested_by <> user_id),
  CONSTRAINT svg_maker_checker_check CHECK (decided_by IS NULL OR (decided_by <> requested_by AND decided_by <> user_id)),
  -- A revoked grant keeps its decision when it had one (APPROVED -> REVOKED) or has none (PENDING -> REVOKED).
  CONSTRAINT svg_decision_shape_check CHECK (status = 'REVOKED' OR (status IN ('APPROVED', 'REJECTED')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT svg_reject_reason_check CHECK (status <> 'REJECTED' OR decision_reason IS NOT NULL),
  CONSTRAINT svg_revoke_shape_check CHECK ((status = 'REVOKED') = (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS svg_live_idx ON sensitive_view_grants (tenant_id, user_id) WHERE status IN ('PENDING', 'APPROVED');
CREATE INDEX IF NOT EXISTS svg_tenant_idx ON sensitive_view_grants (tenant_id, requested_at DESC);

CREATE OR REPLACE FUNCTION sensitive_view_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sensitive_view_grants: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL THEN
      RAISE EXCEPTION 'sensitive_view_grants: a grant is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'sensitive_view_grants: the content of a grant is immutable' USING ERRCODE = '42501';
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

DROP TRIGGER IF EXISTS sensitive_view_grants_guard ON sensitive_view_grants;
CREATE TRIGGER sensitive_view_grants_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sensitive_view_grants
  FOR EACH ROW EXECUTE FUNCTION sensitive_view_grants_guard();

CREATE OR REPLACE FUNCTION sensitive_view_grants_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'sensitive_view_grants cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION sensitive_view_grants_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS sensitive_view_grants_truncate_guard ON sensitive_view_grants;
CREATE TRIGGER sensitive_view_grants_truncate_guard
  BEFORE TRUNCATE ON sensitive_view_grants
  FOR EACH STATEMENT EXECUTE FUNCTION sensitive_view_grants_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON sensitive_view_grants TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON sensitive_view_grants FROM grc_app_runtime;
