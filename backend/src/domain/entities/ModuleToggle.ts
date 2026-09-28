/**
 * ACT-221 — per-tenant on/off switch for a functional module. Storage
 * only: this batch does NOT add route-blocking middleware that checks
 * this table on every request (that touches server.ts and every route
 * file — out of scope here, see ModuleToggleService's file header).
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
