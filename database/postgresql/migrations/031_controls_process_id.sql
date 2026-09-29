-- DIV-05 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
-- 2026-09-29): `controls.process` is free text, the same gap
-- `risks.process` had before 029_risks_process_id.sql. This migration
-- gives Control a real FK too, Expand-only (no Contract): the existing
-- `process` free-text column is untouched, both columns co-exist.
--
-- Nullable, NOT backfilled: `controls.process` free text has no
-- reliable 1:1 correspondence to an existing `processes.name` row
-- (typos, renamed processes, abbreviations) — guessing a match here
-- risks silently linking a control to the wrong process. `process_id`
-- stays NULL until a caller explicitly sets it through ControlService.
--
-- No explicit ON DELETE clause (default NO ACTION) — matches
-- risks.process_id (029) exactly, verified by reading that migration
-- before writing this one.
--
-- Numbering: 030_evaluation_mode.sql is the latest migration in this
-- repo at the time this file was authored — confirmed by listing the
-- migrations directory directly before writing (anti-collision
-- protocol, GRC_Migration_Plan.md §1).

ALTER TABLE controls ADD COLUMN process_id uuid REFERENCES processes (id);

-- Mirrors risks_tenant_process_idx (029_risks_process_id.sql) — same
-- query shape (tenant-scoped lookups by process), same partial index
-- excluding soft-deleted rows.
CREATE INDEX controls_tenant_process_idx ON controls (tenant_id, process_id) WHERE deleted_at IS NULL;
