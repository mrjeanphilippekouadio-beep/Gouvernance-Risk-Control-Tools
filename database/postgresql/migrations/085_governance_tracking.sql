-- DECISION-074 R-1 ligne 15 / R-6.2 (q143), lot D6 : date de début du suivi de gouvernance par client (`trackedSince`
-- du panel). Posée par cette migration, après toutes les migrations de données du panel (D1 à D5) : la date est
-- prudente, jamais antérieure à une donnée qui n'existait pas. Aucune reconstitution du passé.
-- Les clients existants reçoivent la date d'application de la migration ; un client créé plus tard, sa date de création.
-- R3 (DECISION-099, q227 / DECISION-114) : durée de conservation de la date de « dernière activité » après la fin du compte
-- (suspension, `users.deleted_at`), 5 ans par défaut (1826 jours), réglable par client comme les autres délais de
-- gouvernance ; NULL = jamais effacée. La purge (mise à NULL de la date, jamais de DELETE) est faite par l'application.
-- Aucune fonction, aucun trigger. Idempotente.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS governance_tracking_started_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN tenants.governance_tracking_started_at IS
  'début du suivi du panel de gouvernance (q143) : rien n''est reconstitué avant cette date';
ALTER TABLE configs ADD COLUMN IF NOT EXISTS last_seen_retention_days integer DEFAULT 1826
  CHECK (last_seen_retention_days BETWEEN 1 AND 3650);
