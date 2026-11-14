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

type Db = Pick<Pool, "query">;

/** Sources whose effect a later reason of the SAME source on the same entity replaces (L2b, I-1). */
export const REPLACED_BY_SAME_SOURCE: readonly VisibilityReasonSource[] = ["VISIBILITY_CHANGE", "ACCESS_RENEWAL", "PERIMETER_CHANGE"];

/**
 * Conservation L2b (I-1): ends, now and in the caller's transaction, the effect of the reasons of the given sources already
 * named by the audit rows of one entity (never `exceptId`, never one already ended). clock_timestamp(): never before the reason.
 */
export async function endReasonsOfEntity(
  db: Db, tenantId: string, entityType: string, entityId: string, sources: readonly VisibilityReasonSource[], exceptId: string | null,
): Promise<void> {
  await db.query(
    `UPDATE public.visibility_reasons SET effect_ended_at = clock_timestamp()
     WHERE tenant_id = $1 AND effect_ended_at IS NULL AND source = ANY($4::text[]) AND ($5::uuid IS NULL OR id <> $5)
       AND id IN (SELECT a.reason_ref FROM public.audit_log a
                  WHERE a.tenant_id = $1 AND a.entity_type = $2 AND a.entity_id = $3 AND a.reason_ref IS NOT NULL)`,
    [tenantId, entityType, entityId, sources, exceptId],
  );
}

/** Ends the effect of one reason by id (the reason of a return to « tout le client » justifies nothing lasting). */
export async function endReason(db: Db, tenantId: string, reasonId: string): Promise<void> {
  await db.query(
    `UPDATE public.visibility_reasons SET effect_ended_at = clock_timestamp() WHERE tenant_id = $1 AND id = $2 AND effect_ended_at IS NULL`,
    [tenantId, reasonId],
  );
}

/** Refusal or revocation of a widened-view request: the three reasons of the grant (request, decision, revocation) end. */
export async function endGrantReasons(db: Db, tenantId: string, grantId: string): Promise<void> {
  await db.query(
    `UPDATE public.visibility_reasons vr SET effect_ended_at = clock_timestamp()
     FROM public.sensitive_view_grants g
     WHERE g.tenant_id = $1 AND g.id = $2 AND vr.tenant_id = g.tenant_id AND vr.effect_ended_at IS NULL
       AND vr.id IN (g.reason_ref, g.decision_reason_ref, g.revoke_reason_ref)`,
    [tenantId, grantId],
  );
}

/** Back to « tout le client »: the restriction is gone, so is the effect of every reason that justified it. */
export async function endAllOnReturnToClient(db: Db, tenantId: string, entityType: string, entityId: string, newReasonId: string): Promise<void> {
  await endReasonsOfEntity(db, tenantId, entityType, entityId, REPLACED_BY_SAME_SOURCE, null);
  await endReason(db, tenantId, newReasonId);
}
