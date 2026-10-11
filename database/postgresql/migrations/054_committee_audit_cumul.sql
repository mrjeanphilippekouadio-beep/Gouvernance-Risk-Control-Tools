-- DECISION-042 §1 (q58): per-tenant setting "allow a user to be in both the Committee
-- and Audit groups". Allowed by default (current behaviour). Risk Manager + Audit stays
-- forbidden in code, whatever this column says.
-- Ne jamais appliquer à la main : passe par `npm run migrate`.

ALTER TABLE configs ADD COLUMN committee_audit_cumul_allowed boolean NOT NULL DEFAULT true;
