-- D2b (DECISION-074/075/064, RM-V1-Panel-Principes-Gouvernance.md, lot D2b) : responsabilités de processus.
--
-- 1. processes.owner_user_id / risk_champion_user_id / deputy_user_id : trois comptes à valeur unique par processus
--    (propriétaire, champion de risque, N-1 désigné). Colonnes nullables, aucune ligne existante modifiée.
--    processes.owner (texte libre) est CONSERVÉ tel quel : jamais écrasé ni supprimé (DECISION-075 q150) ; le rapprochement
--    avec un compte est proposé par le serveur à la lecture et confirmé processus par processus (PUT), jamais appliqué ici.
--    Pas de contrainte inter-tenant possible par FK simple (users n'a pas d'unicité (tenant_id, id)) : le service vérifie
--    que le compte est actif et du même tenant avant écriture.
-- 2. Permission process.responsibility.assign : groupe Risk Manager + rôles administrateurs existants (hors groupes
--    fixes) + attributions directes historiques (users.roles). Mêmes critères « administrateur » que 066. Sans doublon.
-- Aucune fonction trigger ici. Aucun DELETE.

ALTER TABLE processes ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users (id);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS risk_champion_user_id uuid REFERENCES users (id);
ALTER TABLE processes ADD COLUMN IF NOT EXISTS deputy_user_id uuid REFERENCES users (id);

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['process.responsibility.assign']::text[]))
WHERE system_group = 'RISK_MANAGER' AND deleted_at IS NULL;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['process.responsibility.assign']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];

UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['process.responsibility.assign']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set'
  ]::text[];
