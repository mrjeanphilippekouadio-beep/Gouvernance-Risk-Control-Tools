-- Rollback of 050_scale_3_to_6.sql.
-- Fails (constraint violation) if a rating scale or risk with a level of 6 exists:
-- check `SELECT count(*) FROM rating_scales WHERE probability_levels > 5 OR impact_levels > 5`
-- and `SELECT count(*) FROM risk_assessments WHERE probability > 5 OR impact > 5 OR residual_probability > 5 OR residual_impact > 5` is 0 first.

ALTER TABLE rating_scales DROP CONSTRAINT rating_scales_probability_levels_check;
ALTER TABLE rating_scales ADD CONSTRAINT rating_scales_probability_levels_check CHECK (probability_levels BETWEEN 1 AND 5);
ALTER TABLE rating_scales DROP CONSTRAINT rating_scales_impact_levels_check;
ALTER TABLE rating_scales ADD CONSTRAINT rating_scales_impact_levels_check CHECK (impact_levels BETWEEN 1 AND 5);

ALTER TABLE risk_assessments DROP CONSTRAINT risk_assessments_probability_check;
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_probability_check CHECK (probability BETWEEN 1 AND 5);
ALTER TABLE risk_assessments DROP CONSTRAINT risk_assessments_impact_check;
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_impact_check CHECK (impact BETWEEN 1 AND 5);
ALTER TABLE risk_assessments DROP CONSTRAINT risk_assessments_residual_probability_check;
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_residual_probability_check CHECK (residual_probability BETWEEN 1 AND 5);
ALTER TABLE risk_assessments DROP CONSTRAINT risk_assessments_residual_impact_check;
ALTER TABLE risk_assessments ADD CONSTRAINT risk_assessments_residual_impact_check CHECK (residual_impact BETWEEN 1 AND 5);

DELETE FROM schema_migrations WHERE filename = '050_scale_3_to_6.sql';
