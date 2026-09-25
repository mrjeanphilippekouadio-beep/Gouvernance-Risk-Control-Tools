/**
 * Builds `col = $n` clauses only for fields the caller actually provided
 * (value !== undefined) — used instead of `COALESCE($n, col)` because
 * COALESCE can't tell "field omitted" from "field explicitly set to
 * null", so a caller can never clear a nullable column that way.
 */
export function buildUpdateSet(
  fields: Record<string, unknown>,
  startIndex: number,
): { setClauses: string[]; values: unknown[] } {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    setClauses.push(`${column} = $${i}`);
    values.push(value);
    i++;
  }
  return { setClauses, values };
}
