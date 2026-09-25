-- Each tenant's evidence lives in its own Drive folder, resolved once
-- here rather than passed around by the domain (ADR-001 §"le GRC ne
-- doit pas dépendre de la structure des dossiers Drive").
ALTER TABLE tenants ADD COLUMN drive_folder_id text;
