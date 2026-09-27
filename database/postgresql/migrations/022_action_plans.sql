-- New domain, no apps-script-legacy precedent (ACT-190..196). Ticket
-- lifecycle pattern (same shape as `anomalies`): `action_plans` is one
-- row per action, updated in place through narrow methods, never
-- append-only. `action_links` is a pure link/join table (same exemption
-- as control_risks/kri_risks in CLAUDE.md) covering additional linked
-- resources beyond the polymorphic (source_type, source_id) on the
-- action itself.
--
-- Numbering note: at the time this file was authored in an isolated
-- worktree, the latest migration in this repo was 020_kris.sql, with a
-- parallel RiskOwnership/Cartography module claiming 021 in a sibling
-- worktree — 022 was assigned per the task brief to avoid a numbering
-- collision at merge time. If the merged history ends up different,
-- renumber before applying.
--
-- `source_id`/`action_links.resource_id` are deliberately NOT foreign
-- keys: the source/link is polymorphic (risk, control, kri, anomaly, or
-- no entity at all for audit/incident/management-originated actions), so
-- a single-column FK can't express "references whichever table
-- source_type says". Existence + tenant scoping for these is enforced in
-- ActionPlanService at write time instead (mirrors how Anomaly's
-- optional controlId/controlExecutionId/riskId are validated).

CREATE TABLE action_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  title                 text NOT NULL,
  description           text,
  source_type           text NOT NULL
                          CHECK (source_type IN ('RISK', 'CONTROL', 'KRI', 'AUDIT', 'INCIDENT', 'MANAGEMENT')),
  -- Null for AUDIT/INCIDENT/MANAGEMENT (ACT-190: not tied to an existing
  -- entity row); required by ActionPlanService for RISK/CONTROL/KRI.
  source_id             uuid,
  responsible_user_id   uuid NOT NULL REFERENCES users (id),
  department_id         uuid REFERENCES departments (id),
  due_date              date NOT NULL,
  -- Stored statuses only. EN_RETARD is deliberately absent — this
  -- codebase has no scheduler/cron that could flip a stored status when
  -- due_date passes, so "late" is computed at read time
  -- (computeActionPlanStatus in ActionPlan.ts), same technique
  -- Kri.computeKriStatus uses for Vert/Orange/Rouge.
  status                text NOT NULL DEFAULT 'PLANIFIEE'
                          CHECK (status IN ('PLANIFIEE', 'EN_COURS', 'TERMINEE')),
  progress_percent      integer NOT NULL DEFAULT 0
                          CHECK (progress_percent BETWEEN 0 AND 100),
  -- ACT-191: only the latest progress note is kept here — the
  -- append-only audit_logs table (oldValue/newValue per call) already
  -- carries the full update history; see the design-decision comment on
  -- ActionPlan.progressComment in the entity file.
  progress_comment      text,
  -- ACT-195: mandatory to move status to TERMINEE (enforced in
  -- ActionPlanService.close, not by a NOT NULL here, since the column is
  -- necessarily empty for every non-terminal row).
  evidence_id           uuid REFERENCES evidences (id),
  created_by            uuid NOT NULL REFERENCES users (id),
  closed_by             uuid REFERENCES users (id),
  closed_at             timestamptz,
  closure_comment       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX action_plans_tenant_status_idx ON action_plans (tenant_id, status);
CREATE INDEX action_plans_tenant_due_date_idx ON action_plans (tenant_id, due_date);
CREATE INDEX action_plans_tenant_responsible_idx ON action_plans (tenant_id, responsible_user_id);
CREATE INDEX action_plans_tenant_department_idx ON action_plans (tenant_id, department_id);
CREATE INDEX action_plans_tenant_source_idx ON action_plans (tenant_id, source_type, source_id);

-- ACT-194: an action can link to multiple resources beyond its own
-- source. Pure link table (see control_risks/kri_risks exemption in
-- CLAUDE.md) — rebuilt via DELETE + INSERT, tenant-scoped, no
-- deleted_at of its own and no business meaning outside the pair.
CREATE TABLE action_links (
  tenant_id      uuid NOT NULL REFERENCES tenants (id),
  action_id      uuid NOT NULL REFERENCES action_plans (id),
  resource_type  text NOT NULL CHECK (resource_type IN ('RISK', 'CONTROL', 'KRI', 'ANOMALY')),
  resource_id    uuid NOT NULL,
  PRIMARY KEY (action_id, resource_type, resource_id)
);

CREATE INDEX action_links_tenant_resource_idx ON action_links (tenant_id, resource_type, resource_id);
