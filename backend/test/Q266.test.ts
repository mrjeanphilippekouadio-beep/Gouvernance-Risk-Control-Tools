import { describe, expect, it } from "vitest";
import { PostgresGovernanceHealthRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceHealthRepository.js";
import { PostgresGovernanceExceptionReviewRepository } from "../src/infrastructure/database/postgres/PostgresGovernanceExceptionReviewRepository.js";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { SOLE_RM_EXCEPTION, SOLE_RM_REVIEW_DEFAULT_DAYS, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION } from "../src/domain/entities/GovernanceReviews.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
import { hasLocalPg, useMigrationTenant } from "./migrationHarness.js";

/** q266 A (DECISION-128, lot R1) — level 1, real PostgreSQL (local disposable cluster only). Service-level cases: B6c, B13, governance-health. */
const DAY = 86_400_000;

describe.skipIf(!hasLocalPg)("q266 A: SOLE_RM confirmations are reviewed a posteriori by a third party (real PostgreSQL, local only)", () => {
  const { ctx, one } = useMigrationTenant("q266");

  it("unreviewed, overdue after the delay (default when unset, tenant's otherwise), closed by a third party's review; the author cannot review", async () => {
    const user = async (name: string) =>
      (await one(`INSERT INTO users (tenant_id, email, display_name) VALUES ($1, $2, $3) RETURNING id`, [ctx.tenant, `${name}-${Math.random()}@q266`, name])).id as string;
    const [rm, third] = await Promise.all([user("rm"), user("third")]);
    await one(`UPDATE tenants SET governance_tracking_started_at = now() - interval '100 days' WHERE id = $1 RETURNING id`, [ctx.tenant]);
    const mark = async (daysAgo: number, marker: string | null, entityType = "RiskFrameworkChangeRequest", action = "APPROVE") =>
      (await one(
        `INSERT INTO audit_log (tenant_id, user_id, entity_type, entity_id, action, old_value, new_value, request_id, governance_exception, "timestamp")
         VALUES ($1, $2, $3, gen_random_uuid(), $4, '{}', '{}', $5, $6, now() - $7 * interval '1 day') RETURNING id`,
        [ctx.tenant, rm, entityType, action, `q266-${Math.random()}`, marker, daysAgo])).id as string;
    // ASSIGN_PROCESS (old) and SET_DEFAULT (recent) confirmations, then one made while the previous were not reviewed.
    const assign = await mark(40, SOLE_RM_EXCEPTION);
    const setDefault = await mark(5, SOLE_RM_EXCEPTION);
    const recurrent = await mark(1, SOLE_RM_WITHOUT_PRIOR_REVIEW_EXCEPTION);
    // The unmarked Process / RiskFramework rows of the same confirmations are not counted: one confirmation = one exception.
    await mark(40, null, "Process", "UPDATE");
    await mark(5, null, "RiskFramework", "UPDATE");

    const health = new PostgresGovernanceHealthRepository(ctx.pool);
    const soleRm = async () => (await health.loadFacts(ctx.tenant, new Date())).soleRm;
    // No tenant delay (q168 unset): the SOLE_RM default applies, never "no delay".
    expect(SOLE_RM_REVIEW_DEFAULT_DAYS).toBe(30);
    expect(await soleRm()).toEqual({ total: 3, unreviewed: 3, overdue: 1, withoutPriorReview: 1 });
    // The tenant's delay wins when set.
    await one(`INSERT INTO configs (tenant_id, exception_review_delay_days) VALUES ($1, 3) ON CONFLICT (tenant_id) DO UPDATE SET exception_review_delay_days = 3 RETURNING tenant_id`, [ctx.tenant]);
    expect(await soleRm()).toEqual({ total: 3, unreviewed: 3, overdue: 2, withoutPriorReview: 1 });
    const frameworks = new PostgresRiskFrameworkRepository(ctx.pool);
    expect(await frameworks.hasUnreviewedSoleRm(ctx.tenant)).toBe(true);

    const reviews = new PostgresGovernanceExceptionReviewRepository(ctx.pool);
    const events = (by: string) => (r: { id: string }) => [{ tenantId: ctx.tenant, userId: by, entityType: "GovernanceExceptionReview", entityId: r.id, action: "CREATE" as const, oldValue: null, newValue: null, reason: "revue", requestId: "q266" }];
    // The author of the confirmation cannot review it (trigger + repository).
    await expect(reviews.insert({ tenantId: ctx.tenant, auditLogId: assign, outcome: "REVIEWED", reviewedBy: rm, comment: "ok" }, events(rm))).rejects.toThrow(ForbiddenError);
    expect((await soleRm())?.unreviewed).toBe(3);
    // A third party's review closes each one.
    for (const id of [assign, setDefault, recurrent]) {
      await reviews.insert({ tenantId: ctx.tenant, auditLogId: id, outcome: "REVIEWED", reviewedBy: third, comment: "ok" }, events(third));
    }
    expect(await soleRm()).toEqual({ total: 3, unreviewed: 0, overdue: 0, withoutPriorReview: 1 });
    expect(await frameworks.hasUnreviewedSoleRm(ctx.tenant)).toBe(false);
  });
});
