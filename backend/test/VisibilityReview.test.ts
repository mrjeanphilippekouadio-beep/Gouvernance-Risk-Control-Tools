import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { VisibilityReviewService } from "../src/services/VisibilityReviewService.js";
import { PostgresVisibilityReviewRepository } from "../src/infrastructure/database/postgres/PostgresVisibilityReviewRepository.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * Conservation L2c (q248 B, q269 A), level 1. Unit part: service rules. Live part (a SQL query + a write): L2C_LIVE=1 L2C_DB=grc_... L2C_PORT=...
 * on a local cluster (127.0.0.1), never Neon.
 */
const actor = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({ userId: "u1", tenantId: "t1", email: "u@x.test", displayName: "U", roles: ["resourcevisibility.set"], ...over }) as AuthenticatedUser;

describe("VisibilityReviewService.confirm", () => {
  const make = (member: boolean, done: { reviewedAt: Date } | null) => {
    const confirm = vi.fn(async () => done);
    const service = new VisibilityReviewService({ listDue: vi.fn(), confirm }, { isRiskManagerMember: vi.fn(async () => member) });
    return { service, confirm };
  };

  it("happy path: forces the author to the actor and the tenant to the actor's", async () => {
    const reviewedAt = new Date();
    const { service, confirm } = make(true, { reviewedAt });
    expect(await service.confirm(actor(), "r1", "req")).toEqual({ reasonId: "r1", reviewedAt });
    expect(confirm).toHaveBeenCalledWith("t1", "r1", "u1", "req");
  });

  it("refuses without resourcevisibility.set, before anything else", async () => {
    const { service, confirm } = make(true, { reviewedAt: new Date() });
    await expect(service.confirm(actor({ roles: [] }), "r1", "req")).rejects.toBeInstanceOf(ForbiddenError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses a holder of the permission who is not in the Risk Manager group", async () => {
    const { service, confirm } = make(false, { reviewedAt: new Date() });
    await expect(service.confirm(actor(), "r1", "req")).rejects.toBeInstanceOf(ForbiddenError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a reason that is not due (unknown, other tenant, ended, already reviewed) is a 404", async () => {
    const { service } = make(true, null);
    await expect(service.confirm(actor(), "r1", "req")).rejects.toBeInstanceOf(NotFoundError);
  });
});

const live = process.env["L2C_LIVE"] === "1" && /^grc_/.test(process.env["L2C_DB"] ?? "");

describe.skipIf(!live)("L2c on a real local database", () => {
  let pool: Pool;
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  beforeAll(() => { pool = new Pool({ host: "127.0.0.1", port: Number(process.env["L2C_PORT"] ?? 55461), user: "postgres", database: process.env["L2C_DB"]!, max: 3 }); });
  afterAll(async () => { await pool?.end(); });

  const world = async () => {
    const t = (await q(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`L2C-${randomUUID().slice(0, 8)}`]))[0]!["id"] as string;
    const user = async () => (await q(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, 'U') RETURNING id`, [t, `u-${randomUUID()}@x.test`]))[0]!["id"] as string;
    const rm = await user();
    const other = await user();
    const role = (await q(`INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1, 'Risk Manager', '{resourcevisibility.set}', 'RISK_MANAGER') RETURNING id`, [t]))[0]!["id"] as string;
    await q(`INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) VALUES ($1, $2, $3, $4)`, [t, role, rm, other]);
    return { t, rm, other };
  };
  /** A restricted risk whose last visibility change carries a reason created `age` ago (interval text). */
  const restrictedRisk = async (t: string, by: string, age: string, visibility = "NOMINATIF", source = "VISIBILITY_CHANGE") => {
    const reasonId = (await q(`INSERT INTO visibility_reasons (tenant_id, source, text, created_at) VALUES ($1, $2, 'Texte libre secret', now() - $3::interval) RETURNING id`, [t, source, age]))[0]!["id"] as string;
    const riskId = (await q(`INSERT INTO risks (tenant_id, process, description, visibility) VALUES ($1, 'p', 'd', $2) RETURNING id`, [t, visibility]))[0]!["id"] as string;
    await q(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, request_id, reason_ref) VALUES ($1, $2, 'Risk', $3, 'PERMISSION_CHANGE', 'r', $4)`, [t, by, riskId, reasonId]);
    return { reasonId, riskId };
  };

  it("lists only active reasons of still-restricted resources older than 12 months (review date wins over creation), tenant-scoped, no text", async () => {
    const { t, rm } = await world();
    const repo = new PostgresVisibilityReviewRepository(pool);
    const old = await restrictedRisk(t, rm, "13 months");
    const recent = await restrictedRisk(t, rm, "11 months");
    const reviewed = await restrictedRisk(t, rm, "20 months");
    await q(`UPDATE visibility_reasons SET reviewed_at = now() - interval '2 months' WHERE id = $1`, [reviewed.reasonId]);
    const ended = await restrictedRisk(t, rm, "20 months");
    await q(`UPDATE visibility_reasons SET effect_ended_at = now() WHERE id = $1`, [ended.reasonId]);
    const reopened = await restrictedRisk(t, rm, "20 months", "CLIENT"); // back to the whole client: no restriction any more
    const overdueReview = await restrictedRisk(t, rm, "30 months");
    await q(`UPDATE visibility_reasons SET reviewed_at = now() - interval '14 months' WHERE id = $1`, [overdueReview.reasonId]);
    const other = await world();
    await restrictedRisk(other.t, other.rm, "30 months");

    const { total, items } = await repo.listDue(t, 50);
    expect(total).toBe(2);
    expect(items.map((i) => i.reasonId)).toEqual([overdueReview.reasonId, old.reasonId]); // oldest reference date first
    for (const x of [recent, reviewed, ended, reopened]) expect(items.some((i) => i.reasonId === x.reasonId)).toBe(false);
    expect(JSON.stringify(items)).not.toContain("secret");
    expect((await repo.listDue(t, 1)).items).toHaveLength(1); // bounded list, exact total
    expect((await repo.listDue(t, 1)).total).toBe(2);
  });

  it("confirm: sets reviewed_at (monotone), writes one audit row without text in the same transaction, drops it from the list, never twice", async () => {
    const { t, rm, other } = await world();
    const repo = new PostgresVisibilityReviewRepository(pool);
    const service = new VisibilityReviewService(repo, new PostgresResourceAccessRepository(pool));
    const due = await restrictedRisk(t, rm, "13 months");
    const me = actor({ userId: rm, tenantId: t });
    const done = await service.confirm(me, due.reasonId, "req-1");
    const row = (await q(`SELECT reviewed_at, effect_ended_at, erased_at, text FROM visibility_reasons WHERE id = $1`, [due.reasonId]))[0]!;
    expect(row["reviewed_at"]).toEqual(done.reviewedAt);
    expect(row["effect_ended_at"]).toBeNull(); // extends nothing, erases nothing
    expect(row["erased_at"]).toBeNull();
    const audit = await q(`SELECT user_id, action, reason, reason_ref, new_value FROM audit_log WHERE entity_type = 'VisibilityReason' AND entity_id = $1`, [due.reasonId]);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: rm, action: "UPDATE", reason: null, reason_ref: null });
    expect(JSON.stringify(audit[0])).not.toContain("secret");
    expect((await repo.listDue(t, 50)).total).toBe(0);
    await expect(service.confirm(me, due.reasonId, "req-2")).rejects.toBeInstanceOf(NotFoundError);
    // a member of another tenant, or an account outside the group, cannot review it
    const again = await restrictedRisk(t, rm, "13 months");
    await expect(service.confirm(actor({ userId: other, tenantId: t }), again.reasonId, "r")).rejects.toBeInstanceOf(ForbiddenError);
    const foreign = await world();
    await expect(service.confirm(actor({ userId: foreign.rm, tenantId: foreign.t }), again.reasonId, "r")).rejects.toBeInstanceOf(NotFoundError);
    expect((await q(`SELECT reviewed_at FROM visibility_reasons WHERE id = $1`, [again.reasonId]))[0]!["reviewed_at"]).toBeNull();
  });

  it("a failing audit insert rolls the review back", async () => {
    const { t, rm } = await world();
    const due = await restrictedRisk(t, rm, "13 months");
    const failing = new PostgresVisibilityReviewRepository(pool);
    // an actor id unknown to users breaks the audit FK: the UPDATE of reviewed_at must not survive
    await expect(failing.confirm(t, due.reasonId, randomUUID(), "req")).rejects.toBeTruthy();
    expect((await q(`SELECT reviewed_at FROM visibility_reasons WHERE id = $1`, [due.reasonId]))[0]!["reviewed_at"]).toBeNull();
  });
});
