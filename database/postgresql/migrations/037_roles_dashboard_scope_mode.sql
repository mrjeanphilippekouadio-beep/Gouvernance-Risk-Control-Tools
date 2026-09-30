-- Architect design (.claude/agent-context/ACTION_ITEMS.md, @architect,
-- 2026-09-30, "Conception du scope configurable dashboard.executive via
-- RACI") + PO arbitrations relayed in the same entry: the
-- dashboard.executive scope moves from a binary tenant-wide permission
-- to a configurable mode carried on Role (not Config — a single tenant
-- switch would force the CEO and a department head onto the same
-- perimeter). Resolved at read time by DashboardScopeResolver, never
-- stored as a computed perimeter.
--
-- Three modes: GLOBAL (today's behavior, unchanged, and the default so
-- every existing role keeps seeing everything), DEPARTMENT, PROCESS.
-- PROCESS is kept in the enum (the resolver branch is written, tested)
-- but rejected at the RoleService write boundary — risks.process_id
-- (029_risks_process_id.sql) has never been backfilled in real data (0
-- unique matches found in the dry-run cited by the PO), so wiring
-- PROCESS live today would render an empty dashboard for anyone holding
-- it. The CHECK constraint still allows the value so the column and the
-- application-level enum never drift apart while that backfill remains
-- outstanding.
--
-- NOT NULL DEFAULT 'GLOBAL': every role that exists today (and every
-- role created by code that doesn't yet know about this column)
-- resolves to the exact pre-existing behavior — zero regression on
-- dashboard.executive holders already in production.
ALTER TABLE roles
  ADD COLUMN dashboard_scope_mode text NOT NULL DEFAULT 'GLOBAL'
    CHECK (dashboard_scope_mode IN ('GLOBAL', 'DEPARTMENT', 'PROCESS'));

-- Lot 1 RACI (027_raci_assignments.sql) only indexed
-- (tenant_id, entity_type, entity_id) — the "who is on this entity"
-- direction. DashboardScopeResolver needs the opposite direction ("all
-- RACI rows for this actor, across every entity") to build a user's
-- perimeter without a full table scan. Partial on deleted_at IS NULL,
-- same convention as raci_assignments_tenant_entity_idx.
CREATE INDEX raci_assignments_tenant_user_idx
  ON raci_assignments (tenant_id, user_id)
  WHERE deleted_at IS NULL;
