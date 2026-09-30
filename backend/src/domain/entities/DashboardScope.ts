/**
 * @architect design, 2026-09-30 ("Conception du scope configurable
 * dashboard.executive via RACI", .claude/agent-context/ACTION_ITEMS.md),
 * PO arbitrations relayed in the same entry. `dashboard.executive` moves
 * from a binary tenant-wide permission to a configurable perimeter
 * derived from RACI + Risk.ownerId, resolved at read time
 * (DashboardScopeResolver) and never stored as a computed perimeter.
 *
 * Seed rule (PO, precise — not the simple binary first proposed):
 *   - R (Réalisateur) and A (Approbateur) widen the WHOLE perimeter —
 *     an entire department (DEPARTMENT mode) or every process of that
 *     department (PROCESS mode).
 *   - C (Consulté) and I (Informé) stay limited to the PROCESS level
 *     only, even in DEPARTMENT mode — a simple I/C on a risk grants
 *     access to the risks of the *processes* the person actually works
 *     on via that RACI role, never to the whole department. PO's own
 *     words: "informé peut donner accès au risque de tous les processus
 *     sur lesquelles nous travaillons mais pas tous les risques du
 *     département."
 *
 * DEPARTMENT mode therefore carries BOTH `departmentIds` (from R/A) AND
 * `processIds` (from C/I, narrow) — it is the union of "every risk in
 * one of these departments" OR "every risk in one of these processes",
 * not a single flat department list.
 */
export type DashboardScopeMode = "GLOBAL" | "DEPARTMENT" | "PROCESS";

/** Runtime mirror of DashboardScopeMode, for Zod enums / DB CHECK lists without duplicating the literal array. */
export const DASHBOARD_SCOPE_MODES: readonly DashboardScopeMode[] = ["GLOBAL", "DEPARTMENT", "PROCESS"];

export type RiskScope =
  | { mode: "GLOBAL" }
  | { mode: "DEPARTMENT"; departmentIds: string[]; processIds: string[] }
  | { mode: "PROCESS"; processIds: string[] };

/**
 * Multi-role rule (PO): the widest scope wins — GLOBAL > DEPARTMENT >
 * PROCESS. Pure, no I/O, trivially unit-testable in isolation. Returns
 * "PROCESS" (the narrowest) for an empty input — callers holding zero
 * roles should never be widened by default; DashboardScopeResolver
 * treats "no roles at all" as its own case, not this function's.
 */
export function widestScopeMode(modes: DashboardScopeMode[]): DashboardScopeMode {
  if (modes.includes("GLOBAL")) return "GLOBAL";
  if (modes.includes("DEPARTMENT")) return "DEPARTMENT";
  return "PROCESS";
}
