import type { Pool } from "pg";
import type { VisibilityReasonSource } from "../../../domain/entities/VisibilityReason.js";

/** Conservation L2a (migration 096): stores the text of a visibility reason and returns its reference. */
export async function insertVisibilityReason(
  db: Pick<Pool, "query">,
  tenantId: string,
  source: VisibilityReasonSource,
  text: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.visibility_reasons (tenant_id, source, text) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, source, text],
  );
  return rows[0]!.id;
}

/**
 * SELECT list that reads a stored reason through a reference column without adding a FROM item (the unqualified columns of
 * the main query stay unambiguous). Yields `<alias>_text` and `<alias>_erased_at`.
 */
export function reasonColumns(tenantCol: string, refCol: string, alias: string): string {
  return `(SELECT vr.text FROM public.visibility_reasons vr WHERE vr.tenant_id = ${tenantCol} AND vr.id = ${refCol}) AS ${alias}_text,
          (SELECT vr.erased_at FROM public.visibility_reasons vr WHERE vr.tenant_id = ${tenantCol} AND vr.id = ${refCol}) AS ${alias}_erased_at`;
}
