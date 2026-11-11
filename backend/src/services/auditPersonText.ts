/**
 * q251 / q273 (DECISION-130): free-text person fields (Department.manager / riskOwner, Process.owner, Kpi.owner,
 * Control.executor) hold a name or an e-mail. The journal never stores their value; when one changes, the new row only
 * says so (`<field>Changed: true`). Existing rows are untouched (append-only).
 */
export function auditWithoutPersonText<T extends object>(entity: T, fields: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(entity as Record<string, unknown>) };
  for (const f of fields) delete copy[f];
  return copy;
}

/** old/new pair for an update: values removed, a `<field>Changed: true` flag on the new side for each field that differs. */
export function auditPersonTextPair<T extends object>(
  before: T,
  after: T,
  fields: readonly string[],
): { oldValue: Record<string, unknown>; newValue: Record<string, unknown> } {
  const newValue = auditWithoutPersonText(after, fields);
  for (const f of fields) {
    if ((before as Record<string, unknown>)[f] !== (after as Record<string, unknown>)[f]) newValue[`${f}Changed`] = true;
  }
  return { oldValue: auditWithoutPersonText(before, fields), newValue };
}
