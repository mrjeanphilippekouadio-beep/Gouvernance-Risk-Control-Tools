import { describe, expect, it } from "vitest";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { SOLE_RM_EXCEPTION, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION } from "../src/domain/entities/GovernanceReviews.js";
import { PostgresAuditRepository } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { PostgresGovernanceQueries } from "../src/infrastructure/database/postgres/PostgresGovernanceQueries.js";
import { GovernanceExceptionService } from "../src/services/GovernanceExceptionService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { fakeDelayRequests } from "./fakeDelayRequests.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import { hasLocalPg, useMigrationTenant } from "./migrationHarness.js";

/** QA q266 (DECISION-128) — edge cases and cross-module, real PostgreSQL, local disposable cluster only. */
const DAY = 86_400_000;
const NOW = new Date("2026-11-13T12:00:00.000Z");

describe.skipIf(!hasLocalPg)("QA q266: SOLE_RM review counter (real PostgreSQL, local only)", () => {
  const { ctx, one } = useMigrationTenant("qa-q266");
  const user = async (tenant: string, name: string) =>
    (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [tenant, `${name}-${Math.random()}@qa-q266`, name])).id as string;
  const newTenant = async (trackedDaysAgo: number) => {
    const t = (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [`qa-q266-${Math.random()}`])).id as string;
    await one(`UPDATE tenants SET governance_tracking_started_at = $2::timestamptz - $3 * interval '1 day' WHERE id = $1 RETURNING id`, [t, NOW, trackedDaysAgo]);
    return t;
  };
  const mark = async (tenant: string, by: string, ageMs: number, marker: string | null) =>
    (await one(
      `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id, governance_exception, "timestamp")
       VALUES ($1, $2, 'RiskFrameworkChangeRequest', gen_random_uuid(), 'APPROVE', '{}', '{}', $3, $4, $5::timestamptz - $6 * interval '1 millisecond') RETURNING id`,
      [tenant, by, `qa-q266-${Math.random()}`, marker, NOW, ageMs])).id as string;
  const setDelay = (tenant: string, days: number | null) =>
    one(`INSERT INTO configs (tenant_id, exception_review_delay_days) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET exception_review_delay_days = $2 RETURNING tenant_id`, [tenant, days]);
  const facts = (tenant: string) => new PostgresGovernanceHealthRepository(ctx.pool).loadFacts(tenant, NOW);
  const reviews = () => new PostgresGovernanceExceptionReviewRepository(ctx.pool);
  const review = (tenant: string, auditLogId: string, outcome: "REVIEWED" | "CONTESTED", by: string) =>
    reviews().insert({ tenantId: tenant, auditLogId, outcome, reviewedBy: by, comment: "qa" },
      (r: { id: string }) => [{ tenantId: tenant, userId: by, entityType: "GovernanceExceptionReview", entityId: r.id, action: "CREATE" as const, oldValue: null, newValue: null, reason: "qa", requestId: "qa-q266" }]);

  it("boundary: age = delay is not overdue, delay + 1 day is; same rule as the panel list (floor(age) > delay), default 30 when unset", async () => {
    const t = await newTenant(400);
    const rm = await user(t, "rm");
    const ages = [30 * DAY, 31 * DAY - 1000, 31 * DAY, 31 * DAY + 1000];
    for (const a of ages) await mark(t, rm, a, SOLE_RM_EXCEPTION);
    const f = await facts(t);
    expect(f.soleRm).toEqual({ total: 4, unreviewed: 4, overdue: 2, withoutPriorReview: 0 });
    const oracle = f.markedActions.filter((m) => Math.floor((NOW.getTime() - m.at.getTime()) / DAY) > 30).length;
    expect(oracle).toBe(2);
    // Tenant delay 1 (the minimum), 30 and 31: same boundary.
    await setDelay(t, 1);
    expect((await facts(t)).soleRm?.overdue).toBe(4);
    await setDelay(t, 30);
    expect((await facts(t)).soleRm?.overdue).toBe(2);
    await setDelay(t, 31);
    expect((await facts(t)).soleRm?.overdue).toBe(0);
  });

  it("delay 0 is refused by the database (CHECK 1..3650); tenant null -> value -> null switches the delay at read", async () => {
    const t = await newTenant(400);
    const rm = await user(t, "rm");
    await expect(setDelay(t, 0)).rejects.toThrow(/check/i);
    await mark(t, rm, 10 * DAY, SOLE_RM_EXCEPTION);
    expect((await facts(t)).soleRm?.overdue).toBe(0); // no config row: default 30
    await setDelay(t, 5);
    expect((await facts(t)).soleRm?.overdue).toBe(1);
    await setDelay(t, null);
    expect((await facts(t)).soleRm?.overdue).toBe(0); // back to the default, not "no delay"
  });

  it("no double count: one confirmation = 1 in soleRm AND 1 in the global unreviewed counter; other markers only in the global one", async () => {
    const t = await newTenant(400);
    const rm = await user(t, "rm");
    await mark(t, rm, 2 * DAY, SOLE_RM_EXCEPTION);
    await mark(t, rm, 1 * DAY, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION);
    await mark(t, rm, 1 * DAY, "principle.acceptance.alone");
    const f = await facts(t);
    expect(f.soleRm).toEqual({ total: 2, unreviewed: 2, overdue: 0, withoutPriorReview: 1 });
    expect(f.markedTotal).toBe(3);
    expect(f.unreviewedTotal).toBe(3);
  });

  it("tenant scoping: another tenant's confirmation enters neither the counter nor the 'previous not reviewed' check", async () => {
    const a = await newTenant(400);
    const b = await newTenant(400);
    const rmB = await user(b, "rmb");
    await mark(b, rmB, 50 * DAY, SOLE_RM_EXCEPTION);
    const frameworks = new PostgresRiskFrameworkRepository(ctx.pool);
    expect((await facts(a)).soleRm).toEqual({ total: 0, unreviewed: 0, overdue: 0, withoutPriorReview: 0 });
    expect(await frameworks.hasUnreviewedSoleRm(a)).toBe(false);
    expect(await frameworks.hasUnreviewedSoleRm(b)).toBe(true);
    expect((await facts(b)).soleRm?.overdue).toBe(1);
    // The delay of tenant A does not leak to B.
    await setDelay(a, 1);
    expect((await facts(b)).soleRm?.overdue).toBe(1);
    await setDelay(b, 90);
    expect((await facts(b)).soleRm?.overdue).toBe(0);
  });

  it("QA-Q266-01 (fixed): 'previous not reviewed' honours trackedSince like the counter (before = ignored, after = seen)", async () => {
    const t = await newTenant(10);
    const rm = await user(t, "rm");
    await mark(t, rm, 60 * DAY, SOLE_RM_EXCEPTION); // before tracking started (q143)
    const frameworks = new PostgresRiskFrameworkRepository(ctx.pool);
    expect((await facts(t)).soleRm?.total).toBe(0);
    expect(await frameworks.hasUnreviewedSoleRm(t)).toBe(false);
    await mark(t, rm, 9 * DAY, SOLE_RM_EXCEPTION); // after the start of tracking
    expect((await facts(t)).soleRm?.total).toBe(1);
    expect(await frameworks.hasUnreviewedSoleRm(t)).toBe(true);
  });

  describe("SEC-Q266-02: only an active Audit or Committee member reviews a SOLE_RM exception (real service, real repositories)", () => {
    const service = () => new GovernanceExceptionService(reviews(), new PostgresAuditRepository(ctx.pool), new PostgresGovernanceQueries(ctx.pool));
    const actorOf = (tenantId: string, userId: string) =>
      ({ userId, tenantId, email: `${userId}@x`, displayName: userId, roles: ["governanceexception.review"] }) as unknown as AuthenticatedUser;
    const join = (tenant: string, userId: string, group: string) =>
      one(`WITH r AS (INSERT INTO roles (tenant_id, name, permissions, system_group) VALUES ($1::uuid, $3::text, '{}', $3)
                      ON CONFLICT (tenant_id, system_group) WHERE deleted_at IS NULL AND system_group IS NOT NULL DO UPDATE SET name = roles.name RETURNING id)
           INSERT INTO user_roles (tenant_id, role_id, user_id, granted_by) SELECT $1::uuid, r.id, $2::uuid, $2::uuid FROM r RETURNING id`, [tenant, userId, group]);
    const attempt = (tenant: string, userId: string, id: string, outcome: "REVIEWED" | "CONTESTED") =>
      service().review(actorOf(tenant, userId), id, { outcome, comment: "revue QA" }, "qa-q266-svc");

    it("third Risk Manager, plain user and author are refused (REVIEWED and CONTESTED); Audit and Committee accept; nothing written on refusal", async () => {
      const t = await newTenant(400);
      const [author, rm2, plain, aud, com] = await Promise.all(["author", "rm2", "plain", "aud", "com"].map((n) => user(t, n)));
      await join(t, author, "RISK_MANAGER"); await join(t, rm2, "RISK_MANAGER");
      await join(t, aud, "AUDIT"); await join(t, com, "RISK_COMMITTEE");
      const first = await mark(t, author, 3 * DAY, SOLE_RM_EXCEPTION);
      const second = await mark(t, author, 2 * DAY, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION);
      for (const id of [first, second]) {
        for (const who of [rm2, plain, author]) {
          for (const outcome of ["REVIEWED", "CONTESTED"] as const) await expect(attempt(t, who, id, outcome)).rejects.toThrow(ForbiddenError);
        }
      }
      expect((await facts(t)).soleRm?.unreviewed).toBe(2);
      expect((await one(`SELECT count(*)::int AS n FROM governance_exception_reviews WHERE tenant_id = $1`, [t])).n).toBe(0);
      await attempt(t, aud, first, "REVIEWED");
      await attempt(t, com, second, "CONTESTED");
      expect((await facts(t)).soleRm?.unreviewed).toBe(1); // CONTESTED still closes nothing
      await attempt(t, aud, second, "REVIEWED");
      expect((await facts(t)).soleRm?.unreviewed).toBe(0);
    });

    it("a member removed from the group (revoked assignment) or whose account is deleted is refused; a non-SOLE_RM exception keeps its old rule", async () => {
      const t = await newTenant(400);
      const [author, aud, other] = await Promise.all(["author", "aud", "other"].map((n) => user(t, n)));
      await join(t, author, "RISK_MANAGER");
      await join(t, aud, "AUDIT");
      const id = await mark(t, author, 3 * DAY, SOLE_RM_EXCEPTION);
      await one(`UPDATE user_roles SET revoked_at = now() WHERE tenant_id = $1 AND user_id = $2 RETURNING id`, [t, aud]);
      await expect(attempt(t, aud, id, "REVIEWED")).rejects.toThrow(ForbiddenError);
      await join(t, other, "AUDIT");
      await one(`UPDATE users SET deleted_at = now() WHERE id = $1 RETURNING id`, [other]);
      await expect(attempt(t, other, id, "REVIEWED")).rejects.toThrow(ForbiddenError);
      // Another marker is not concerned by the group condition: a plain third party can still review it.
      const other2 = await mark(t, author, 3 * DAY, "principle.acceptance.alone");
      await expect(attempt(t, aud, other2, "REVIEWED")).resolves.toBeDefined();
    });

    it("tenant: an Audit member of tenant B cannot review tenant A's confirmation (404 under B, 403 under A); no group service = fail closed", async () => {
      const a = await newTenant(400);
      const b = await newTenant(400);
      const authorA = await user(a, "authorA");
      const audB = await user(b, "audB");
      await join(a, authorA, "RISK_MANAGER");
      await join(b, audB, "AUDIT");
      const id = await mark(a, authorA, 3 * DAY, SOLE_RM_EXCEPTION);
      await expect(attempt(b, audB, id, "REVIEWED")).rejects.toThrow(NotFoundError);
      await expect(attempt(a, audB, id, "REVIEWED")).rejects.toThrow(ForbiddenError);
      const audA = await user(a, "audA");
      await join(a, audA, "AUDIT");
      const noGroups = new GovernanceExceptionService(reviews(), new PostgresAuditRepository(ctx.pool));
      await expect(noGroups.review(actorOf(a, audA), id, { outcome: "REVIEWED", comment: "revue QA" }, "qa")).rejects.toThrow(ForbiddenError);
      expect((await facts(a)).soleRm?.unreviewed).toBe(1);
    });
  });

  it("review: the author cannot review nor contest (repository and trigger); CONTESTED closes nothing, a third party's REVIEWED does", async () => {
    const t = await newTenant(400);
    const rm = await user(t, "rm");
    const aud = await user(t, "aud");
    const com = await user(t, "com");
    const id = await mark(t, rm, 3 * DAY, SOLE_RM_EXCEPTION);
    const frameworks = new PostgresRiskFrameworkRepository(ctx.pool);
    await expect(review(t, id, "REVIEWED", rm)).rejects.toThrow(ForbiddenError);
    await expect(review(t, id, "CONTESTED", rm)).rejects.toThrow(ForbiddenError);
    // Trigger alone, bypassing the repository.
    await expect(ctx.pool.query(
      `INSERT INTO governance_exception_reviews (tenant_id, audit_log_id, outcome, reviewed_by, comment) VALUES ($1, $2, 'REVIEWED', $3, 'x')`, [t, id, rm])).rejects.toThrow();
    await review(t, id, "CONTESTED", aud);
    let f = await facts(t);
    expect(f.soleRm).toEqual({ total: 1, unreviewed: 1, overdue: 0, withoutPriorReview: 0 });
    expect(f.unreviewedTotal).toBe(1); // same semantics as the global counter and forEntities
    expect(await frameworks.hasUnreviewedSoleRm(t)).toBe(true);
    await review(t, id, "REVIEWED", com); // one review per reviewer and entry: the contester cannot also review
    f = await facts(t);
    expect(f.soleRm?.unreviewed).toBe(0);
    expect(f.unreviewedTotal).toBe(0);
    expect(await frameworks.hasUnreviewedSoleRm(t)).toBe(false);
  });
});

/** SEC-Q266-01 boundaries around the SOLE_RM default (in memory; the circuit itself is covered by D4). */
describe("QA q266: exceptionReviewDelayDays lengthening threshold (q182 circuit)", () => {
  const delaysAdmin = { userId: "u-admin", tenantId: "t1", email: "a@x", displayName: "a", roles: ["config.read", "config.governancedelays.set"] } as unknown as AuthenticatedUser;
  const run = async (current: number | null, next: number | null) => {
    const events: Array<Omit<AuditEvent, "id" | "timestamp">> = [];
    let row = { id: "cfg", tenantId: "t1", version: 1, exceptionReviewDelayDays: current } as Config;
    const upsert = async (_t: string, patch: object, by: string) => (row = { ...row, ...patch, updatedBy: by } as Config);
    const service = new ConfigService({ getByTenant: async () => row, upsert },
      { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never,
      undefined, undefined, { existsOther: async () => true }, undefined, fakeDelayRequests(upsert, events).repo);
    const out = await service.setGovernanceDelays(delaysAdmin, { exceptionReviewDelayDays: next }, "QA", "q");
    return { pending: out.pendingRequest !== null, stored: out.config.exceptionReviewDelayDays };
  };
  it.each([
    [null, 30, false], [null, 31, true], [null, 1, false], [null, null, false],
    [10, 11, true], [10, 5, false], [40, 30, false], [40, 41, true],
    [10, null, true], // observation: back to "unset" (effective 30) waits for a second person
    [40, null, true], // observation: effective 40 -> 30 is a shortening, yet waits for a second person (over-cautious, not unsafe)
  ])("from %s to %s: pending = %s", async (current, next, pending) => {
    const r = await run(current, next);
    expect(r.pending).toBe(pending);
    expect(r.stored).toBe(pending ? current : next);
  });
});
