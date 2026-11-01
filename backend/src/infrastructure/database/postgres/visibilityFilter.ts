import type { ReadScope } from "../../../domain/visibility.js";

/**
 * The single SQL point where resource visibility filters reads (DECISION-100). The scope is mandatory (fail-closed,
 * SEC V0-01): only a "sees everything" scope — a fixed group, or SYSTEM_SCOPE for a server-internal read — adds nothing.
 * Applied in the WHERE clause, never after the fetch. `column` / aliases are fixed identifiers chosen by the repository,
 * never user input.
 *
 * Kept for a root without its own `*_visible_to` function: a non-"all" reader sees its CLIENT rows only. Since lot V2,
 * controls, anomalies, action plans and KPIs use `resourceVisibilityClause`.
 */
export function visibilityClause(scope: ReadScope, column = "visibility"): string {
  if (scope.all) return "";
  return `AND ${column} = 'CLIENT'`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The reader's id as a SQL literal. It comes from the authenticated identity; anything not a strict uuid is refused. */
function readerLiteral(userId: string): string {
  if (!UUID.test(userId)) throw new Error("visibility: reader id is not a uuid");
  return `'${userId}'::uuid`;
}

/**
 * Lot V1: a risk row (alias `a`, e.g. "r." or "") is readable when it is CLIENT or when `risk_visible_to` (migration
 * 082) admits the reader through the perimeter or the list. Without a reader id: CLIENT rows only.
 */
export function riskVisibilityClause(scope: ReadScope, alias = ""): string {
  if (scope.all) return "";
  if (!scope.userId) return `AND ${alias}visibility = 'CLIENT'`;
  return `AND (${alias}visibility = 'CLIENT' OR risk_visible_to(${alias}tenant_id, ${alias}id, ${readerLiteral(scope.userId)}))`;
}

/**
 * Lot V1 (q193): rows that inherit from a risk (evaluations, treatment decisions, escalations, KRIs, KRI measures) are
 * readable only when their risk is. `riskIdExpr` / `tenantExpr` are fixed column expressions of the child row. A child
 * without a risk (`riskIdExpr` NULL) is not restricted by this clause.
 */
export function riskChildVisibilityClause(scope: ReadScope, riskIdExpr: string, tenantExpr: string): string {
  if (scope.all) return "";
  const readable = scope.userId
    ? `(vr.visibility = 'CLIENT' OR risk_visible_to(vr.tenant_id, vr.id, ${readerLiteral(scope.userId)}))`
    : `vr.visibility = 'CLIENT'`;
  return `AND (${riskIdExpr} IS NULL OR EXISTS (SELECT 1 FROM risks vr WHERE vr.tenant_id = ${tenantExpr} AND vr.id = ${riskIdExpr} AND ${readable}))`;
}

/** Lot V2: the roots restrictable besides risks, with their SQL function (migration 083). */
export type RestrictableRoot = "CONTROL" | "ANOMALY" | "ACTION_PLAN" | "KPI";
const VISIBLE_TO: Record<RestrictableRoot, string> = {
  CONTROL: "control_visible_to",
  ANOMALY: "anomaly_visible_to",
  ACTION_PLAN: "action_plan_visible_to",
  KPI: "kpi_visible_to",
};

/**
 * Lot V2: the row (alias `a`, e.g. "c." or "") is readable when `<root>_visible_to` (migration 083) admits the reader.
 * Anomalies and action plans inherit from their risk / control / KRI, so their own `visibility = 'CLIENT'` is not enough:
 * the function decides for every row. Without a reader id, the function is called with NULL: only rows that are CLIENT
 * all the way up are readable.
 */
export function resourceVisibilityClause(root: RestrictableRoot, scope: ReadScope, alias = ""): string {
  if (scope.all) return "";
  const reader = scope.userId ? readerLiteral(scope.userId) : "NULL::uuid";
  const call = `${VISIBLE_TO[root]}(${alias}tenant_id, ${alias}id, ${reader})`;
  return root === "CONTROL" || root === "KPI" ? `AND (${alias}visibility = 'CLIENT' OR ${call})` : `AND ${call}`;
}

/** Lot V2: SQL expression `<root>_visible_to(tenant, id, reader)` for fixed column expressions (children, counts). */
export function resourceVisibleExpr(root: RestrictableRoot, scope: ReadScope, tenantExpr: string, idExpr: string): string {
  if (scope.all) return "true";
  const reader = scope.userId ? readerLiteral(scope.userId) : "NULL::uuid";
  return `${VISIBLE_TO[root]}(${tenantExpr}, ${idExpr}, ${reader})`;
}

/** The SQL function name of a root (used by the access repository for its effective-reader sets). */
export function visibleToFunction(root: RestrictableRoot | "RISK"): string {
  return root === "RISK" ? "risk_visible_to" : VISIBLE_TO[root];
}
