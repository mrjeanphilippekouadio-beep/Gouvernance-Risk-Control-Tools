-- Architect audit (.claude/agent-context/ACTION_ITEMS.md, 2026-09-30):
-- `User` has no attachment to a department at all — `UpdateUserInput`
-- (User.ts) explicitly documents that the `users` table (migration 002)
-- has no `département`/`fonction` column. This migration gives User a
-- real FK, Expand-only (no Contract), same pattern as
-- 029_risks_process_id.sql / 031_controls_process_id.sql /
-- 032_risk_appetites_sub_category_id.sql: no free-text legacy column
-- exists here to preserve, so this is a pure additive column.
--
-- Nullable, NOT backfilled: there is no free-text department field on
-- `users` to infer a match from, and guessing would risk silently
-- attaching a user to the wrong department. `department_id` stays NULL
-- until a caller explicitly sets it through UserService.
--
-- No explicit ON DELETE clause (default NO ACTION) — matches
-- risks.process_id (029) / controls.process_id (031) /
-- risk_appetites.sub_category_id (032) exactly, verified by reading
-- those migrations before writing this one.
--
-- Numbering: 033_process_evaluation_mode_requests.sql is the latest
-- migration on `main` at the time this file was authored, but 034/035
-- are already reserved by the in-flight, not-yet-merged
-- feature/wire-processid-evaluationmode branch (034_risk_evaluations_
-- evaluation_mode / 035_process_department_name_uniqueness — confirmed
-- via `git log --all -- database/postgresql/migrations/034* 035*`, not
-- by listing `main`'s working tree alone, per the anti-collision
-- protocol, GRC_Migration_Plan.md §1). This file is 036 to avoid that
-- collision.
--
-- Scope note: this migration only creates the column/index. Wiring it
-- into the Dashboard scope resolver is a separate, not-yet-started lot
-- (per the audit) and is explicitly out of scope here.

ALTER TABLE users ADD COLUMN department_id uuid REFERENCES departments (id);

-- Mirrors risks_tenant_process_idx (029) / controls_tenant_process_idx
-- (031) / risk_appetites_tenant_sub_category_idx (032) — same query
-- shape (tenant-scoped lookups by the FK), same partial index excluding
-- soft-deleted rows.
CREATE INDEX users_tenant_department_idx ON users (tenant_id, department_id) WHERE deleted_at IS NULL;
