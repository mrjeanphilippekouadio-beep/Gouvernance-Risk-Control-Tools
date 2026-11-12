-- q252 A (DECISION-121) — B-6c avec un seul Risk Manager : régime de décision SOLE_RM.
--
-- Objet
--   Une demande de rattachement (ASSIGN_PROCESS) restait bloquée en NO_DECIDER quand le demandeur est le seul Risk
--   Manager actif. Le demandeur peut désormais la confirmer lui-même, une seconde fois, avec un motif : la demande passe
--   APPROVED avec decision_regime = 'SOLE_RM' et decided_by = requested_by. La règle cesse d'elle-même dès qu'un second
--   Risk Manager actif existe (contrôlé par le service ET rejoué sous verrou du tenant par le dépôt, pas en base).
--   1. decision_regime accepte 'SOLE_RM'.
--   2. Maker-checker : decided_by = requested_by est permis pour BOOTSTRAP (B-6d) et SOLE_RM.
--   3. Forme d'une décision SOLE_RM : ASSIGN_PROCESS approuvée, décideur = demandeur, groupe RISK_MANAGER, motif non
--      vide, ni ratification, ni repli, ni justification BOOTSTRAP.
-- Aucune fonction ni trigger ajoutés (donc rien à épingler en search_path). Aucune ligne existante modifiée.
-- Idempotente : le CHECK de decision_regime est retrouvé par sa définition (nom auto-généré en 055), les autres par nom.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'risk_framework_change_requests'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%decision_regime = ANY%' AND pg_get_constraintdef(oid) LIKE '%NORMAL%'
      AND pg_get_constraintdef(oid) NOT LIKE '%decided_by%'
  LOOP
    EXECUTE format('ALTER TABLE risk_framework_change_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_decision_regime_values_check
  CHECK (decision_regime IN ('NORMAL', 'FALLBACK', 'BOOTSTRAP', 'SOLE_RM'));

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_maker_checker;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_maker_checker
  CHECK (decided_by IS NULL OR decided_by <> requested_by OR decision_regime IN ('BOOTSTRAP', 'SOLE_RM'));

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_sole_rm_shape_check
  CHECK (decision_regime IS DISTINCT FROM 'SOLE_RM' OR (
    kind = 'ASSIGN_PROCESS' AND status = 'APPROVED' AND decided_by = requested_by
    AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
    AND bootstrap_justification IS NULL AND decision_comment IS NOT NULL AND length(btrim(decision_comment)) > 0
  ));
