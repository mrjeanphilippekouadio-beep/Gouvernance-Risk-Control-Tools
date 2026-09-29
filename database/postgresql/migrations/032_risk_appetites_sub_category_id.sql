-- DIV-08 (.claude/agent-context/ACTION_ITEMS.md, @architect audit
-- 2026-09-29): `risk_appetites.sub_category` is free text. RiskCategory.ts
-- (024_config.sql's risk_categories table) already flags this as a
-- follow-up FK target: "Deliberately NOT linked as a foreign key from
-- RiskAppetite.subCategory (still free text there) [...] flagged as a
-- follow-up". This migration is that follow-up — Expand-only (no
-- Contract), same pattern as 029_risks_process_id.sql /
-- 031_controls_process_id.sql: the existing `sub_category` free-text
-- column is untouched, both columns co-exist.
--
-- Nullable, NOT backfilled: `sub_category` free text has no reliable
-- 1:1 correspondence to an existing `risk_categories.name` row (typos,
-- renamed categories, abbreviations) — guessing a match here risks
-- silently linking an appetite threshold to the wrong category.
-- `sub_category_id` stays NULL until a caller explicitly sets it
-- through RiskAppetiteService.
--
-- No explicit ON DELETE clause (default NO ACTION) — matches
-- risks.process_id (029) / controls.process_id (031) exactly.
--
-- Scope note: RiskEvaluation.subCategory (a different entity, a
-- per-evaluation denormalized snapshot — see RiskEvaluation.ts's file
-- header) is explicitly OUT of scope here and stays free text. Only
-- RiskAppetite.subCategory is touched by this migration.
--
-- Numbering: 031_controls_process_id.sql is the latest migration in
-- this repo at the time this file was authored — confirmed by listing
-- the migrations directory directly before writing (anti-collision
-- protocol, GRC_Migration_Plan.md §1).

ALTER TABLE risk_appetites ADD COLUMN sub_category_id uuid REFERENCES risk_categories (id);

-- Mirrors risks_tenant_process_idx (029) / controls_tenant_process_idx
-- (031) — same query shape (tenant-scoped lookups by the FK), same
-- partial index excluding soft-deleted rows.
CREATE INDEX risk_appetites_tenant_sub_category_idx ON risk_appetites (tenant_id, sub_category_id) WHERE deleted_at IS NULL;
