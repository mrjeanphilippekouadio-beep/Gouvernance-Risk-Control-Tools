-- New domain, no apps-script-legacy precedent (KRI tracking did not
-- exist in the Sheets-based tool — see ACT-130..138). `kris` is updated
-- in place, like kpis/departments/processes; `kri_measures` is
-- append-only, like kpi_measures/control_executions — one row per
-- recorded value, never mutated. `kri_risks` is a pure link table (same
-- exemption as control_risks in CLAUDE.md) covering *additional* risks
-- beyond the mandatory primary `risk_id` on `kris` itself.
--
-- Numbering note: this repo's migrations were at 018 (rating_scales) at
-- the time this file was authored, in an isolated worktree in parallel
-- with a RiskEvaluation module claiming 019 — 020 was assigned by the
-- orchestrator up front to avoid a numbering collision at merge time.
-- If the merged history ends up different, renumber before applying.

CREATE TABLE kris (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  label                 text NOT NULL,
  formula               text NOT NULL,
  threshold_green       double precision NOT NULL,
  threshold_orange      double precision NOT NULL,
  threshold_red         double precision NOT NULL,
  frequency             text NOT NULL
                          CHECK (frequency IN ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL')),
  -- ACT-130 mandatory primary link ("lien risque obligatoire") — exactly
  -- one risk this indicator is built to monitor. ACT-136's "peut couvrir
  -- plusieurs risques" is the separate kri_risks join table below.
  risk_id               uuid NOT NULL REFERENCES risks (id),
  -- Free-text organizational scope (mirrors risk_appetite.entity) — not
  -- named in ACT-130's field list, added so ACT-137's dashboard filter
  -- ("filtres : entité, département...") has something concrete to
  -- filter on without inventing a new domain table for this batch.
  entity                text,
  methodology_version   text,
  description           text,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users (id),
  deletion_reason       text,
  -- ACT-130 critical rule: "seuils Vert < Orange < Rouge". Enforced here
  -- and, defense in depth, in KriService (which raises a friendly
  -- ValidationError before this constraint would ever fire).
  CONSTRAINT kris_thresholds_increasing
    CHECK (threshold_green < threshold_orange AND threshold_orange < threshold_red)
);

CREATE INDEX kris_tenant_risk_idx ON kris (tenant_id, risk_id) WHERE deleted_at IS NULL;
CREATE INDEX kris_tenant_entity_idx ON kris (tenant_id, entity) WHERE deleted_at IS NULL;

-- ACT-136: additional risks covered by a KRI, beyond the mandatory
-- primary risk_id above. Pure link table (see the control_risks
-- exemption in CLAUDE.md) — rebuilt via DELETE + INSERT, tenant-scoped,
-- no deleted_at of its own and no business meaning outside the pair.
CREATE TABLE kri_risks (
  tenant_id   uuid NOT NULL REFERENCES tenants (id),
  kri_id      uuid NOT NULL REFERENCES kris (id),
  risk_id     uuid NOT NULL REFERENCES risks (id),
  PRIMARY KEY (kri_id, risk_id)
);

CREATE INDEX kri_risks_risk_idx ON kri_risks (risk_id);

-- Append-only: one row per recorded value (ACT-133). No deleted_at —
-- consistent with kpi_measures/control_executions, append-only history
-- is never soft-deleted, only ever added to.
CREATE TABLE kri_measures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  kri_id        uuid NOT NULL REFERENCES kris (id),
  measure_date  date NOT NULL,
  value         double precision NOT NULL,
  source        text NOT NULL,
  comment       text,
  recorded_by   uuid NOT NULL REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Status calculation (ACT-134) and the history view (ACT-138) both want
-- "most recent first for this KRI" — measure_date desc, then created_at
-- desc as a tiebreaker for same-date corrections.
CREATE INDEX kri_measures_kri_date_idx ON kri_measures (kri_id, measure_date DESC, created_at DESC);
CREATE INDEX kri_measures_tenant_idx ON kri_measures (tenant_id);
