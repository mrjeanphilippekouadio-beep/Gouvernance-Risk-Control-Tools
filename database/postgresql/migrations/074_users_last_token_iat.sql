-- I01 / F-PNL2-02 (retest 2026-10-19) : q155 « dernière connexion » côté Google. Le suivi de l'`iat` du jeton était une Map
-- par processus : chaque instance ou démarrage à froid voyait chaque jeton comme nouveau. L'`iat` du dernier jeton compté
-- est désormais stocké ; une connexion n'est comptée que si l'`iat` du jeton diffère (comparaison atomique en SQL,
-- indépendante de l'instance). Aucune donnée au-delà d'un entier (secondes epoch émises par Google). Jamais rempli rétroactivement.
-- Idempotente.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_token_iat bigint;
