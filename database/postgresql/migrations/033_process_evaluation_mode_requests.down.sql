-- Destructive: drops the table and every request row (the whole
-- Classique/Participatif validation history) with it. Non-destructive to
-- anything else: nothing references process_evaluation_mode_requests
-- (no incoming FK), and Process.evaluation_mode (030) is never written
-- by this table's rows directly — only by
-- ProcessEvaluationModeRequestService, which stays functional (its
-- direct setMode() path) even after this rollback; only the
-- propose/validate/reject workflow breaks. Safe up to the point a later
-- migration adds a table that references process_evaluation_mode_requests.
DROP INDEX IF EXISTS process_evaluation_mode_requests_pending_unique_idx;
DROP INDEX IF EXISTS process_evaluation_mode_requests_tenant_process_idx;
DROP TABLE IF EXISTS process_evaluation_mode_requests;

DELETE FROM schema_migrations WHERE filename = '033_process_evaluation_mode_requests.sql';
