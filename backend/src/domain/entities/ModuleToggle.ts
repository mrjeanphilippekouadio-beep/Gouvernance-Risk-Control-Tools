/**
 * ACT-221 — per-tenant on/off switch for a functional module, enforced
 * by api/middleware/moduleGuard.ts on the routes it's wired to in
 * server.ts.
 *
 * Fixed set of real, already-shipped modules rather than an open
 * string, matching Config's "small set of known keys" choice — no
 * hypothetical future modules added speculatively.
 */
export const MODULE_NAMES = [
  "RISK",
  "CONTROL",
  "KRI",
  "KPI",
  "DASHBOARD",
  "ANOMALY",
  "ACTION_PLAN",
  "EVIDENCE",
  "CARTOGRAPHY",
  /** Lot 4 (Audit module, 2026-09-30): gates /api/v1/audit-missions and /api/v1/findings, same as every other business module. */
  "AUDIT",
] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export interface ModuleToggle {
  id: string;
  tenantId: string;
  moduleName: ModuleName;
  enabled: boolean;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
