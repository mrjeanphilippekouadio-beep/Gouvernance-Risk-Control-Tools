import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { VisibilityReviewService } from "../src/services/VisibilityReviewService.js";
import { PostgresVisibilityReviewRepository } from "../src/infrastructure/database/postgres/PostgresVisibilityReviewRepository.js";
import { PostgresResourceAccessRepository } from "../src/infrastructure/database/postgres/PostgresResourceAccessRepository.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/**
 * Conservation L2c (q248 B, q269 A), level 1. Unit part: service rules. Live part (the SQL query and the write): L2C_LIVE=1 L2C_DB=grc_...
 * L2C_PORT=... on a local cluster (127.0.0.1), never Neon.
 * SEC-L2C-01: the review is per RESOURCE; only a Risk Manager confirmation restarts its clock.
 */
const actor = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({ userId: "u1", tenantId: "t1", email: "u@x.test", displayName: "U", roles: ["resourcevisibility.set"], ...over }) as AuthenticatedUser;
const RES = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("VisibilityReviewService.confirm", () => {
  const make = (member: boolean, done: { reviewedAt: Date } | null) => {
    const confirm = vi.fn(async () => done);
    const service = new VisibilityReviewService({ listDue: vi.fn(), confirm }, { isRiskManagerMember: vi.fn(async () => member) });
    return { service, confirm };
  };

  it("happy path: forces the author and the tenant to the actor's", async () => {
    const reviewedAt = new Date();
    const { service, confirm } = make(true, { reviewedAt });
    expect(await service.confirm(actor(), "RISK", RES, "req")).toEqual({ resourceType: "RISK", resourceId: RES, reviewedAt });
    expect(confirm).toHaveBeenCalledWith("t1", "RISK", RES, "u1", "req");
  });

  it("refuses without resourcevisibility.set, before anything else", async () => {
    const { service, confirm } = make(true, { reviewedAt: new Date() });
    await expect(service.confirm(actor({ roles: [] }), "RISK", RES, "req")).rejects.toBeInstanceOf(ForbiddenError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("refuses a holder of the permission who is not in the Risk Manager group", async () => {
    const { service, confirm } = make(false, { reviewedAt: new Date() });
    await expect(service.confirm(actor(), "RISK", RES, "req")).rejects.toBeInstanceOf(ForbiddenError);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("a resource whose review is not due (unknown, other tenant, not restricted, reviewed) is a 404", async () => {
    const { service } = make(true, null);
    await expect(service.confirm(actor(), "RISK", RES, "req")).rejects.toBeInstanceOf(NotFoundError);
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
  /** A risk created `age` ago (interval text) with the given visibility, no audit row at all (variant c: created restricted). */
  const risk = async (t: string, age: string, visibility = "NOMINATIF") =>
    (await q(`INSERT INTO risks (tenant_id, process, description, visibility, created_at) VALUES ($1, 'p', 'd', $2, now() - $3::interval) RETURNING id`, [t, visibility, age]))[0]!["id"] as string;
  /** An audit row of the resource `age` ago; `reasonText` makes a motivated act (stored apart, referenced). */
  const audit = async (t: string, by: string, riskId: string, age: string, o: { action?: string; oldV?: object | null; newV?: object | null; reasonText?: string }) => {
    let ref: string | null = null;
    if (o.reasonText) ref = (await q(`INSERT INTO visibility_reasons (tenant_id, source, text) VALUES ($1, 'ACCESS_RENEWAL', $2) RETURNING id`, [t, o.reasonText]))[0]!["id"] as string;
    await q(`INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id, reason_ref, "timestamp")
             VALUES ($1, $2, 'Risk', $3, $4, $5, $6, 'r', $7, now() - $8::interval)`,
      [t, by, riskId, o.action ?? "PERMISSION_CHANGE", o.oldV ? JSON.stringify(o.oldV) : null, o.newV ? JSON.stringify(o.newV) : null, ref, age]);
  };
  const dueIds = async (t: string) => (await new PostgresVisibilityReviewRepository(pool).listDue(t, 50)).items.map((i) => i.resourceId);

  it("(c) a resource created restricted is due 12 months after creation, not before", async () => {
    const { t } = await world();
    const old = await risk(t, "13 months");
    const recent = await risk(t, "11 months");
    const open = await risk(t, "30 months", "CLIENT");
    const ids = await dueIds(t);
    expect(ids).toContain(old);
    expect(ids).not.toContain(recent);
    expect(ids).not.toContain(open); // not restricted: nothing to review
  });

  it("(a) an opening without reason by an RM does not take the resource out of the list", async () => {
    const { t, rm } = await world();
    const id = await risk(t, "30 months");
    await audit(t, rm, id, "20 months", { newV: { designatedUserId: rm, reads: true, through: "DESIGNATION" } }); // reason_ref NULL
    expect(await dueIds(t)).toEqual([id]);
  });

  it("(b) a renewal, a perimeter change or a new reason by a third party never restarts the clock; only an RM confirmation does", async () => {
    const { t, rm, other } = await world();
    const id = await risk(t, "30 months", "CLIENT");
    await q(`UPDATE risks SET visibility = 'NOMINATIF' WHERE id = $1`, [id]);
    await audit(t, rm, id, "14 months", { oldV: { visibility: "CLIENT" }, newV: { visibility: "NOMINATIF" }, reasonText: "Texte libre secret" }); // start of the restriction
    await audit(t, other, id, "1 day", { oldV: { visibility: "NOMINATIF" }, newV: { visibility: "NOMINATIF", renewed: [other] }, reasonText: "Renouvellement" });
    await audit(t, other, id, "1 hour", { oldV: { visibility: "NOMINATIF", ownerDepartmentId: null }, newV: { visibility: "NOMINATIF", ownerDepartmentId: null }, reasonText: "Périmètre" });
    const { items } = await new PostgresVisibilityReviewRepository(pool).listDue(t, 50);
    expect(items.map((i) => i.resourceId)).toEqual([id]);
    expect(items[0]!.lastReviewedAt).toBeNull();
    expect(JSON.stringify(items)).not.toContain("secret");
    // a restriction restarted later (CLIENT then restricted again) restarts the clock
    await audit(t, rm, id, "2 months", { oldV: { visibility: "CLIENT" }, newV: { visibility: "PERIMETRE" } });
    expect(await dueIds(t)).toEqual([]);
  });

  it("confirm: audit line on the resource without text or reference, same transaction, clock restarts, never twice, other tenant = null", async () => {
    const { t, rm, other } = await world();
    const repo = new PostgresVisibilityReviewRepository(pool);
    const service = new VisibilityReviewService(repo, new PostgresResourceAccessRepository(pool));
    const id = await risk(t, "13 months");
    const me = actor({ userId: rm, tenantId: t });
    const done = await service.confirm(me, "RISK", id, "req-1");
    const lines = await q(`SELECT user_id, entity_type, action, reason, reason_ref, new_value FROM audit_log WHERE entity_id = $1`, [id]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ user_id: rm, entity_type: "Risk", action: "UPDATE", reason: null, reason_ref: null });
    expect(new Date(lines[0]!["new_value"]["reviewedAt"])).toEqual(done.reviewedAt);
    expect(await dueIds(t)).toEqual([]);
    await expect(service.confirm(me, "RISK", id, "req-2")).rejects.toBeInstanceOf(NotFoundError);
    // outside the group: 403; other tenant's RM: 404 and nothing written
    const again = await risk(t, "13 months");
    await expect(service.confirm(actor({ userId: other, tenantId: t }), "RISK", again, "r")).rejects.toBeInstanceOf(ForbiddenError);
    const foreign = await world();
    await expect(service.confirm(actor({ userId: foreign.rm, tenantId: foreign.t }), "RISK", again, "r")).rejects.toBeInstanceOf(NotFoundError);
    expect(await q(`SELECT 1 FROM audit_log WHERE entity_id = $1`, [again])).toHaveLength(0);
    // the confirmed resource stays out of the list, the unconfirmed one is still due
    expect(await dueIds(t)).toEqual([again]);
  });

  it("SEC-L2C-02: the count without NOMINATIF; the full total stays available for the groups that see everything", async () => {
    const { t } = await world();
    await risk(t, "13 months", "NOMINATIF");
    await risk(t, "13 months", "PERIMETRE");
    const r = await new PostgresVisibilityReviewRepository(pool).listDue(t, 50);
    expect(r).toMatchObject({ total: 2, totalExcludingNominative: 1 });
  });

  it("a failing audit insert rolls the review back (nothing written)", async () => {
    const { t } = await world();
    const id = await risk(t, "13 months");
    await expect(new PostgresVisibilityReviewRepository(pool).confirm(t, "RISK", id, randomUUID(), "req")).rejects.toBeTruthy(); // unknown author: FK
    expect(await q(`SELECT 1 FROM audit_log WHERE entity_id = $1`, [id])).toHaveLength(0);
    expect(await dueIds(t)).toEqual([id]);
  });
});
