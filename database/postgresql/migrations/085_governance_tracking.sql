-- DECISION-074 R-1 ligne 15 / R-6.2 (q143), lot D6 : date de début du suivi de gouvernance par client (`trackedSince`
-- du panel). Posée par cette migration, après toutes les migrations de données du panel (D1 à D5) : la date est
-- prudente, jamais antérieure à une donnée qui n'existait pas. Aucune reconstitution du passé.
-- Les clients existants reçoivent la date d'application de la migration ; un client créé plus tard, sa date de création.
-- Aucune fonction, aucun trigger. Idempotente.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS governance_tracking_started_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN tenants.governance_tracking_started_at IS
  'début du suivi du panel de gouvernance (q143) : rien n''est reconstitué avant cette date';
