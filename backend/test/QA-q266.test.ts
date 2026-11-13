import { describe, expect, it } from "vitest";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { SOLE_RM_EXCEPTION, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION } from "../src/domain/entities/GovernanceReviews.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
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

  it("GAP A06 (pinned): 'previous not reviewed' ignores trackedSince while the counter honours it", async () => {
    const t = await newTenant(10);
    const rm = await user(t, "rm");
    await mark(t, rm, 60 * DAY, SOLE_RM_EXCEPTION); // before tracking started (q143)
    const frameworks = new PostgresRiskFrameworkRepository(ctx.pool);
    expect((await facts(t)).soleRm?.total).toBe(0);
    // The marker check sees it: the next confirmation is flagged "withoutPriorReview" although the panel shows nothing to review.
    expect(await frameworks.hasUnreviewedSoleRm(t)).toBe(true);
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
