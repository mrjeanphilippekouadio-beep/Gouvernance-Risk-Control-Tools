-- Rollback for 030_evaluation_mode.sql
--
-- Drops both evaluation_mode columns (their CHECK constraints go with
-- them). Safe at any time this column has never been written by
-- application code with real data a rollback would need to preserve —
-- no later migration in this repo (as of 030) depends on either column.
--
-- How to run this file: see README.md in this directory.

ALTER TABLE processes DROP COLUMN IF EXISTS evaluation_mode;
ALTER TABLE configs DROP COLUMN IF EXISTS evaluation_mode;

DELETE FROM schema_migrations WHERE filename = '030_evaluation_mode.sql';
