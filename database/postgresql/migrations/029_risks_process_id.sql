-- DIV-05 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
-- 2026-09-29): `risks.process` is free text while `kpis.process_id` is
-- already a real FK to `processes` for the same concept — this migration
-- gives Risk a real FK too, Expand-only (no Contract): the existing
-- `process` free-text column is untouched, both columns co-exist.
--
-- Nullable, NOT backfilled: `risks.process` free text has no reliable
-- 1:1 correspondence to an existing `processes.name` row (typos,
-- renamed processes, abbreviations) — guessing a match here risks
-- silently linking a risk to the wrong process. `process_id` stays NULL
-- until a caller explicitly sets it through RiskService.
--
-- Numbering: 028_raci_entity_type_snake_case.sql is the latest migration
-- in this repo at the time this file was authored — confirmed by
-- listing the migrations directory directly before writing
-- (anti-collision protocol, GRC_Migration_Plan.md §1). Control.process
-- is explicitly out of scope (next lot, per the audit).

ALTER TABLE risks ADD COLUMN process_id uuid REFERENCES processes (id);

-- Mirrors kpis_tenant_process_idx (016_kpis.sql) — same query shape
-- (tenant-scoped lookups by process), same partial index excluding
-- soft-deleted rows.
CREATE INDEX risks_tenant_process_idx ON risks (tenant_id, process_id) WHERE deleted_at IS NULL;
