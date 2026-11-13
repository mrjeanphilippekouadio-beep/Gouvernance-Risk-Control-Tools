-- 096 — Conservation L2a (q246 A, q247 A, DECISION-120, cadrage 8.4) : le texte d'un motif de visibilité vit dans un espace
-- séparé, référencé par le journal et par les tables de droits. Rien ne s'efface encore (L2b), rien n'est daté de fin d'effet
-- (L2b), aucune revue ne tourne (L2c) : les colonnes existent, seul `created_at` se remplit.
-- 1. visibility_reasons : une ligne = un motif. Garde : INSERT avec son texte ; le texte s'efface UNE fois (text -> NULL avec
--    erased_at posé, jamais l'inverse) ; effect_ended_at et reviewed_at se posent ou avancent, ne reculent jamais et ne
--    reviennent jamais à NULL ; aucun DELETE ni TRUNCATE ; identité, client, origine et date de saisie immuables.
-- 2. audit_log.reason_ref : ADD COLUMN nullable, sans réécriture. Comme 066, aucune ligne n'est modifiée et la garde append-only
--    038 reste intacte (elle refuse déjà tout UPDATE, DELETE et TRUNCATE).
-- 3. resource_access_grants (080/087) : grant_reason_ref, revoke_reason_ref ; grant_reason devient nullable (il ne garde que la
--    constante technique du risque à sa création, clé de listCreationAccess). La garde est reprise EN ENTIER, avec les deux
--    références dans le contenu immuable. Les CHECK de forme sont remplacés sous le même nom.
-- 4. sensitive_view_grants (079/084) : reason_ref, decision_reason_ref, revoke_reason_ref ; reason devient nullable. Même reprise
--    complète de la garde 084 et des CHECK.
-- 5. Les textes déjà présents dans les tables de droits (staging = données de test, q271 A) passent dans visibility_reasons ;
--    ceux de audit_log.reason ne sont pas touchés (append-only, H3). Le déplacement coupe la garde de contenu le temps de
--    l'UPDATE (même transaction, réactivée ensuite).
-- `search_path` pinné (`pg_temp` en dernier, F-B6a-11) et répété par ALTER FUNCTION sur chaque définition. Pas de DELETE.

CREATE TABLE IF NOT EXISTS visibility_reasons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  source          text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 60),
  text            text NULL CHECK (text IS NULL OR char_length(btrim(text, E' \t\n\r\f\013')) BETWEEN 1 AND 500),
  created_at      timestamptz NOT NULL DEFAULT now(),
  effect_ended_at timestamptz NULL,
  erased_at       timestamptz NULL,
  reviewed_at     timestamptz NULL,
  CONSTRAINT visibility_reasons_tenant_id_uq UNIQUE (tenant_id, id),
  -- Un texte absent est un texte effacé, et réciproquement.
  CONSTRAINT visibility_reasons_erasure_check CHECK ((text IS NULL) = (erased_at IS NOT NULL))
);

CREATE OR REPLACE FUNCTION visibility_reasons_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'visibility_reasons: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.text IS NULL OR NEW.erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'visibility_reasons: a reason is inserted with its text, not erased' USING ERRCODE = '42501';
    END IF;
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
  RETURN NEW;
END;
$$;
ALTER FUNCTION visibility_reasons_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS visibility_reasons_guard ON visibility_reasons;
CREATE TRIGGER visibility_reasons_guard
  BEFORE INSERT OR UPDATE OR DELETE ON visibility_reasons
  FOR EACH ROW EXECUTE FUNCTION visibility_reasons_guard();

CREATE OR REPLACE FUNCTION visibility_reasons_truncate_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'visibility_reasons cannot be truncated' USING ERRCODE = '42501';
END;
$$;
ALTER FUNCTION visibility_reasons_truncate_guard() SET search_path = pg_catalog, public, pg_temp;

DROP TRIGGER IF EXISTS visibility_reasons_truncate_guard ON visibility_reasons;
CREATE TRIGGER visibility_reasons_truncate_guard
  BEFORE TRUNCATE ON visibility_reasons
  FOR EACH STATEMENT EXECUTE FUNCTION visibility_reasons_truncate_guard();

GRANT SELECT, INSERT, UPDATE ON visibility_reasons TO grc_app_runtime;
REVOKE DELETE, TRUNCATE ON visibility_reasons FROM grc_app_runtime;

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS reason_ref uuid NULL REFERENCES visibility_reasons (id);

ALTER TABLE resource_access_grants ADD COLUMN IF NOT EXISTS grant_reason_ref uuid NULL;
ALTER TABLE resource_access_grants ADD COLUMN IF NOT EXISTS revoke_reason_ref uuid NULL;
ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS reason_ref uuid NULL;
ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS decision_reason_ref uuid NULL;
ALTER TABLE sensitive_view_grants ADD COLUMN IF NOT EXISTS revoke_reason_ref uuid NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_grant_reason_ref_fk') THEN
    ALTER TABLE resource_access_grants ADD CONSTRAINT rag_grant_reason_ref_fk
      FOREIGN KEY (tenant_id, grant_reason_ref) REFERENCES visibility_reasons (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_revoke_reason_ref_fk') THEN
    ALTER TABLE resource_access_grants ADD CONSTRAINT rag_revoke_reason_ref_fk
      FOREIGN KEY (tenant_id, revoke_reason_ref) REFERENCES visibility_reasons (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_reason_ref_fk') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_reason_ref_fk
      FOREIGN KEY (tenant_id, reason_ref) REFERENCES visibility_reasons (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_decision_reason_ref_fk') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_decision_reason_ref_fk
      FOREIGN KEY (tenant_id, decision_reason_ref) REFERENCES visibility_reasons (tenant_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_revoke_reason_ref_fk') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_revoke_reason_ref_fk
      FOREIGN KEY (tenant_id, revoke_reason_ref) REFERENCES visibility_reasons (tenant_id, id);
  END IF;
END $$;

ALTER TABLE resource_access_grants ALTER COLUMN grant_reason DROP NOT NULL;
ALTER TABLE sensitive_view_grants ALTER COLUMN reason DROP NOT NULL;

-- Les CHECK de forme comptaient le texte : ils comptent désormais le texte OU sa référence (même nom, aucun affaiblissement).
ALTER TABLE resource_access_grants DROP CONSTRAINT IF EXISTS rag_revocation_shape_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_reject_reason_check;
ALTER TABLE sensitive_view_grants DROP CONSTRAINT IF EXISTS svg_revoke_shape_check;

-- Déplacement des textes existants. Un motif commun à plusieurs lignes d'un même accord (même auteur, même instant) reste un seul motif.
ALTER TABLE resource_access_grants DISABLE TRIGGER resource_access_grants_guard;
ALTER TABLE sensitive_view_grants DISABLE TRIGGER sensitive_view_grants_guard;

DO $$
DECLARE
  g record;
  v_id uuid;
BEGIN
  FOR g IN SELECT DISTINCT tenant_id, granted_by, granted_at, grant_reason FROM resource_access_grants
           WHERE grant_reason IS NOT NULL AND grant_reason_ref IS NULL AND grant_reason <> 'Accès accordé à la création du risque' LOOP
    INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES (g.tenant_id, 'VISIBILITY_CHANGE', g.grant_reason, g.granted_at)
      RETURNING id INTO v_id;
    UPDATE resource_access_grants SET grant_reason_ref = v_id, grant_reason = NULL
      WHERE tenant_id = g.tenant_id AND granted_by = g.granted_by AND granted_at = g.granted_at AND grant_reason = g.grant_reason;
  END LOOP;
  FOR g IN SELECT DISTINCT tenant_id, revoked_by, revoked_at, revoke_reason FROM resource_access_grants
           WHERE revoke_reason IS NOT NULL AND revoke_reason_ref IS NULL LOOP
    INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES (g.tenant_id, 'VISIBILITY_CHANGE', g.revoke_reason, g.revoked_at)
      RETURNING id INTO v_id;
    UPDATE resource_access_grants SET revoke_reason_ref = v_id, revoke_reason = NULL
      WHERE tenant_id = g.tenant_id AND revoked_by = g.revoked_by AND revoked_at = g.revoked_at AND revoke_reason = g.revoke_reason;
  END LOOP;

  FOR g IN SELECT id, tenant_id, reason, requested_at, decision_reason, decided_at, revoke_reason, revoked_at FROM sensitive_view_grants LOOP
    IF g.reason IS NOT NULL THEN
      INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES (g.tenant_id, 'SENSITIVE_VIEW_REQUEST', CASE WHEN btrim(g.reason, E' \t\n\r\f\013') = '' THEN '(motif sans texte)' ELSE g.reason END, g.requested_at)
        RETURNING id INTO v_id;
      UPDATE sensitive_view_grants SET reason_ref = v_id, reason = NULL WHERE id = g.id;
    END IF;
    IF g.decision_reason IS NOT NULL THEN
      INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES (g.tenant_id, 'SENSITIVE_VIEW_DECISION', CASE WHEN btrim(g.decision_reason, E' \t\n\r\f\013') = '' THEN '(motif sans texte)' ELSE g.decision_reason END, g.decided_at)
        RETURNING id INTO v_id;
      UPDATE sensitive_view_grants SET decision_reason_ref = v_id, decision_reason = NULL WHERE id = g.id;
    END IF;
    IF g.revoke_reason IS NOT NULL THEN
      INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES (g.tenant_id, 'SENSITIVE_VIEW_REVOCATION', CASE WHEN btrim(g.revoke_reason, E' \t\n\r\f\013') = '' THEN '(motif sans texte)' ELSE g.revoke_reason END, g.revoked_at)
        RETURNING id INTO v_id;
      UPDATE sensitive_view_grants SET revoke_reason_ref = v_id, revoke_reason = NULL WHERE id = g.id;
    END IF;
  END LOOP;
END $$;

ALTER TABLE resource_access_grants ENABLE TRIGGER resource_access_grants_guard;
ALTER TABLE sensitive_view_grants ENABLE TRIGGER sensitive_view_grants_guard;

ALTER TABLE resource_access_grants ADD CONSTRAINT rag_revocation_shape_check
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL) AND (revoked_at IS NULL) = (revoke_reason IS NULL AND revoke_reason_ref IS NULL));
ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_reject_reason_check
  CHECK (status <> 'REJECTED' OR decision_reason IS NOT NULL OR decision_reason_ref IS NOT NULL);
ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_revoke_shape_check
  CHECK ((status = 'REVOKED') = (revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND (revoke_reason IS NOT NULL OR revoke_reason_ref IS NOT NULL)));

-- Un accord garde toujours son motif : son texte (constante technique du risque) ou sa référence.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_grant_reason_present_check') THEN
    ALTER TABLE resource_access_grants ADD CONSTRAINT rag_grant_reason_present_check CHECK (grant_reason IS NOT NULL OR grant_reason_ref IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_reason_present_check') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_reason_present_check CHECK (reason IS NOT NULL OR reason_ref IS NOT NULL);
  END IF;
END $$;

-- SEC-L2A-02 : les anciennes colonnes de texte sont vidées par la migration ; la base refuse désormais d'y réécrire un motif.
-- Seule reste la constante technique du risque à sa création (clé de listCreationAccess).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rag_reason_text_check') THEN
    ALTER TABLE resource_access_grants ADD CONSTRAINT rag_reason_text_check
      CHECK ((grant_reason IS NULL OR grant_reason = 'Accès accordé à la création du risque') AND revoke_reason IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'svg_reason_text_check') THEN
    ALTER TABLE sensitive_view_grants ADD CONSTRAINT svg_reason_text_check
      CHECK (reason IS NULL AND decision_reason IS NULL AND revoke_reason IS NULL);
  END IF;
END $$;

-- Garde 087 de resource_access_grants, reprise en entier : les deux références rejoignent le contenu immuable.
CREATE OR REPLACE FUNCTION resource_access_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'resource_access_grants: rows are never deleted (revoke with revoked_at)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL OR NEW.revoke_reason_ref IS NOT NULL THEN
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
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason
     OR NEW.grant_reason_ref IS DISTINCT FROM OLD.grant_reason_ref THEN
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
       OR NEW.revoked_by IS NOT NULL OR NEW.revoke_reason IS NOT NULL OR NEW.revoke_reason_ref IS NOT NULL THEN
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

-- Garde 084 de sensitive_view_grants, reprise en entier : les trois références rejoignent le contenu immuable de la décision.
CREATE OR REPLACE FUNCTION sensitive_view_grants_guard() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sensitive_view_grants: rows are never deleted' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL
       OR NEW.revoked_by IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.revoke_reason IS NOT NULL
       OR NEW.decision_reason_ref IS NOT NULL OR NEW.revoke_reason_ref IS NOT NULL
       OR NEW.access_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'sensitive_view_grants: a grant is inserted PENDING, without any decision' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.reason_ref IS DISTINCT FROM OLD.reason_ref
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
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
              AND NEW.decision_reason IS NOT DISTINCT FROM OLD.decision_reason
              AND NEW.decision_reason_ref IS NOT DISTINCT FROM OLD.decision_reason_ref)) THEN
    RAISE EXCEPTION 'sensitive_view_grants: forbidden transition % -> %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION sensitive_view_grants_guard() SET search_path = pg_catalog, public, pg_temp;
