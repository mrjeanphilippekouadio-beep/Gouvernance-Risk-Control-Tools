-- Rollback of 089_sole_risk_manager_assignment.sql (q252 A, DECISION-121).
-- Remet les CHECK d'avant (055). Échoue (et annule tout) s'il existe une demande SOLE_RM : une décision tracée n'est
-- jamais réécrite ; il faut d'abord décider quoi en faire. Le fichier gère sa transaction : `psql -v ON_ERROR_STOP=1 -f`.
BEGIN;

ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_sole_rm_shape_check;
ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_maker_checker;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_maker_checker
  CHECK (decided_by IS NULL OR decided_by <> requested_by OR decision_regime = 'BOOTSTRAP');
ALTER TABLE risk_framework_change_requests DROP CONSTRAINT IF EXISTS risk_framework_change_requests_decision_regime_values_check;
ALTER TABLE risk_framework_change_requests ADD CONSTRAINT risk_framework_change_requests_decision_regime_check
  CHECK (decision_regime IN ('NORMAL', 'FALLBACK', 'BOOTSTRAP'));

DELETE FROM schema_migrations WHERE filename = '089_sole_risk_manager_assignment.sql';

COMMIT;
