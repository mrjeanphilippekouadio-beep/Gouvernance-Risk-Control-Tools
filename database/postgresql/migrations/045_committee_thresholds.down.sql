-- Rollback of 045_committee_thresholds.sql. Drops the three columns
-- (their CHECK constraints go with them).
--
-- Non destructive as long as no tenant has written a value different
-- from the shipped defaults (committee_evaluation_min_score = 15,
-- committee_treatment_min_score = NULL, committee_evaluation_enforced =
-- true) at the moment of rollback — if `ConfigService.updateCommitteeThresholds`
-- or `setCommitteeEnforcement` has already been called in a shared
-- environment, this rollback silently discards that tenant's explicit
-- choice. Verify before running in STAGING/PROD.

ALTER TABLE configs
  DROP COLUMN committee_evaluation_min_score,
  DROP COLUMN committee_treatment_min_score,
  DROP COLUMN committee_evaluation_enforced;

DELETE FROM schema_migrations WHERE filename = '045_committee_thresholds.sql';
