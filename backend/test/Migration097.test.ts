import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresProcessRepository } from "../src/infrastructure/database/postgres/PostgresProcessRepository.js";
import { PostgresRoleRepository } from "../src/infrastructure/database/postgres/PostgresRoleRepository.js";
import { PostgresRiskRepository } from "../src/infrastructure/database/postgres/PostgresRiskRepository.js";
import { PostgresSensitiveViewGrantRepository } from "../src/infrastructure/database/postgres/PostgresSensitiveViewGrantRepository.js";
import { PostgresVisibilityReasonRetentionRepository } from "../src/infrastructure/database/postgres/PostgresVisibilityReasonRetentionRepository.js";
import { visibilityReasonOf } from "../src/domain/entities/VisibilityReason.js";

/**
 * Conservation L2b (migration 097), level 1 on a real local database: MIG097_LIVE=1 MIG097_DB=grc_... (127.0.0.1:55442). Never Neon.
 * Fail-closed guard of visibility_reasons, end-of-effect events, manual erasure.
 */
const live = process.env["MIG097_LIVE"] === "1" && /^grc_/.test(process.env["MIG097_DB"] ?? "");

describe.skipIf(!live)("097 on a real local database", () => {
  let pool: Pool;
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const refused = async (sql: string, p: unknown[] = []) => pool.query(sql, p).then(() => null, (e: Error) => e.message);
  beforeAll(() => { pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG097_PORT"] ?? 55442), user: "postgres", database: process.env["MIG097_DB"]!, max: 3 }); });
  afterAll(async () => { await pool?.end(); });

  const world = async () => {
    const t = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`T097-${randomUUID().slice(0, 8)}`]))[0]!["id"] as string;
    const user = async () => (await q(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [t, `u-${randomUUID()}@x.test`]))[0]!["id"] as string;
    return { t, a: await user(), b: await user(), c: await user() };
  };
  const reason = async (t: string, source = "VISIBILITY_CHANGE") =>
    (await q(`INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, $2, 'Motif de test') RETURNING id`, [t, source]))[0]!["id"] as string;
  const ended = async (id: string) => (await q(`SELECT effect_ended_at FROM visibility_reasons WHERE id = $1`, [id]))[0]!["effect_ended_at"] as Date | null;
  /** Backdates a date (owner session, triggers off): the only way to age a reason in a test. */
  const age = async (id: string, endedDaysAgo: number) => {
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`UPDATE visibility_reasons SET created_at = now() - make_interval(days => $2 + 1), effect_ended_at = now() - make_interval(days => $2) WHERE id = $1`, [id, endedDaysAgo]);
    } finally { await c.query(`RESET session_replication_role`); c.release(); }
  };

  it("guard INSERT: created_at is set by the database, effect_ended_at / reviewed_at / erased_at must be NULL", async () => {
    const { t } = await world();
    const row = (await q(`INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES ($1, 's', 'x', '2000-01-01') RETURNING created_at`, [t]))[0]!;
    expect((row["created_at"] as Date).getFullYear()).toBeGreaterThan(2020);
    for (const col of ["effect_ended_at", "reviewed_at"]) {
      expect(await refused(`INSERT INTO visibility_reasons (tenant_id, source, text, ${col}) VALUES ($1, 's', 'x', now())`, [t])).toMatch(/inserted with its text, active/);
    }
  });

  it("guard UPDATE: no future date, no end before the creation, erasure only after effect end + retention (fail-closed)", async () => {
    const { t } = await world();
    const id = await reason(t);
    // SEC-L2B-01/02: no date chosen by the caller; the database writes its own clock.
    expect(await refused(`UPDATE visibility_reasons SET reviewed_at = '2001-01-01' WHERE id = $1`, [id])).toBeNull();
    const rv = (await q(`SELECT reviewed_at FROM visibility_reasons WHERE id = $1`, [id]))[0]!["reviewed_at"] as Date;
    expect(Date.now() - rv.getTime()).toBeLessThan(60_000);
    // effect not ended: no erasure, however old
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = $1`, [id])).toMatch(/effect has ended/);
    // a backdated end (to the creation, or to 2000) is stored as « now »: the retention cannot be skipped
    expect(await refused(`UPDATE visibility_reasons SET effect_ended_at = '2000-01-01' WHERE id = $1`, [id])).toBeNull();
    expect(Date.now() - (await ended(id))!.getTime()).toBeLessThan(60_000);
    // ended just now: the retention has not elapsed (no configs row = 365)
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = $1`, [id])).toMatch(/retention period/);
    expect(await refused(`UPDATE visibility_reasons SET erased_at = now() + interval '1 day', text = NULL WHERE id = $1`, [id])).not.toBeNull();
    await age(id, 364);
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = $1`, [id])).toMatch(/retention period/);
    await age(id, 366);
    // tenant retention NULL = never
    await q(`INSERT INTO configs (tenant_id, visibility_reason_retention_days) VALUES ($1, NULL)`, [t]).catch(() => q(`UPDATE configs SET visibility_reason_retention_days = NULL WHERE tenant_id = $1`, [t]));
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = now() WHERE id = $1`, [id])).toMatch(/retention period/);
    await q(`UPDATE configs SET visibility_reason_retention_days = 365 WHERE tenant_id = $1`, [t]);
    expect(await refused(`UPDATE visibility_reasons SET text = NULL, erased_at = '2001-01-01' WHERE id = $1`, [id])).toBeNull();
    const er = (await q(`SELECT erased_at FROM visibility_reasons WHERE id = $1`, [id]))[0]!["erased_at"] as Date;
    expect(Date.now() - er.getTime()).toBeLessThan(60_000);
  });

  it("SEC-L2B-04: the runtime role cannot DELETE a setting", async () => {
    expect((await q(`SELECT has_table_privilege('grc_app_runtime', 'public.configs', 'DELETE') AS p`))[0]!["p"]).toBe(false);
  });

  it("configs.visibility_reason_retention_days: default 365, minimum 365", async () => {
    const { t } = await world();
    await q(`INSERT INTO configs (tenant_id) VALUES ($1)`, [t]).catch(() => null);
    expect((await q(`SELECT visibility_reason_retention_days AS d FROM configs WHERE tenant_id = $1`, [t]))[0]!["d"]).toBe(365);
    expect(await refused(`UPDATE configs SET visibility_reason_retention_days = 364 WHERE tenant_id = $1`, [t])).toMatch(/check constraint/);
  });

  it("events: a later reason of the same source replaces the earlier one; back to CLIENT ends them all, the new one included", async () => {
    const { t, a } = await world();
    const risk = (await q(`INSERT INTO risks (tenant_id, process, description, visibility) VALUES ($1, 'p', 'Risque', 'PERIMETRE') RETURNING id`, [t]))[0]!["id"] as string;
    const audit = new PostgresAuditRepository(pool);
    const first = async (text: string) => audit.record({ tenantId: t, userId: a, entityType: "Risk", entityId: risk, action: "PERMISSION_CHANGE", oldValue: null, newValue: null, requestId: "r",
      ...visibilityReasonOf("PERIMETER_CHANGE", text) });
    await first("Premier");
    const r1 = (await q(`SELECT reason_ref FROM audit_log WHERE entity_id = $1`, [risk]))[0]!["reason_ref"] as string;
    expect(await ended(r1)).toBeNull();
    await first("Second");
    expect(await ended(r1)).not.toBeNull();
    const r2 = (await q(`SELECT reason_ref FROM audit_log WHERE entity_id = $1 ORDER BY "timestamp" DESC LIMIT 1`, [risk]))[0]!["reason_ref"] as string;
    expect(await ended(r2)).toBeNull();
    const repo = new PostgresRiskRepository(pool);
    const out = await repo.changeVisibility(t, risk, { visibility: "CLIENT", addUserIds: [], revokeUserIds: [], reason: "Retour", changedBy: a }, (r) => [{
      tenantId: t, userId: a, entityType: "Risk", entityId: risk, action: "PERMISSION_CHANGE", oldValue: null, newValue: null, requestId: "r",
      ...visibilityReasonOf("VISIBILITY_CHANGE", "Retour", r.reasonId) }]);
    expect(await ended(r2)).not.toBeNull();
    expect(await ended(out.reasonId!)).not.toBeNull();
  });

  it("events: refusing or revoking a widened-view request ends its reasons; an approved one stays active", async () => {
    const { t, a, b, c } = await world();
    const grants = new PostgresSensitiveViewGrantRepository(pool);
    const make = async (userId: string) => grants.create({ tenantId: t, userId, reason: "Demande", requestedBy: a, expiresAt: null }, () => []);
    const g1 = await make(b);
    await grants.decide(t, g1.id, { status: "REJECTED", by: c, reason: "Refus" }, () => []);
    const refs = async (id: string) => (await q(`SELECT reason_ref, decision_reason_ref, revoke_reason_ref FROM sensitive_view_grants WHERE id = $1`, [id]))[0]!;
    const r1 = await refs(g1.id);
    expect(await ended(r1["reason_ref"])).not.toBeNull();
    expect(await ended(r1["decision_reason_ref"])).not.toBeNull();
    const g2 = await make(b);
    await grants.decide(t, g2.id, { status: "APPROVED", by: c, reason: "Accord" }, () => []);
    const r2 = await refs(g2.id);
    expect(await ended(r2["reason_ref"])).toBeNull();
    await grants.revoke(t, g2.id, { by: a, reason: "Retrait" }, () => []);
    const r3 = await refs(g2.id);
    for (const k of ["reason_ref", "decision_reason_ref", "revoke_reason_ref"]) expect(await ended(r3[k]), k).not.toBeNull();
  });

  it("C-L2B-2: a changed designation, process owner or department group member ends the matching opening reason only", async () => {
    const { t, a, b, c } = await world();
    const audit = new PostgresAuditRepository(pool);
    const ev = (entityType: string, entityId: string, newValue: unknown, source: "RISK_DESIGNATION_OPENING" | "PROCESS_OWNER_OPENING" | "DEPARTMENT_GROUP_OPENING", text: string) =>
      audit.record({ tenantId: t, userId: a, entityType, entityId, action: "PERMISSION_CHANGE", oldValue: null, newValue, requestId: "r", ...visibilityReasonOf(source, text) });
    const refOf = async (entityId: string, text: string) => (await q(`SELECT a.reason_ref FROM audit_log a JOIN visibility_reasons v ON v.id = a.reason_ref WHERE a.entity_id = $1 AND v.text = $2`, [entityId, text]))[0]!["reason_ref"] as string;
    // risk designation: the owner opening ends when the owner changes, the superior-owner one stays
    const risk = (await q(`INSERT INTO risks (tenant_id, process, description, visibility, owner_id, superior_owner_id) VALUES ($1, 'p', 'R', 'PERIMETRE', $2, $3) RETURNING id`, [t, b, c]))[0]!["id"] as string;
    await ev("Risk", risk, { as: "owner" }, "RISK_DESIGNATION_OPENING", "Ouverture owner");
    await ev("Risk", risk, { as: "superior owner" }, "RISK_DESIGNATION_OPENING", "Ouverture superieur");
    const risks = new PostgresRiskRepository(pool);
    await risks.assignOwner(t, risk, b, undefined); // same person: nothing ends
    expect(await ended(await refOf(risk, "Ouverture owner"))).toBeNull();
    await risks.assignOwner(t, risk, a, undefined);
    expect(await ended(await refOf(risk, "Ouverture owner"))).not.toBeNull();
    expect(await ended(await refOf(risk, "Ouverture superieur"))).toBeNull();
    // process owner
    const proc = (await q(`INSERT INTO processes (tenant_id, level, name, owner_user_id) VALUES ($1, 'PROCESS', 'q', $2) RETURNING id`, [t, b]))[0]!["id"] as string;
    await ev("Process", proc, { ownerUserId: b }, "PROCESS_OWNER_OPENING", "Ouverture processus");
    const procs = new PostgresProcessRepository(pool);
    await procs.setResponsibilities(t, proc, { riskChampionUserId: c });
    expect(await ended(await refOf(proc, "Ouverture processus"))).toBeNull();
    await procs.setResponsibilities(t, proc, { ownerUserId: null });
    expect(await ended(await refOf(proc, "Ouverture processus"))).not.toBeNull();
    // department group: revoking the member ends the reason given when he joined, not another member's
    const role = (await q(`INSERT INTO roles (tenant_id, name, permissions) VALUES ($1, $2, '{}') RETURNING id`, [t, `G-${randomUUID()}`]))[0]!["id"] as string;
    for (const u of [b, c]) await q(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [t, role, u, a]);
    await ev("Role", role, { userId: b, widening: true }, "DEPARTMENT_GROUP_OPENING", "Ouverture groupe B");
    await ev("Role", role, { userId: c, widening: true }, "DEPARTMENT_GROUP_OPENING", "Ouverture groupe C");
    await new PostgresRoleRepository(pool).revokeFromUser(t, role, b);
    expect(await ended(await refOf(role, "Ouverture groupe B"))).not.toBeNull();
    expect(await ended(await refOf(role, "Ouverture groupe C"))).toBeNull();
  });

  it("purge: candidates and purge erase only what the guard allows, tenant-scoped, text gone, never a DELETE", async () => {
    const { t } = await world();
    const other = await world();
    const old = await reason(t);
    const fresh = await reason(t);
    const live2 = await reason(t);
    const foreign = await reason(other.t);
    await age(old, 400);
    await age(foreign, 400);
    await q(`UPDATE visibility_reasons SET effect_ended_at = clock_timestamp() WHERE id = $1`, [fresh]);
    const repo = new PostgresVisibilityReasonRetentionRepository(pool);
    expect((await repo.candidates(t, 365)).map((r) => r.id)).toEqual([old]);
    const erased = await repo.purge(t, 365, (rows) => [{ tenantId: t, userId: other.a, entityType: "VisibilityReasonPurge", entityId: t, action: "UPDATE", oldValue: null,
      newValue: { erased: rows.length }, reason: "Conservation L2b", requestId: "r" }]);
    expect(erased.map((r) => r.id)).toEqual([old]);
    expect((await q(`SELECT text, erased_at FROM visibility_reasons WHERE id = $1`, [old]))[0]).toMatchObject({ text: null });
    for (const id of [fresh, live2, foreign]) expect((await q(`SELECT text FROM visibility_reasons WHERE id = $1`, [id]))[0]!["text"]).not.toBeNull();
    expect(await repo.candidates(t, 365)).toEqual([]);
  });
});
