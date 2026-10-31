import type { ReadScope } from "../../../domain/visibility.js";

/**
 * The single SQL point where resource visibility filters reads (DECISION-100, lot V0). The scope is mandatory
 * (fail-closed, SEC V0-01): only a "sees everything" scope — a fixed group, or SYSTEM_SCOPE for a server-internal read —
 * adds nothing. Applied in the WHERE clause, never after the fetch. `column` is a fixed identifier chosen by the
 * repository, never user input.
 */
export function visibilityClause(scope: ReadScope, column = "visibility"): string {
  if (scope.all) return "";
  return `AND ${column} = 'CLIENT'`;
}
