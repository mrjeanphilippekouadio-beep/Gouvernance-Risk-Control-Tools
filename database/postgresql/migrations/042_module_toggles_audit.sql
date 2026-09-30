-- Lot 4 (Audit module): widen module_toggles.module_name's CHECK
-- constraint to accept 'AUDIT', per ModuleToggle.ts's MODULE_NAMES —
-- gates /api/v1/audit-missions and /api/v1/findings the same way every
-- other business module is gated (moduleGuard in server.ts). Expand-only:
-- no existing value removed, no data touched.

ALTER TABLE module_toggles DROP CONSTRAINT module_toggles_module_name_check;
ALTER TABLE module_toggles ADD CONSTRAINT module_toggles_module_name_check
  CHECK (module_name IN ('RISK', 'CONTROL', 'KRI', 'KPI', 'DASHBOARD', 'ANOMALY', 'ACTION_PLAN', 'EVIDENCE', 'CARTOGRAPHY', 'AUDIT'));
