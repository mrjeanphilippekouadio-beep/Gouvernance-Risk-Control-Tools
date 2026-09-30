-- Architect audit finding (2026-09-30, parallel to the processId/
-- evaluationMode wiring batch): neither `processes` nor `departments`
-- has a uniqueness constraint on `name` — two "Crédit" rows in the same
-- tenant make any name-based backfill/lookup ambiguous (already the
-- documented reason `backfillRiskProcessId.ts` refuses to auto-apply an
-- "ambiguous" match, see its file header) and would double-count in any
-- concentration grid grouped by process/department name.
--
-- departments: flat, no hierarchy — a plain partial unique index on
-- (tenant_id, name) is safe.
--
-- processes: NOT given the same flat treatment. `backfillRiskProcessId.ts`'s
-- own doc comment documents a *deliberate, already-shipped* design fact:
-- "the same name can legitimately exist at different levels or under
-- different parents" (e.g. an ACTIVITY named "Contrôle" nested under two
-- different SUBPROCESS parents is not a data error). A flat
-- `UNIQUE (tenant_id, name)` would contradict that already-documented
-- behavior and could fail outright against real, legitimate existing
-- data. Instead this scopes uniqueness to siblings only — no two
-- children of the *same* parent share a name, and no two root
-- (parent_id IS NULL, i.e. PROCESS-level) items share a name — which is
-- exactly the "two top-level 'Crédit' processes" duplicate this finding
-- is actually worried about, without touching the cross-branch same-name
-- case the backfill script already handles by design. Two partial
-- indexes because a plain UNIQUE index treats every NULL parent_id as
-- distinct (Postgres default), which would silently fail to catch
-- duplicate root-level names.
--
-- Numbering: 034_risk_evaluations_evaluation_mode.sql is the latest
-- migration in this repo at the time this file was authored — confirmed
-- by listing the migrations directory directly before writing
-- (anti-collision protocol, GRC_Migration_Plan.md §1).

CREATE UNIQUE INDEX departments_tenant_name_idx
  ON departments (tenant_id, name)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX processes_tenant_parent_name_idx
  ON processes (tenant_id, parent_id, name)
  WHERE deleted_at IS NULL AND parent_id IS NOT NULL;

CREATE UNIQUE INDEX processes_tenant_root_name_idx
  ON processes (tenant_id, name)
  WHERE deleted_at IS NULL AND parent_id IS NULL;
