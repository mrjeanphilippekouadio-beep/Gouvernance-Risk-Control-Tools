-- F8 bis durcissement (DECISION-132/135), retests SEC-F8B-03/04, QA-F8B-01/02. Aucune fonction ni trigger ajoutés. Idempotente.
--   1. q282 A : users.identity_provider / identity_subject = identifiant STABLE du compte chez le fournisseur d'identité
--      (Google `sub`), enregistré à la première connexion ; ensuite la connexion exige le même identifiant. Les deux
--      colonnes vont ensemble (CHECK). Unique par fournisseur parmi les comptes actifs (un identifiant = un compte).
--      Comptes locaux de dev : NULL, sans changement. Jamais rempli rétroactivement.
--   2. QA-F8B-01 : nom de client unique une fois normalisé (espaces extérieurs retirés, espaces multiples réduits, casse).
--   3. QA-F8B-02 : un même fichier ne peut avoir qu'UN premier import par client : index unique partiel sur la ligne d'audit
--      `RiskImport` « première fois » (reimport = false). Un réimport confirmé (reimport = true) reste possible.
-- Les deux index échouent avec un message explicite si des doublons existent déjà (aucune donnée n'est modifiée ni supprimée).

ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_provider text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_subject text;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identity_pair_check;
ALTER TABLE users ADD CONSTRAINT users_identity_pair_check
  CHECK ((identity_provider IS NULL) = (identity_subject IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS users_identity_uq ON users (identity_provider, identity_subject)
  WHERE identity_subject IS NOT NULL AND deleted_at IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenants GROUP BY lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '092: duplicate client names (case/space-insensitive) exist in tenants; rename them before applying';
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_log WHERE entity_type = 'RiskImport' AND (new_value ->> 'reimport') = 'false'
    GROUP BY tenant_id, entity_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '092: a risk import file has several first-import audit rows for one client (concurrent import); review before applying';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_name_normalized_uq ON tenants (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_risk_import_once_uq ON audit_log (tenant_id, entity_id)
  WHERE entity_type = 'RiskImport' AND (new_value ->> 'reimport') = 'false';
