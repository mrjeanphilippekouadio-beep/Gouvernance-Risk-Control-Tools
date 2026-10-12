import { describe, expect, it, vi } from "vitest";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// F-D044-03: RatingScaleService audit goes in the repository transaction when it supports it, else right after.

const scale = { id: "s1", tenantId: "t1", status: "DRAFT", probabilityLevels: 5, impactLevels: 5 } as RatingScale;
const actor = { userId: "u1", tenantId: "t1", email: "a@x", roles: ["ratingscale.update", "ratingscale.read"] } as unknown as AuthenticatedUser;
const thresholds = { thresholds: [{ label: "Low", min: 1, max: 5 }] } as never;

function setup(inTx: boolean) {
  const record = vi.fn(async () => {});
  const updateThresholds = vi.fn(async (_t: string, _id: string, _th: unknown, audit?: (r: RatingScale) => unknown[]) => {
    void audit;
    return scale;
  });
  const repo = { auditsInTransaction: inTx || undefined, getById: async () => scale, updateThresholds };
  const service = new RatingScaleService(repo as never, { record } as never, { existsForRatingScale: async () => false });
  return { service, record, updateThresholds };
}

describe("RatingScaleService audit in the write transaction (F-D044-03)", () => {
  it("hands the audit events to the repository and records nothing itself", async () => {
    const { service, record, updateThresholds } = setup(true);
    await service.updateThresholds(actor, "s1", thresholds, "req");
    expect(record).not.toHaveBeenCalled();
    const build = updateThresholds.mock.calls[0]![3]!;
    expect(build(scale)).toMatchObject([{ entityType: "RatingScale", entityId: "s1", action: "UPDATE", userId: "u1", tenantId: "t1" }]);
  });

  it("falls back to recording after the write for repositories without transactional audit", async () => {
    const { service, record, updateThresholds } = setup(false);
    await service.updateThresholds(actor, "s1", thresholds, "req");
    expect(updateThresholds.mock.calls[0]![3]).toBeUndefined();
    expect(record).toHaveBeenCalledTimes(1);
  });
});
