import { describe, expect, it, vi } from "vitest";
import { PrivacyService } from "../src/services/PrivacyService.js";
import { PostgresLastSeenRetentionRepository } from "../src/infrastructure/database/postgres/PostgresLastSeenRetentionRepository.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";
import { fillPrivacyNotice, retentionLabel } from "../../frontend/src/features/privacy/privacyNotice.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { hasLocalPg, useMigrationTenant } from "./migrationHarness.js";

/** R3 / R5 (q227, DECISION-114) — level 1. */
const actor = (roles: string[]): AuthenticatedUser => ({ userId: "u-admin", tenantId: "t", email: "a@t", roles } as AuthenticatedUser);

describe("R3 — purge of the « dernière activité » date", () => {
  it("needs user.update; uses the client's retention (default 1826); audits each account without copying the erased date", async () => {
    const purge = vi.fn(async (_t: string, _d: number, audit: (ids: string[]) => unknown[]) => { audit(["u1"]); return ["u1"]; });
    const svc = new PrivacyService({ purge, candidates: async () => ["u1", "u2"] } as never, { getByTenant: async () => null });
    await expect(svc.purgeLastSeen(actor([]), "r")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await svc.purgeLastSeen(actor(["user.update"]), "r")).toEqual({ dryRun: false, retentionDays: 1826, erased: 1 });
    const audit = purge.mock.calls[0]![2] as (ids: string[]) => Array<Record<string, unknown>>;
    // q231 B: one execution trace per run (even at zero), then one line per account, never the erased date.
    expect(audit([])).toEqual([expect.objectContaining({ entityType: "LastSeenPurge", newValue: { erased: 0, retentionDays: 1826 } })]);
    expect(audit(["u1"])[1]).toMatchObject({ entityType: "User", entityId: "u1", action: "UPDATE", oldValue: null, newValue: { lastSeenAt: null, purge: "R3" } });
    // dryRun: the accounts concerned, nothing written.
    expect(await svc.purgeLastSeen(actor(["user.update"]), "r", { dryRun: true })).toEqual({ dryRun: true, retentionDays: 1826, wouldErase: 2, userIds: ["u1", "u2"] });
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it("a client that set no limit (null): nothing is erased, the run is still traced", async () => {
    const purge = vi.fn();
    const record = vi.fn(async () => undefined);
    const svc = new PrivacyService({ purge } as never, { getByTenant: async () => ({ lastSeenRetentionDays: null }) as never }, { record });
    expect(await svc.purgeLastSeen(actor(["user.update"]), "r")).toEqual({ dryRun: false, retentionDays: null, erased: 0 });
    expect(purge).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ entityType: "LastSeenPurge", newValue: { erased: 0, retentionDays: null } }));
  });

  it("R5 / q231 B: the notice carries the client's DPO contact when set", async () => {
    const svc = new PrivacyService({} as never, { getByTenant: async () => ({ lastSeenRetentionDays: 730, dpoContact: " dpo@client.ci " }) as never });
    expect(await svc.notice(actor([]))).toEqual({ lastSeenRetentionDays: 730, dpoContact: "dpo@client.ci" });
  });
});

describe("R5 — information text", () => {
  it("duration in years when it is a whole number of years (1826 = 5 ans), in days otherwise; DPO contact never invented", () => {
    expect(retentionLabel(1826)).toBe("5 ans");
    expect(retentionLabel(365)).toBe("1 an");
    expect(retentionLabel(400)).toBe("400 jours");
    const text = fillPrivacyNotice(1826, null).join("\n");
    expect(text).toContain("conservée 5 ans après la fin");
    expect(text).toContain("à renseigner par l'administrateur");
    expect(text).not.toMatch(/\{(duree|contactDpo)\}/);
    // Codex P2 (PR #235): the date moves on a new sign-in or session renewal, not on every activity; name and roles have no duration yet.
    expect(text).toContain("mise à jour à chaque nouvelle connexion ou renouvellement de session");
    expect(text).not.toContain("mise à jour à chaque activité");
    expect(fillPrivacyNotice(null, null).join("\n")).toContain("Votre nom affiché et vos rôles sont conservés avec votre compte, y compris après sa suspension, car ils servent à la traçabilité du journal d'audit ; aucune durée n'est fixée à ce jour.");
    // QA-D6-03: no retention (null) never says « puis effacée ».
    const none = fillPrivacyNotice(null, null).join("\n");
    expect(none).toContain("conservée sans limite de durée fixée par votre organisation.");
    expect(none).not.toContain("puis effacée");
  });
});

describe.skipIf(!hasLocalPg)("R3 on real PostgreSQL (local only)", () => {
  const { ctx, one } = useMigrationTenant("r3");
  it("erases only the dates of accounts suspended longer than the retention; idempotent; audit in the same transaction", async () => {
    const mk = async (name: string, suspendedDaysAgo: number | null) =>
      (await one(
        `INSERT INTO users (tenant_id, email, display_name, last_seen_at, last_token_iat, deleted_at)
         VALUES ($1, $2, $3, now(), 1700000000, CASE WHEN $4::int IS NULL THEN NULL ELSE now() - make_interval(days => $4::int) END) RETURNING id`,
        [ctx.tenant, `${name}-${Math.random()}@r3`, name, suspendedDaysAgo],
      )).id as string;
    const [old, recent, active] = [await mk("old", 40), await mk("recent", 5), await mk("active", null)];
    const repo = new PostgresLastSeenRetentionRepository(ctx.pool);
    const requestId = `r3-${Math.random()}`;
    const audit = (ids: string[]) => ids.map((id) => ({ tenantId: ctx.tenant, userId: active!, entityType: "User", entityId: id, action: "UPDATE" as const, oldValue: null, newValue: { purge: "R3" }, reason: "R3", requestId }));
    expect(await repo.candidates(ctx.tenant, 30)).toEqual([old]);
    expect(await repo.purge(ctx.tenant, 30, audit)).toEqual([old]);
    expect(await repo.purge(ctx.tenant, 30, audit)).toEqual([]);
    const rows = (await ctx.pool.query(`SELECT id, last_seen_at, last_token_iat FROM users WHERE id = ANY($1)`, [[old, recent, active]])).rows;
    expect(rows.find((r) => r.id === old)).toMatchObject({ last_seen_at: null, last_token_iat: null });
    expect(rows.find((r) => r.id === recent)?.last_seen_at).not.toBeNull();
    expect(rows.find((r) => r.id === active)?.last_seen_at).not.toBeNull();
    expect(Number((await one(`SELECT count(*) AS n FROM audit_log WHERE request_id = $1`, [requestId])).n)).toBe(1);
  });
});
