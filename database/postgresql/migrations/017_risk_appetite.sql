-- ACT-165/ACT-168 — risk appetite thresholds per risk sub-category,
-- optionally scoped to an entity. Updated in place (like departments/
-- processes): one row per (tenant, sub_category, entity), redefined via
-- PUT rather than historized.
--
-- ACT-166 (auto-compare a residual risk score to the applicable
-- threshold) and ACT-167 (breach alert) are deliberately NOT covered by
-- this migration — they depend on a RiskEvaluation table (residual risk
-- scores) that doesn't exist yet in this schema. Do not bolt a
-- minimal/ad-hoc version of that table onto this migration; it's an
-- Architecture (A05) decision.

CREATE TABLE risk_appetites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants (id),
  sub_category          text NOT NULL,
  entity                text,
  threshold             integer NOT NULL CHECK (threshold BETWEEN 1 AND 25),
  methodology_version   text NOT NULL,
  description           text,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES users (id),
  deletion_reason       text
);

-- `entity` is optional (a threshold can apply tenant-wide). Postgres
-- unique indexes treat every NULL as distinct, so a plain
-- UNIQUE (tenant_id, sub_category, entity) would silently allow more
-- than one tenant-wide row for the same sub-category. COALESCE to '' in
-- the index (and in the ON CONFLICT arbiter in
-- PostgresRiskAppetiteRepository.upsert) closes that gap.
CREATE UNIQUE INDEX risk_appetites_tenant_subcategory_entity_idx
  ON risk_appetites (tenant_id, sub_category, COALESCE(entity, ''))
  WHERE deleted_at IS NULL;

CREATE INDEX risk_appetites_tenant_active_idx
  ON risk_appetites (tenant_id, active)
  WHERE deleted_at IS NULL;
