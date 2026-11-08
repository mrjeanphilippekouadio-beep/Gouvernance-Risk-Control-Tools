-- q233 A (DECISION-116) : seuils du panneau « santé de la gouvernance » (lot D6bis), réglables par client, valeurs de départ
-- et plages proposées par A13 (docs/risk/A13-seuils-panel-D6-2026-11-04.md). Changés par le circuit des délais de
-- gouvernance (q182) : relever un seuil (moins d'alertes) passe par une seconde personne, l'abaisser reste direct ; tout
-- changement est audité (avant / après / motif). NOT NULL : un seuil n'est jamais « absent ».
-- Aucune fonction, aucun trigger. Idempotente.
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_rm_risk_share_max_pct integer NOT NULL DEFAULT 20
  CHECK (gov_rm_risk_share_max_pct BETWEEN 10 AND 40);
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_max_admins integer NOT NULL DEFAULT 3
  CHECK (gov_max_admins BETWEEN 2 AND 5);
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_role_max_permissions integer NOT NULL DEFAULT 25
  CHECK (gov_role_max_permissions BETWEEN 15 AND 40);
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_role_max_families integer NOT NULL DEFAULT 4
  CHECK (gov_role_max_families BETWEEN 3 AND 6);
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_dormant_days integer NOT NULL DEFAULT 90
  CHECK (gov_dormant_days BETWEEN 45 AND 180);
ALTER TABLE configs ADD COLUMN IF NOT EXISTS gov_owner_creator_share_max_pct integer NOT NULL DEFAULT 50
  CHECK (gov_owner_creator_share_max_pct BETWEEN 25 AND 80);

-- DECISION-061 (q119, PO 2026-10-18) : cumul Comité + Audit interdit par défaut, autorisable par le client. Seul le
-- défaut des NOUVELLES lignes change : aucun UPDATE, un cumul déjà autorisé (Djamo) n'est jamais révoqué en silence.
ALTER TABLE configs ALTER COLUMN committee_audit_cumul_allowed SET DEFAULT false;
