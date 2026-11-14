import { describe, expect, it, vi } from "vitest";
import { PrivacyService } from "../src/services/PrivacyService.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/** Conservation L2b (q248 B) — erasure of visibility reasons under `retention.purge`, level 1. */
const actor = (roles: string[]): AuthenticatedUser => ({ userId: "u-admin", tenantId: "t", email: "a@t", roles } as AuthenticatedUser);
type Rows = Array<{ id: string; source: string }>;

const reasons = () => ({
  purge: vi.fn(async (_t: string, _d: number, audit: (rows: Rows) => unknown[]) => { audit([{ id: "r1", source: "VISIBILITY_CHANGE" }]); return [{ id: "r1", source: "VISIBILITY_CHANGE" }]; }),
  candidates: vi.fn(async () => [{ id: "r1", source: "VISIBILITY_CHANGE" }, { id: "r2", source: "ACCESS_RENEWAL" }]),
});
const svc = (repo: ReturnType<typeof reasons> | undefined, config: unknown = { visibilityReasonRetentionDays: 365 }, record = vi.fn(async () => undefined)) =>
  new PrivacyService({} as never, { getByTenant: async () => config as never }, { record }, repo as never);

describe("L2b: erasure of visibility reasons (retention.purge)", () => {
  it("needs its own permission (user.update is not enough) and a wired repository", async () => {
    await expect(svc(reasons()).purgeVisibilityReasons(actor(["user.update"]), "r")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(undefined).purgeVisibilityReasons(actor(["retention.purge"]), "r")).rejects.toThrow(/not available/);
  });

  it("dryRun lists ids and writes nothing; a real run traces the run and each reason, never the text", async () => {
    const repo = reasons();
    expect(await svc(repo).purgeVisibilityReasons(actor(["retention.purge"]), "r", { dryRun: true })).toEqual({ dryRun: true, retentionDays: 365, wouldErase: 2, reasonIds: ["r1", "r2"] });
    expect(repo.purge).not.toHaveBeenCalled();
    expect(await svc(repo).purgeVisibilityReasons(actor(["retention.purge"]), "r")).toEqual({ dryRun: false, retentionDays: 365, erased: 1 });
    const build = repo.purge.mock.calls[0]![2] as (rows: Rows) => Array<Record<string, unknown>>;
    const events = build([{ id: "r1", source: "VISIBILITY_CHANGE" }]);
    expect(events[0]).toMatchObject({ entityType: "VisibilityReasonPurge", newValue: { erased: 1, retentionDays: 365 } });
    expect(events[1]).toMatchObject({ entityType: "VisibilityReason", entityId: "r1", oldValue: null, newValue: { source: "VISIBILITY_CHANGE", text: null } });
  });

  it("no retention (null = never): nothing erased, the run is still traced; no config row means 365", async () => {
    const repo = reasons();
    const record = vi.fn(async () => undefined);
    expect(await svc(repo, { visibilityReasonRetentionDays: null }, record).purgeVisibilityReasons(actor(["retention.purge"]), "r")).toEqual({ dryRun: false, retentionDays: null, erased: 0 });
    expect(repo.purge).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledOnce();
    expect(await svc(repo, null).purgeVisibilityReasons(actor(["retention.purge"]), "r", { dryRun: true })).toMatchObject({ retentionDays: 365 });
  });
});
