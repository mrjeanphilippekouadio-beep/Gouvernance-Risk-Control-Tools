-- q252 A (DECISION-121), retests SEC-B6C-04 / QA-B6C-04 — le régime SOLE_RM se juge « au moment de la demande ».
--   1. sole_rm_at_request : fait figé à la création d'une demande ASSIGN_PROCESS (le demandeur était alors le seul Risk
--      Manager actif). `sole-confirm` est refusé sinon : retirer un collègue après coup ne rouvre plus la voie.
--      Défaut false : les demandes déjà en attente ne sont pas confirmables seul (le demandeur en refait une).
--   2. CHECK de forme SOLE_RM : decider_group NULL ne passe plus (NULL satisfait un CHECK `= 'RISK_MANAGER'`).
-- Aucune fonction ni trigger ajoutés. Idempotente.

ALTER TABLE risk_framework_change_requests ADD COLUMN IF NOT EXISTS sole_rm_at_request boolean NOT NULL DEFAULT false;

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_sole_rm_shape_check
  CHECK (decision_regime IS DISTINCT FROM 'SOLE_RM' OR (
    kind = 'ASSIGN_PROCESS' AND status = 'APPROVED' AND decided_by = requested_by
    AND decider_group IS NOT NULL AND decider_group = 'RISK_MANAGER' AND ratification_status IS NULL AND fallback_cause IS NULL
    AND bootstrap_justification IS NULL AND decision_comment IS NOT NULL AND length(btrim(decision_comment)) > 0
  ));
