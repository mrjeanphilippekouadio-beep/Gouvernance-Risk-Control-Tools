-- D2b (DECISION-074/075/064, RM-V1-Panel-Principes-Gouvernance.md, lot D2b) : responsabilités de processus.
--
-- 1. processes.owner_user_id / risk_champion_user_id / deputy_user_id : trois comptes à valeur unique par processus
--    (propriétaire, champion de risque, N-1 désigné). Colonnes nullables, aucune ligne existante modifiée.
--    processes.owner (texte libre) est CONSERVÉ tel quel : jamais écrasé ni supprimé (DECISION-075 q150) ; le rapprochement
--    avec un compte est proposé par le serveur à la lecture et confirmé processus par processus (PUT), jamais appliqué ici.
--    SEC-PNL-06 : FK COMPOSITES (tenant_id, <colonne>) -> users (tenant_id, id) (UNIQUE (tenant_id, id) ajoutée sur users,
--    trivialement vraie car id est la clé primaire) : un compte d'un autre tenant est refusé par la base. MATCH SIMPLE : une
--    colonne NULL n'est pas contrôlée. Le service vérifie en plus que le compte est actif.
-- 2. Permission process.responsibility.assign : groupe Risk Manager + rôles administrateurs existants (hors groupes
--    fixes) + attributions directes historiques (users.roles). Mêmes critères « administrateur » que 066. Sans doublon.
-- Aucune fonction trigger ici. Aucun DELETE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_tenant_id_id_key' AND conrelid = 'users'::regclass) THEN
    ALTER TABLE users ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;
END $$;

ALTER TABLE processes ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE processes ADD COLUMN IF NOT EXISTS risk_champion_user_id uuid;
ALTER TABLE processes ADD COLUMN IF NOT EXISTS deputy_user_id uuid;

DO $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['owner_user_id', 'risk_champion_user_id', 'deputy_user_id'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'processes_' || c || '_tenant_fk' AND conrelid = 'processes'::regclass) THEN
      EXECUTE format('ALTER TABLE processes ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES users (tenant_id, id)',
                     'processes_' || c || '_tenant_fk', c);
    END IF;
  END LOOP;
END $$;

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
