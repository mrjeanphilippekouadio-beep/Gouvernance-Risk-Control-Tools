-- New domain, no apps-script-legacy precedent (KPI tracking did not
-- exist in the Sheets-based tool — see ACT-140..144). `kpis` is updated
-- in place, like departments/processes; `kpi_measures` is append-only,
-- like control_executions — one row per recorded value, never mutated.
-- A KPI's status (Achieved/At risk/Not achieved, ACT-142) is never
-- stored: KpiService derives it at read time from the latest measure.

CREATE TABLE kpis (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants (id),
  label             text NOT NULL,
  target_value      double precision NOT NULL,
  unit              text NOT NULL,
  frequency         text NOT NULL
                      CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL')),
  owner             text NOT NULL,
  department_id     uuid REFERENCES departments (id),
  process_id        uuid REFERENCES processes (id),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES users (id),
  deletion_reason   text,
  -- ACT-140/144 critical rule: a KPI must be linked to at least a
  -- department or a process. Enforced in KpiService too (defense in
  -- depth — the service check runs first and raises a friendly
  -- ValidationError instead of a raw constraint violation).
  CONSTRAINT kpis_linked_to_department_or_process
    CHECK (department_id IS NOT NULL OR process_id IS NOT NULL)
);

CREATE INDEX kpis_tenant_department_idx ON kpis (tenant_id, department_id) WHERE deleted_at IS NULL;
CREATE INDEX kpis_tenant_process_idx ON kpis (tenant_id, process_id) WHERE deleted_at IS NULL;

-- Append-only: one row per recorded value (ACT-141). No deleted_at —
-- consistent with control_executions, append-only history is never
-- soft-deleted either, only ever added to.
CREATE TABLE kpi_measures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  kpi_id        uuid NOT NULL REFERENCES kpis (id),
  period        date NOT NULL,
  value         double precision NOT NULL,
  comment       text,
  recorded_by   uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Status calculation (ACT-142) always wants "the most recent measure
-- for this KPI" — period desc, then created_at desc as a tiebreaker
-- for same-period corrections.
CREATE INDEX kpi_measures_kpi_period_idx ON kpi_measures (kpi_id, period DESC, created_at DESC);
CREATE INDEX kpi_measures_tenant_idx ON kpi_measures (tenant_id);
