import type { ReadScope } from "../../../domain/visibility.js";

/**
 * The single SQL point where resource visibility filters reads (DECISION-100). The scope is mandatory (fail-closed,
 * SEC V0-01): only a "sees everything" scope — a fixed group, or SYSTEM_SCOPE for a server-internal read — adds nothing.
 * Applied in the WHERE clause, never after the fetch. `column` / aliases are fixed identifiers chosen by the repository,
 * never user input.
 *
 * Roots other than risks (controls, anomalies, action plans, KPIs) cannot be restricted before lot V2: a non-"all"
 * reader sees their CLIENT rows only.
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
