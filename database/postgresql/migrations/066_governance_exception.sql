-- D1 (DECISION-074/075, RM-V1-Panel-Principes-Gouvernance.md, lot D1) : socle des données du panel de gouvernance.
--
-- 1. audit_log.governance_exception text NULL : identifiant de la règle de gouvernance contournée (« exécuté sans seconde
--    validation »). Posé à l'INSERT uniquement ; NULL = action ordinaire. Aucune ligne existante n'est modifiée (ADD COLUMN
--    nullable sans défaut : pas de réécriture, le garde append-only 038 n'est pas touché). Pas de CHECK sur les valeurs
--    (la liste évolue avec le catalogue ; type union en TypeScript).
--    Deux index partiels, uniquement sur les lignes marquées.
-- 2. configs.self_validation_policy : choix du client pour noSelfValidation (REFUSE par défaut).
-- 3. Permissions : governancehealth.read (administrateurs + groupes RM, Comité, Audit) et config.selfvalidation.set
--    (administrateurs). « Administrateur » = rôle non-groupe-fixe portant une des permissions de gestion de ADMIN_PERMISSIONS
--    (config.selfvalidation.set exclue, c'est la nouvelle) ; les attributions directes historiques (users.roles)
--    suivent la même règle. Sans doublon, idempotent.
-- Aucune fonction trigger ici. Aucun UPDATE/DELETE sur audit_log.

ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS governance_exception text;

CREATE INDEX IF NOT EXISTS audit_log_governance_exception_idx
  ON audit_log (tenant_id, "timestamp" DESC) WHERE governance_exception IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_log_governance_exception_entity_idx
  ON audit_log (tenant_id, entity_type, entity_id) WHERE governance_exception IS NOT NULL;

ALTER TABLE configs ADD COLUMN IF NOT EXISTS self_validation_policy text NOT NULL DEFAULT 'REFUSE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'configs_self_validation_policy_check' AND conrelid = 'configs'::regclass) THEN
    ALTER TABLE configs ADD CONSTRAINT configs_self_validation_policy_check
      CHECK (self_validation_policy IN ('REFUSE', 'DOUBLE_CONFIRMATION'));
  END IF;
END $$;

-- Groupes fixes : lecture du panel (q140 / I-P1).
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['governancehealth.read']::text[]))
WHERE system_group IN ('RISK_MANAGER', 'RISK_COMMITTEE', 'AUDIT') AND deleted_at IS NULL;

-- Rôles administrateurs existants (hors groupes fixes) : lecture du panel + réglage de l'auto-validation.
UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['governancehealth.read', 'config.selfvalidation.set']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage'
  ]::text[];

-- Attributions directes historiques (users.roles).
UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['governancehealth.read', 'config.selfvalidation.set']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage'
  ]::text[];
