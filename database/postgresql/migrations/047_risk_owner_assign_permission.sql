-- B-0 (DECISION-025): designating a Risk Owner / N+1 now needs the
-- dedicated permission `risk.owner.assign`, no longer the widely-held
-- `risk.update`.
--
-- Grants it only to the admin tier (active roles holding `role.assign`)
-- and to roles named exactly "Risk Manager". Broader name patterns and the
-- `risk.delete` criterion were dropped after the security review
-- (SEC-B0-2): they could reach unrelated or contributor-level roles. The
-- Contributeur profile is excluded explicitly. Idempotent. The PO reviews
-- the list of roles before this migration reaches staging; any other role
-- that must designate owners is granted the permission by hand.

UPDATE roles
SET permissions = array_append(permissions, 'risk.owner.assign'),
    updated_at = now()
WHERE deleted_at IS NULL
  AND NOT ('risk.owner.assign' = ANY (permissions))
  AND name NOT ILIKE 'contributeur%'
  AND name NOT ILIKE 'contributor%'
  AND (
    'role.assign' = ANY (permissions)
    OR lower(trim(name)) = 'risk manager'
  );

-- Legacy direct grants (users.roles holds permission strings).
UPDATE users
SET roles = array_append(roles, 'risk.owner.assign')
WHERE NOT ('risk.owner.assign' = ANY (roles))
  AND 'role.assign' = ANY (roles);
