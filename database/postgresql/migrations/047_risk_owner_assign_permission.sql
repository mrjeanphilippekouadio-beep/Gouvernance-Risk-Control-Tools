-- B-0 (DECISION-025): designating a Risk Owner / N+1 now needs the
-- dedicated permission `risk.owner.assign`, no longer the widely-held
-- `risk.update`.
--
-- Grants it to the admin / Risk Manager tier: active roles that already
-- hold `risk.delete` (the archive power) or `role.assign`, or whose name
-- is an admin / Risk Manager one. The Contributeur profile is excluded
-- explicitly. Idempotent. Tenants with custom role names should be
-- reviewed by hand afterwards.

UPDATE roles
SET permissions = array_append(permissions, 'risk.owner.assign'),
    updated_at = now()
WHERE deleted_at IS NULL
  AND NOT ('risk.owner.assign' = ANY (permissions))
  AND name NOT ILIKE 'contributeur%'
  AND name NOT ILIKE 'contributor%'
  AND (
    'risk.delete' = ANY (permissions)
    OR 'role.assign' = ANY (permissions)
    OR name ILIKE '%admin%'
    OR name ILIKE '%risk manager%'
  );

-- Legacy direct grants (users.roles holds permission strings).
UPDATE users
SET roles = array_append(roles, 'risk.owner.assign')
WHERE NOT ('risk.owner.assign' = ANY (roles))
  AND ('risk.delete' = ANY (roles) OR 'role.assign' = ANY (roles));
