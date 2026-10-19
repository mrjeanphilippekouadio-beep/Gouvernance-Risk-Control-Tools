import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createLastSeenRecorder } from "../src/infrastructure/identity/lastSeen.js";
import { PostgresConfigRepository } from "../src/infrastructure/database/postgres/PostgresConfigRepository.js";
import { PostgresSelfValidationPolicyRequestRepository } from "../src/infrastructure/database/postgres/PostgresSelfValidationPolicyRequestRepository.js";

/**
 * Retest lot, level 1, real PostgreSQL (needs migrations 072 hardened + 074). Gated by QA_SWP_PGHOST (local socket only),
 * never Neon. Creates its own tenants/users (random e-mails); nothing is cleaned (append-only tables).
 */
const HOST = process.env.QA_SWP_PGHOST ?? "";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!HOST.startsWith("/"))("retest lot, PostgreSQL", () => {
  let pool: Pool;
  let tenant: string;
  let a: string;
  let b: string;
  const one = async <T>(sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0] as T;
  const fails = async (sql: string, p: unknown[] = []) => pool.query(sql, p).then(() => null, (e: { code?: string; message: string }) => e);

  beforeAll(async () => {
    pool = new Pool({ host: HOST, port: Number(process.env.QA_SWP_PGPORT ?? 5531), user: "postgres", database: process.env.QA_SWP_PGDB ?? "grc_qa_a08", max: 3 });
    tenant = (await one<{ id: string }>(`INSERT INTO tenants (name) VALUES ('retest-lot') RETURNING id`)).id;
    const user = async () => (await one<{ id: string }>(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $2) RETURNING id`, [tenant, `u${Math.random()}@retest`])).id;
    a = await user();
    b = await user();
  });
  afterAll(async () => { await pool?.end(); });

  it("072 guard (SEC-PNL2-03): content immutable, decided once, never reopened, never deleted or truncated, inserted PENDING only", async () => {
    const repo = new PostgresSelfValidationPolicyRequestRepository(pool);
    const r = await repo.create(tenant, "DOUBLE_CONFIRMATION", "demande", a);
    // the approver's own reason is stored apart from the requester's
    const done = await repo.decide(tenant, r.id, "APPLIED", b, "ma raison d'approbateur");
    expect(done).toMatchObject({ status: "APPLIED", reason: "demande", decisionReason: "ma raison d'approbateur", decidedBy: b });
    for (const sql of [
      `UPDATE self_validation_policy_requests SET status = 'PENDING', decided_by = NULL, decided_at = NULL WHERE id = $1`,
      `UPDATE self_validation_policy_requests SET reason = 'réécrit' WHERE id = $1`,
      `UPDATE self_validation_policy_requests SET requested_by = decided_by, decided_by = requested_by WHERE id = $1`,
      `UPDATE self_validation_policy_requests SET status = 'REJECTED' WHERE id = $1`,
      `DELETE FROM self_validation_policy_requests WHERE id = $1`,
    ]) expect((await fails(sql, [r.id]))?.code, sql).toBe("42501");
    expect((await fails(`TRUNCATE self_validation_policy_requests`))?.code).toBe("42501");
    expect((await fails(`INSERT INTO self_validation_policy_requests (tenant_id, requested_policy, reason, requested_by, status, decided_by, decided_at)
      VALUES ($1, 'REFUSE', 'x', $2, 'APPLIED', $3, now())`, [tenant, a, b]))?.code).toBe("42501");
    expect((repo as unknown as { reopen?: unknown }).reopen).toBeUndefined();
    // the function pins its search_path with pg_temp last
    const fn = await one<{ cfg: string[] }>(`SELECT proconfig AS cfg FROM pg_proc WHERE proname = 'self_validation_policy_requests_guard'`);
    expect(fn.cfg).toContain("search_path=pg_catalog, public, pg_temp");
  });

  it("074 (I01): a connection counts only when the token iat differs from the stored one, whatever the instance", async () => {
    const readRow = () => one<{ last_seen_at: Date | null; last_token_iat: string | null }>(`SELECT last_seen_at, last_token_iat FROM users WHERE id = $1`, [a]);
    expect(await readRow()).toMatchObject({ last_seen_at: null, last_token_iat: null });
    createLastSeenRecorder(pool)(tenant, a, 1000);
    await wait(150);
    const first = await readRow();
    expect(first.last_seen_at).not.toBeNull();
    expect(Number(first.last_token_iat)).toBe(1000);
    // another process (fresh recorder, empty memory) sees the same token: not a new connection
    await pool.query(`UPDATE users SET last_seen_at = now() - interval '2 days' WHERE id = $1`, [a]);
    const before = (await readRow()).last_seen_at!;
    createLastSeenRecorder(pool)(tenant, a, 1000);
    await wait(150);
    expect((await readRow()).last_seen_at!.getTime()).toBe(before.getTime());
    // a new token: counted
    createLastSeenRecorder(pool)(tenant, a, 4600);
    await wait(150);
    const after = await readRow();
    expect(after.last_seen_at!.getTime()).toBeGreaterThan(before.getTime());
    expect(Number(after.last_token_iat)).toBe(4600);
  });

  it("config upsert with an audit builder is one transaction: an audit the database refuses rolls the setting back", async () => {
    const repo = new PostgresConfigRepository(pool);
    await repo.upsert(tenant, { committeeEvaluationEnforced: true }, a);
    const audit = (reason: string) => (c: { id: string }) => [{
      tenantId: tenant, userId: a, entityType: "Config", entityId: c.id, action: "UPDATE" as const, oldValue: null, newValue: null, reason, requestId: "r",
    }];
    await expect(repo.upsert(tenant, { committeeEvaluationEnforced: false }, a, audit("motif\u0000piégé"))).rejects.toThrow();
    expect((await repo.getByTenant(tenant))?.committeeEvaluationEnforced).toBe(true);
    await repo.upsert(tenant, { committeeEvaluationEnforced: false }, a, audit("motif propre"));
    expect((await repo.getByTenant(tenant))?.committeeEvaluationEnforced).toBe(false);
    const rows = await pool.query(`SELECT reason FROM audit_log WHERE tenant_id = $1 AND entity_type = 'Config'`, [tenant]);
    expect(rows.rows.map((r: { reason: string }) => r.reason)).toEqual(["motif propre"]);
  });
});
