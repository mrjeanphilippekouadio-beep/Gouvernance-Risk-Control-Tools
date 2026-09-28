-- ACT-084: "Importer le logo client" — tenant branding. One logo per
-- tenant, in-place update, so this is a handful of nullable columns on
-- the existing `tenants` table rather than a new one (mirrors
-- drive_folder_id from migration 006). logo_updated_by intentionally has
-- no FK: the users table is tenant-scoped and this migration doesn't
-- need to join against it, matching the loosely-typed *_by columns used
-- elsewhere for actor references outside a hard entity relationship.
ALTER TABLE tenants
  ADD COLUMN logo_drive_file_id text,
  ADD COLUMN logo_url text,
  ADD COLUMN logo_updated_at timestamptz,
  ADD COLUMN logo_updated_by uuid;
