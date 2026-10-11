-- Rollback of 052_score_ceiling_36.sql.
-- Fails (constraint violation) if a threshold above 25 exists. Check first:
--   SELECT count(*) FROM risk_appetites WHERE threshold > 25;
--   SELECT count(*) FROM configs WHERE committee_evaluation_min_score > 25 OR committee_treatment_min_score > 25;

ALTER TABLE risk_appetites DROP CONSTRAINT risk_appetites_threshold_check;
ALTER TABLE risk_appetites ADD CONSTRAINT risk_appetites_threshold_check CHECK (threshold BETWEEN 1 AND 25);
ALTER TABLE configs DROP CONSTRAINT configs_committee_evaluation_min_score_check;
ALTER TABLE configs ADD CONSTRAINT configs_committee_evaluation_min_score_check CHECK (committee_evaluation_min_score BETWEEN 1 AND 25);
ALTER TABLE configs DROP CONSTRAINT configs_committee_treatment_min_score_check;
ALTER TABLE configs ADD CONSTRAINT configs_committee_treatment_min_score_check CHECK (committee_treatment_min_score IS NULL OR committee_treatment_min_score BETWEEN 1 AND 25);

DELETE FROM schema_migrations WHERE filename = '052_score_ceiling_36.sql';
