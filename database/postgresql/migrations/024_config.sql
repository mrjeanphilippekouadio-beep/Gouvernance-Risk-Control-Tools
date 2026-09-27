-- ACT-220 to ACT-226 — Config domain module. Storage/CRUD only: nothing
-- in this migration is read yet by RatingScaleService/RiskEvaluationService
-- (see backend/src/services/ConfigService.ts's file header for the exact
-- list of what's deliberately not wired this batch).

-- ACT-220/ACT-226: one row per tenant, updated in place. `version`
-- increments on every write (buildUpdateSet + explicit `version = version + 1`
-- in PostgresConfigRepository.upsert) — full before/after history lives
-- in audit_logs, not in this table, matching RoleService.update's
-- PERMISSION_CHANGE pattern.
CREATE TABLE configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants (id),
  score_formula       text NOT NULL DEFAULT 'P_X_I'
                        CHECK (score_formula IN ('P_X_I', 'WEIGHTED_SUM')),
  level_thresholds    jsonb NOT NULL DEFAULT '[]'::jsonb,
  impact_retenu_rule  text NOT NULL DEFAULT 'MAX'
                        CHECK (impact_retenu_rule IN ('MAX', 'AVERAGE', 'WEIGHTED_SUM')),
  appetite_mode       text NOT NULL DEFAULT 'AUTO_AVEC_SURCHARGE_MANUELLE'
                        CHECK (appetite_mode IN ('AUTO', 'MANUEL', 'AUTO_AVEC_SURCHARGE_MANUELLE')),
  version             integer NOT NULL DEFAULT 0,
  updated_by          uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

-- ACT-221: which modules are toggled off per tenant. A module absent
-- from this table defaults to enabled — see ModuleToggleService.list.
-- No route-blocking enforcement is added by this migration or its
-- backend counterpart; that's a follow-up touching server.ts and every
-- route file.
CREATE TABLE module_toggles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  module_name   text NOT NULL
                  CHECK (module_name IN ('RISK', 'CONTROL', 'KRI', 'KPI', 'DASHBOARD', 'ANOMALY', 'ACTION_PLAN', 'EVIDENCE', 'CARTOGRAPHY')),
  enabled       boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module_name)
);

-- ACT-222: extends the existing `tenants` table (002_tenants_and_users.sql)
-- with what TenantService needs to create/patch an entity — an on/off
-- flag ("désactiver une entité multi-tenant") and a timestamp for
-- buildUpdateSet's `updated_at = now()`.
ALTER TABLE tenants ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE tenants ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- ACT-223: regulatory framework registry (BCEAO, ISO 31000, COSO ERM,
-- DORA...). No FK to controls/reports yet — see RegulatoryFramework.ts.
CREATE TABLE regulatory_frameworks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  name          text NOT NULL,
  description   text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ACT-224: risk category / sub-category taxonomy. `parent_id IS NULL` is
-- a top-level category; a category cannot be its own parent (RiskCategoryService
-- enforces that in the service layer, not via a CHECK, since Postgres
-- can't self-reference a not-yet-inserted row's own id in a CHECK).
-- Deliberately NOT a foreign key target from risk_appetites.sub_category
-- or risk_evaluations.sub_category (both stay free text) — see RiskCategory.ts.
CREATE TABLE risk_categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants (id),
  name          text NOT NULL,
  parent_id     uuid REFERENCES risk_categories (id),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_categories_tenant_parent_idx ON risk_categories (tenant_id, parent_id);

-- ACT-225 (Excel import of Risk records) intentionally has no table here
-- — RiskImportService is stateless: preview/commit both re-parse the
-- uploaded file per request rather than persisting an import job. See
-- RiskImportService.ts.
