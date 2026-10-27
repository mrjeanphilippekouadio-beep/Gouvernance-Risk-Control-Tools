-- DECISION-083 (q168, q169, q174): three per-tenant governance delays, in days. NULL = not configured
-- (no delay applies): the values are set by the tenant at configuration time, never invented here.
--   exception_review_delay_days : q168, an action applied without independent validation should be reviewed within it.
--   acceptance_max_days         : q169, longest duration of a principle acceptance.
--   policy_request_expiry_days  : q174, a pending self-validation relaxation request expires after it.
-- Dedicated administrator permission config.governancedelays.set (granted below to existing administrator roles,
-- same criteria as 069 / 071).
-- Ne jamais appliquer à la main : passe par `npm run migrate`.

ALTER TABLE configs
  ADD COLUMN exception_review_delay_days integer CHECK (exception_review_delay_days BETWEEN 1 AND 3650),
  ADD COLUMN acceptance_max_days integer CHECK (acceptance_max_days BETWEEN 1 AND 3650),
  ADD COLUMN policy_request_expiry_days integer CHECK (policy_request_expiry_days BETWEEN 1 AND 3650);

-- q174: the expiry is fixed when a request is submitted (F-SAD-02), never recomputed from a delay changed later.
ALTER TABLE self_validation_policy_requests ADD COLUMN expires_at timestamptz;

UPDATE roles
SET permissions = ARRAY(SELECT DISTINCT unnest(permissions || ARRAY['config.governancedelays.set']::text[]))
WHERE system_group IS NULL AND deleted_at IS NULL
  AND permissions && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage'
  ]::text[];

UPDATE users
SET roles = ARRAY(SELECT DISTINCT unnest(roles || ARRAY['config.governancedelays.set']::text[]))
WHERE roles && ARRAY[
    'role.create', 'role.update', 'role.delete', 'role.assign',
    'user.create', 'user.update', 'user.delete', 'user.reactivate',
    'rolegroup.audit.update', 'config.cumul.set', 'config.committeeenforcement.set', 'config.manage',
    'config.selfvalidation.set', 'designation.manage'
  ]::text[];
