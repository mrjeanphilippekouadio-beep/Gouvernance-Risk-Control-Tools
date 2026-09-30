-- Reverts 034_risk_evaluations_evaluation_mode.sql. Non-destructive to
-- anything else: nothing references risk_evaluations.evaluation_mode
-- (no incoming FK), and every other RiskEvaluationService code path is
-- unaffected — only the newly-resolved snapshot value is lost, which is
-- also the only thing this column ever held.
ALTER TABLE risk_evaluations DROP COLUMN IF EXISTS evaluation_mode;

DELETE FROM schema_migrations WHERE filename = '034_risk_evaluations_evaluation_mode.sql';
