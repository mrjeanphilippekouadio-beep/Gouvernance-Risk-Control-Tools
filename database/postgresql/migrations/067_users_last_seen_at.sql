-- Lot D2a (DECISION-074/075) : date de dernière connexion, lue plus tard par le panel (lot D6).
-- users.last_seen_at timestamptz NULL : NULL = « pas vu depuis la mise en service de la colonne ». Aucune donnée
-- nouvelle au-delà de la date (ni IP, ni user-agent, ni appareil). Jamais remplie rétroactivement.
-- Écriture applicative : au plus une fois par heure et par utilisateur (résolveur d'identité), tenant-scopée.
-- Idempotente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
