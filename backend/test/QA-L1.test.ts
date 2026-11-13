import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { AuditLogService } from "../src/services/AuditLogService.js";

/**
 * QA-L1 (lot R1 L1, migration 095): edge cases beyond A06's level 1.
 * Oracle (written before running): a row is marked iff "timestamp" < now() - duration with duration >= 10 calendar years; a marked
 * row is absent from every consultation (listForEntity, listRecent, search with any filter), still present for the technical reads;
 * a tenant never marks another; the function is idempotent, also under concurrency.
 * Live part: MIG095_LIVE=1 MIG095_DB=grc_... (127.0.0.1:55442, disposable local base). Never Neon.
 */
const SRC = join(__dirname, "..", "src");
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

describe("QA-L1 (static): every reader of audit_log is known", () => {
  it("only these files read audit_log; a new reader must be classified (consultation = filtered, technical = documented in the QA report)", () => {
    const readers = walk(join(SRC, "infrastructure"))
      .filter((f) => f.endsWith(".ts") && /\b(FROM|JOIN)\s+audit_log\b(?!_)/i.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1).split("\\").join("/"))
      .sort((a, b) => a.localeCompare(b));
    expect(readers).toEqual([
      "infrastructure/database/postgres/PostgresAuditRepository.ts", // consultation, filtered
      "infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.ts", // technical (getAuditEntry by id)
      "infrastructure/database/postgres/PostgresGovernanceHealthRepository.ts", // technical + list of marked actions
      "infrastructure/database/postgres/PostgresGovernancePrincipleAcceptanceRepository.ts", // technical (reviewed flag)
      "infrastructure/database/postgres/PostgresGovernanceQueries.ts", // technical (independence, counts, notifier)
      "infrastructure/database/postgres/PostgresResourceAccessRepository.ts", // listRestricted: last PERMISSION_CHANGE
      "infrastructure/database/postgres/PostgresTenantRepository.ts", // technical (reactivation maker-checker)
    ]);
  });

  it("the four SELECTs on audit_log outside the repository never expose the rows through a filtered read by mistake (no NOT_MARKED copy)", () => {
    for (const f of walk(SRC).filter((x) => x.endsWith(".ts") && !x.endsWith("PostgresAuditRepository.ts"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/audit_log_retention_marks/);
    }
  });
});

const live = process.env["MIG095_LIVE"] === "1" && /^grc_/.test(process.env["MIG095_DB"] ?? "");

describe.skipIf(!live)("QA-L1 on a real local database", () => {
  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const newTenant = async () => {
    const t = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`QAL1-${randomUUID().slice(0, 8)}`]))[0]!["id"] as string;
    const u = (await q(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [t, `u-${randomUUID()}@x.test`]))[0]!["id"] as string;
    return { t, u };
  };
  /** Inserts one audit row `<age>` ago (SQL interval text, may be negative = future); returns its entity id (the label). */
  const row = async (t: string, u: string, age: string, extra: { type?: string; action?: string; exception?: string; entity?: string } = {}) => {
    const entity = extra.entity ?? randomUUID();
    await q(
      `INSERT INTO audit_log (tenant_id, "timestamp", user_id, entity_type, entity_id, action, request_id, governance_exception)
       VALUES ($1, now() - $2::interval, $3, $4, $5, $6, 'r', $7)`,
      [t, age, u, extra.type ?? "Risk", entity, extra.action ?? "CREATE", extra.exception ?? null],
    );
    return entity;
  };
  const markedEntities = async (t: string) => new Set((await q(`SELECT a.entity_id FROM audit_log a JOIN audit_log_retention_marks m ON m.audit_log_id = a.id WHERE a.tenant_id = $1`, [t])).map((r) => r["entity_id"] as string));

  beforeAll(() => { pool = new Pool({ host: "127.0.0.1", port: Number(process.env["MIG095_PORT"] ?? 55442), user: "postgres", database: process.env["MIG095_DB"]!, max: 4 }); });
  afterAll(async () => { await pool?.end(); });

  it("boundary: exactly 10 years and just over are marked; 1 minute short is not (default duration)", async () => {
    const { t, u } = await newTenant();
    const exact = await row(t, u, "10 years");
    const over = await row(t, u, "10 years 1 second");
    const justShort = await row(t, u, "9 years 11 months 29 days 23 hours 59 minutes");
    const recent = await row(t, u, "1 day");
    expect(Number((await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]))[0]!["marked_count"])).toBe(2);
    const marked = await markedEntities(t);
    expect(marked.has(exact) && marked.has(over)).toBe(true);
    expect(marked.has(justShort) || marked.has(recent)).toBe(false);
  });

  it("future rows are never marked, whatever the duration", async () => {
    const { t, u } = await newTenant();
    const f1 = await row(t, u, "-1 year");
    const f2 = await row(t, u, "-50 years");
    await row(t, u, "11 years");
    await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]);
    await q(`SELECT * FROM mark_expired_audit_log($1, '1000 years')`, [t]);
    const marked = await markedEntities(t);
    expect(marked.has(f1) || marked.has(f2)).toBe(false);
    expect(marked.size).toBe(1);
  });

  it("durations equivalent to 10 years in months, years+months or exact computed days are accepted; one unit less is refused", async () => {
    const { t, u } = await newTenant();
    await row(t, u, "11 years");
    for (const d of ["120 months", "9 years 12 months", "10 years", "10 years 1 month", "11 years"]) {
      await expect(pool.query(`SELECT * FROM mark_expired_audit_log($1, $2::interval)`, [t, d]), d).resolves.toBeDefined();
    }
    // Days: the exact number of days in the last 10 calendar years from today (3652 or 3653 depending on leap days), computed by the DB.
    const days = Number((await q(`SELECT extract(epoch FROM (now() - (now() - interval '10 years')))::numeric / 86400 AS d`))[0]!["d"]);
    expect(days === 3652 || days === 3653).toBe(true);
    await expect(pool.query(`SELECT * FROM mark_expired_audit_log($1, $2::interval)`, [t, `${days} days`])).resolves.toBeDefined();
    for (const d of ["119 months", "9 years 11 months", `${days - 1} days`, `${days * 24 - 1} hours`, "10 years -1 second", "-10 years", "-1000 years", "-1 second", "0 seconds", "1 second"]) {
      await expect(pool.query(`SELECT * FROM mark_expired_audit_log($1, $2::interval)`, [t, d]), d).rejects.toMatchObject({ code: "22023" });
    }
  });

  it("unknown tenant marks nothing without error; a tenant never marks another one's rows, nor does a mark carry another tenant", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const oldA = await row(a.t, a.u, "12 years");
    const oldB = await row(b.t, b.u, "12 years");
    expect(Number((await q(`SELECT * FROM mark_expired_audit_log($1)`, [randomUUID()]))[0]!["marked_count"])).toBe(0);
    expect(Number((await q(`SELECT * FROM mark_expired_audit_log($1)`, [a.t]))[0]!["marked_count"])).toBe(1);
    expect([...(await markedEntities(a.t))]).toEqual([oldA]);
    expect((await markedEntities(b.t)).size).toBe(0);
    const repo = new PostgresAuditRepository(pool);
    expect((await repo.search(b.t, { entityId: oldB }, 10)).length).toBe(1);
    expect((await repo.search(a.t, { entityId: oldA }, 10)).length).toBe(0);
    // A mark is bound to its row's tenant by the function: tenant_id of every mark equals the row's tenant.
    expect(await q(`SELECT 1 FROM audit_log_retention_marks m JOIN audit_log a ON a.id = m.audit_log_id WHERE m.tenant_id <> a.tenant_id`)).toHaveLength(0);
  });

  it("idempotence: a replay returns 0 and a fresh run_id is not stored; two runs have distinct run_id", async () => {
    const { t, u } = await newTenant();
    await row(t, u, "11 years");
    const r1 = (await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]))[0]!;
    const r2 = (await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]))[0]!;
    expect(Number(r2["marked_count"])).toBe(0);
    expect(r2["out_run_id"]).not.toBe(r1["out_run_id"]);
    expect(await q(`SELECT 1 FROM audit_log_retention_marks WHERE run_id = $1`, [r2["out_run_id"]])).toHaveLength(0);
  });

  it.fails("QA-L1-03: concurrency: two runs on the same tenant at once both end without error (one marks, the other 0); today the second gets 23505", async () => {
    const { t, u } = await newTenant();
    for (let i = 0; i < 3; i += 1) await row(t, u, "11 years");
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("BEGIN");
      await c1.query(`SELECT * FROM mark_expired_audit_log($1)`, [t]);
      const second = c2.query(`SELECT * FROM mark_expired_audit_log($1)`, [t]).then((r) => ({ ok: r.rows[0].marked_count as string }), (e: { code?: string }) => ({ err: e.code }));
      await new Promise((r) => setTimeout(r, 300));
      await c1.query("COMMIT");
      const out = await second;
      expect(out).toEqual({ ok: "0" });
    } finally {
      await c1.query("ROLLBACK").catch(() => undefined);
      c1.release();
      c2.release();
    }
    expect((await markedEntities(t)).size).toBe(3);
  });

  it("privileges: neither PUBLIC-only roles nor the migrator role can run the function or write the marks; the function is not SECURITY DEFINER", async () => {
    const { t } = await newTenant();
    expect((await q(`SELECT prosecdef FROM pg_proc WHERE proname = 'mark_expired_audit_log'`))[0]!["prosecdef"]).toBe(false);
    for (const role of ["grc_migrator", "grc_app_runtime"]) {
      const c = await pool.connect();
      try {
        await c.query(`SET ROLE ${role}`);
        await expect(c.query(`SELECT * FROM mark_expired_audit_log($1)`, [t]), role).rejects.toMatchObject({ code: "42501" });
        await expect(c.query(`INSERT INTO audit_log_retention_marks (audit_log_id, tenant_id, run_id) VALUES (gen_random_uuid(), $1, gen_random_uuid())`, [t]), role).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("RESET ROLE").catch(() => undefined);
        c.release();
      }
    }
  });

  it("every consultation hides a marked row, under every filter; the unmarked rows stay; limit counts visible rows only", async () => {
    const { t, u } = await newTenant();
    const old = await row(t, u, "11 years", { type: "Role", action: "PERMISSION_CHANGE", exception: "noSelfValidation" });
    const recent = await row(t, u, "1 day", { type: "Role", action: "PERMISSION_CHANGE", exception: "noSelfValidation" });
    await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]);
    const repo = new PostgresAuditRepository(pool);
    const service = new AuditLogService(repo);
    const actor = { userId: u, tenantId: t, email: "a@x.test", displayName: "A", roles: ["audit.read"] };
    const ids = (e: Array<{ entityId: string }>) => e.map((x) => x.entityId);
    const wide = { from: new Date("2000-01-01"), to: new Date("2100-01-01") };
    const filters = [{}, { userId: u }, { action: "PERMISSION_CHANGE" }, { entityType: "Role" }, { entityId: old }, wide, { governanceException: true }, { governanceException: "noSelfValidation" }, { ...wide, userId: u, action: "PERMISSION_CHANGE", entityType: "Role", governanceException: true }];
    for (const f of filters) {
      const got = ids(await service.search(actor, f as never, 500));
      expect(got, JSON.stringify(f)).not.toContain(old);
      if (!("entityId" in f)) expect(got, JSON.stringify(f)).toContain(recent);
    }
    expect(ids(await service.listForEntity(actor, "Role", old))).toEqual([]);
    expect(ids(await service.listRecent(actor, 1))).toEqual([recent]);
    expect(ids(await service.search(actor, { governanceException: true }, 1))).toEqual([recent]);
  });

  it("technical reads still see a marked row: listRestricted last PERMISSION_CHANGE, getAuditEntry, governance health (counts and list)", async () => {
    const { t, u } = await newTenant();
    const risk = (await q(`INSERT INTO risks (tenant_id, process, description, status, owner_id, visibility) VALUES ($1, 'p', 'd', 'ACTIVE', $2, 'PERIMETRE') RETURNING id`, [t, u]))[0]!["id"] as string;
    await row(t, u, "11 years", { type: "Risk", action: "PERMISSION_CHANGE", entity: risk });
    const ex = await q(`INSERT INTO audit_log (tenant_id, "timestamp", user_id, entity_type, entity_id, action, request_id, governance_exception, reason)
                        VALUES ($1, now() - interval '11 years', $2, 'Risk', $3, 'VALIDATE', 'r', 'noSelfValidation', 'free text') RETURNING id`, [t, u, randomUUID()]);
    await q(`UPDATE tenants SET governance_tracking_started_at = now() - interval '12 years' WHERE id = $1`, [t]);
    const before = await new PostgresGovernanceHealthRepository(pool).loadFacts(t, new Date());
    await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]);
    expect((await markedEntities(t)).size).toBe(2);

    const restricted = await new PostgresResourceAccessRepository(pool).listRestricted(t);
    expect(restricted.find((r) => r.id === risk)?.lastChange?.userId).toBe(u);

    const entry = await new PostgresGovernanceExceptionReviewRepository(pool).getAuditEntry(t, ex[0]!["id"]);
    expect(entry?.governanceException).toBe("noSelfValidation");

    const after = await new PostgresGovernanceHealthRepository(pool).loadFacts(t, new Date());
    expect(after.markedTotal).toBe(before.markedTotal);
    expect(after.unreviewedTotal).toBe(before.unreviewedTotal);
    expect(after.markedCountByRule).toEqual(before.markedCountByRule);
    expect(after.markedTotal).toBe(1);
    // Observation pinned (QA-L1-02): the health panel LISTS the marked row, with its reason, to the user who reads /governance-health.
    expect(after.markedActions.map((m) => m.reason)).toContain("free text");
  });

  it.fails("QA-L1-01: decision logic built on AuditRepository.listForEntity (TenantService.reactivate, RiskFrameworkService.authoredByMe/authorsOf, ProcessService.championSelfDesignated) must still see a marked row", async () => {
    const { t, u } = await newTenant();
    const deactivation = await row(t, u, "11 years", { type: "Tenant", action: "STATUS_CHANGE", entity: t });
    await q(`SELECT * FROM mark_expired_audit_log($1)`, [t]);
    const events = await new PostgresAuditRepository(pool).listForEntity(t, "Tenant", t);
    expect(events.map((e) => e.entityId)).toContain(deactivation);
  });
});
