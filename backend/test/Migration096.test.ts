import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { PostgresSensitiveViewGrantRepository } from "../src/infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.js";
import { visibilityReasonOf } from "../src/domain/entities/VisibilityReason.js";

/**
 * Conservation L2a (migration 096), level 1 on a real local database: MIG096_LIVE=1 MIG096_DB=grc_... (127.0.0.1:55442). Never Neon.
 * Guard of visibility_reasons, journal written with a reference (no text in audit_log.reason), readers joining the text or the
 * erasure wording, grant reasons stored apart.
 */
const live = process.env["MIG096_LIVE"] === "1" && /^grc_/.test(process.env["MIG096_DB"] ?? "");

describe.skipIf(!live)("096 on a real local database", () => {
  let pool: Pool;
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const refused = async (sql: string, p: unknown[] = []) => pool.query(sql, p).then(() => null, (e: Error) => e.message);
  beforeAll(() => { pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG096_PORT"] ?? 55442), user: "postgres", database: process.env["MIG096_DB"]!, max: 3 }); });
  afterAll(async () => { await pool?.end(); });

  const world = async () => {
    const t = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T096-${randomUUID().slice(0, 8)}`]))[0]!["id"] as string;
    const user = async () => (await q(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [t, `u-${randomUUID()}@x.test`]))[0]!["id"] as string;
    return { t, a: await user(), b: await user(), c: await user() };
  };
  const reason = async (t: string, text = "Motif de test") =>
    (await q(`INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, 'VISIBILITY_CHANGE', $2) RETURNING id`, [t, text]))[0]!["id"] as string;

  it("guard: text erased once and never restored, dates only forward, no delete, no truncate, identity immutable", async () => {
    const { t } = await world();
    const id = await reason(t);
    expect(await refused(`INSERT INTO visibility_reasons (tenant_id, source, text, erased_at) VALUES ($1, 's', NULL, now())`, [t])).toMatch(/inserted with its text/);
    expect(await refused(`UPDATE visibility_reasons SET text = 'autre' WHERE id = $1`, [id])).toMatch(/erased once/);
    expect(await refused(`UPDATE visibility_reasons SET effect_ended_at = now() WHERE id = $1`, [id])).toBeNull();
    expect(await refused(`UPDATE visibility_reasons SET effect_ended_at = now() - interval '1 day' WHERE id = $1`, [id])).toMatch(/only set or advanced/);
    expect(await refused(`UPDATE visibility_reasons SET effect_ended_at = NULL WHERE id = $1`, [id])).toMatch(/only set or advanced/);
    expect(await refused(`UPDATE visibility_reasons SET reviewed_at = now() WHERE id = $1`, [id])).toBeNull();
    expect(await refused(`UPDATE visibility_reasons SET source = 'autre' WHERE id = $1`, [id])).toMatch(/immutable/);
    expect(await refused(`UPDATE visibility_reasons SET tenant_id = $2 WHERE id = $1`, [id, (await world()).t])).toMatch(/immutable/);
    expect(await refused(`UPDATE visibility_reasons SET text = NULL WHERE id = $1`, [id])).toMatch(/check constraint/); // erasure needs erased_at
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = $1`, [id])).toBeNull();
    expect(await refused(`UPDATE visibility_reasons SET text = 'retour' WHERE id = $1`, [id])).toMatch(/erased once/);
    expect(await refused(`UPDATE visibility_reasons SET erased_at = now() WHERE id = $1`, [id])).toMatch(/erased once|check constraint/);
    expect(await refused(`DELETE FROM visibility_reasons WHERE id = $1`, [id])).toMatch(/never deleted/);
    expect(await refused(`TRUNCATE visibility_reasons`)).not.toBeNull();
  });

  it("audit: a visibility reason is stored apart; audit_log.reason stays null; the consultation reads the text, then the erasure wording", async () => {
    const { t, a } = await world();
    const audit = new PostgresAuditRepository(pool);
    const entityId = randomUUID();
    await audit.record({ tenantId: t, userId: a, entityType: "Risk", entityId, action: "PERMISSION_CHANGE", oldValue: null, newValue: null, requestId: "r1",
      ...visibilityReasonOf("VISIBILITY_CHANGE", "Dossier sensible") });
    const raw = (await q(`SELECT reason, reason_ref FROM audit_log WHERE entity_id = $1`, [entityId]))[0]!;
    expect(raw["reason"]).toBeNull();
    expect(raw["reason_ref"]).not.toBeNull();
    expect((await audit.listRecent(t, 10))[0]).toMatchObject({ reason: "Dossier sensible", reasonRef: raw["reason_ref"] });
    await q(`UPDATE visibility_reasons SET text = NULL, erased_at = '2026-11-13T10:00:00Z' WHERE id = $1`, [raw["reason_ref"]]);
    expect((await audit.search(t, { entityId }, 10))[0]!.reason).toBe("motif effacé le 13/11/2026 (conservation)");
  });

  it("listRestricted reads the last change's reason through its reference, and shows the erasure wording once erased", async () => {
    const { t, a } = await world();
    const risk = (await q(`INSERT INTO risks (tenant_id, process, description, visibility) VALUES ($1, 'p', 'Risque restreint', 'NOMINATIF') RETURNING id`, [t]))[0]!["id"] as string;
    await new PostgresAuditRepository(pool).record({ tenantId: t, userId: a, entityType: "Risk", entityId: risk, action: "PERMISSION_CHANGE", oldValue: null, newValue: { widening: false },
      requestId: "r", ...visibilityReasonOf("VISIBILITY_CHANGE", "Motif liste") });
    const repo = new PostgresResourceAccessRepository(pool);
    expect((await repo.listRestricted(t))[0]!.lastChange).toMatchObject({ reason: "Motif liste", widening: false });
    await q(`UPDATE visibility_reasons SET text = NULL, erased_at = '2026-11-13T10:00:00Z' WHERE tenant_id = $1`, [t]);
    expect((await repo.listRestricted(t))[0]!.lastChange!.reason).toBe("motif effacé le 13/11/2026 (conservation)");
  });

  it("sensitive view grant: request, decision and revocation reasons are stored apart and read back through the join", async () => {
    const { t, a, b, c } = await world();
    const grants = new PostgresSensitiveViewGrantRepository(pool);
    const created = await grants.create({ tenantId: t, userId: b, reason: "Demande QA", requestedBy: a, expiresAt: null }, (g) => [{
      tenantId: t, userId: a, entityType: "SensitiveViewGrant", entityId: g.id, action: "SUBMIT", oldValue: null, newValue: null, requestId: "r",
      ...visibilityReasonOf("SENSITIVE_VIEW_REQUEST", "Demande QA", g.reasonRef) }]);
    expect(created).toMatchObject({ reason: "Demande QA" });
    expect((await q(`SELECT reason, reason_ref FROM sensitive_view_grants WHERE id = $1`, [created.id]))[0]).toMatchObject({ reason: null });
    const decided = await grants.decide(t, created.id, { status: "APPROVED", by: c, reason: "Accord QA" }, () => []);
    expect(decided).toMatchObject({ decisionReason: "Accord QA", reason: "Demande QA" });
    const revoked = await grants.revoke(t, created.id, { by: a, reason: "Retrait QA" }, () => []);
    expect(revoked).toMatchObject({ status: "REVOKED", revokeReason: "Retrait QA", decisionReason: "Accord QA" });
    const row = (await q(`SELECT reason, decision_reason, revoke_reason, reason_ref, decision_reason_ref, revoke_reason_ref FROM sensitive_view_grants WHERE id = $1`, [created.id]))[0]!;
    expect([row["reason"], row["decision_reason"], row["revoke_reason"]]).toEqual([null, null, null]);
    expect([row["reason_ref"], row["decision_reason_ref"], row["revoke_reason_ref"]].every((r) => typeof r === "string")).toBe(true);
    expect(await refused(`UPDATE sensitive_view_grants SET reason_ref = $2 WHERE id = $1`, [created.id, row["revoke_reason_ref"]])).toMatch(/immutable/);
  });

  it("resource_access_grants: a grant keeps its reason by text (technical constant) or by reference, never neither; the references are immutable", async () => {
    const { t, a, b } = await world();
    const rid = randomUUID();
    const id1 = await reason(t);
    expect(await refused(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by) VALUES ($1, 'RISK', $2, $3, $4)`, [t, rid, b, a])).toMatch(/rag_grant_reason_present_check/);
    // SEC-L2A-02: the old text columns refuse a free text; only the technical creation constant stays allowed.
    const text = (col: string, value: string) => refused(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason_ref, ${col}) VALUES ($1, 'RISK', $2, $3, $4, $5, $6)`, [t, randomUUID(), b, a, id1, value]);
    expect(await text("grant_reason", "texte libre")).toMatch(/rag_reason_text_check/);
    expect(await text("grant_reason", "Accès accordé à la création du risque")).toBeNull();
    expect(await refused(`INSERT INTO sensitive_view_grants (tenant_id, user_id, reason, reason_ref, requested_by) VALUES ($1, $2, 'texte libre', $3, $4)`, [t, b, id1, a])).toMatch(/svg_reason_text_check/);
    const grant = (await q(`INSERT INTO resource_access_grants (tenant_id, resource_type, resource_id, user_id, granted_by, grant_reason_ref) VALUES ($1, 'RISK', $2, $3, $4, $5) RETURNING id`, [t, rid, b, a, id1]))[0]!["id"] as string;
    expect(await refused(`UPDATE resource_access_grants SET grant_reason_ref = $2 WHERE id = $1`, [grant, await reason(t)])).toMatch(/immutable/);
    expect(await refused(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2 WHERE id = $1`, [grant, a])).toMatch(/rag_revocation_shape_check/);
    expect(await refused(`UPDATE resource_access_grants SET revoked_at = now(), revoked_by = $2, revoke_reason_ref = $3 WHERE id = $1`, [grant, a, await reason(t)])).toBeNull();
  });
});
