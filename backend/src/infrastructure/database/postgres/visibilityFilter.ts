import type { ReadScope } from "../../../domain/visibility.js";

/**
 * The single SQL point where resource visibility filters reads (DECISION-100, lot V0). No scope (internal reads, and
 * every caller not yet wired) or a "sees everything" scope adds nothing. Applied in the WHERE clause, never after the
 * fetch. `column` is a fixed identifier chosen by the repository, never user input.
 */
export function visibilityClause(scope: ReadScope | undefined, column = "visibility"): string {
  if (!scope || scope.all) return "";
  return `AND ${column} = 'CLIENT'`;
}
