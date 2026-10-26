import { describe, expect, it } from "vitest";
import { writeAudited } from "../src/services/auditedWrite.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { FindingService } from "../src/services/FindingService.js";
import { GovernanceDesignationService } from "../src/services/GovernanceDesignationService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

const actorOf = (roles: string[], userId = "u-1"): AuthenticatedUser =>
  ({ userId, tenantId: "t-1", email: "a@x.test", roles }) as unknown as AuthenticatedUser;
const event = { tenantId: "t-1", userId: "u-1", entityType: "X", entityId: "1", action: "UPDATE" as const, oldValue: null, newValue: null, reason: null, requestId: "r" };

describe("DECISION-079: writeAudited", () => {
  it("transactional repository: the write gets the audit builder, the service records nothing itself", async () => {
    const recorded: unknown[] = [];
    let received: unknown;
    const out = await writeAudited<string>(
      true,
      { async record(e: unknown) { recorded.push(e); } } as never,
      async (audit) => { received = audit; return "done"; },
      () => [event],
    );
    expect(out).toBe("done");
    expect(typeof received).toBe("function");
    expect(recorded).toEqual([]);
  });

  it("repository without transactional audit (test fakes): write first, then the audit rows", async () => {
    const calls: string[] = [];
    await writeAudited<string>(
      undefined,
      { async record() { calls.push("audit"); } } as never,
      async (audit) => { calls.push(audit ? "write+audit" : "write"); return "done"; },
      () => [event],
    );
    expect(calls).toEqual(["write", "audit"]);
  });
});

describe("DECISION-079: services use the transactional path when the repository declares it", () => {
  it("Finding.close hands the audit to the repository and does not call AuditRepository.record", async () => {
    const finding = { id: "f1", tenantId: "t-1", status: "EN_TRAITEMENT", raisedBy: "maker" };
    const recorded: unknown[] = [];
    let built: unknown[] = [];
    const svc = new FindingService(
      {
        auditsInTransaction: true,
        async getById() { return finding; },
        async close(_t: string, _id: string, _by: string, _c: string, audit: (r: unknown) => unknown[]) {
          const closed = { ...finding, status: "CLOS" };
          built = audit(closed);
          return closed;
        },
      } as never,
      {} as never,
      { async record(e: unknown) { recorded.push(e); } } as never,
    );
    await svc.close(actorOf(["audit.finding.close", "audit.finding.read"], "checker"), "f1", "ok", "r");
    expect(recorded).toEqual([]);
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ entityType: "Finding", action: "CLOSE", userId: "checker" });
  });

  it("setSelfValidationPolicy: one repository call carries the withdrawal and the new request, audit rows included", async () => {
    const pending = { id: "p1", tenantId: "t-1", requestedPolicy: "DOUBLE_CONFIRMATION", reason: "x", status: "PENDING", requestedBy: "a" };
    const recorded: unknown[] = [];
    let change: unknown;
    let events: unknown[] = [];
    const svc = new ConfigService(
      { async getByTenant() { return null; }, async upsert() { throw new Error("must go through change()"); } } as never,
      { async record(e: unknown) { recorded.push(e); } } as never,
      undefined,
      undefined,
      { async existsOther() { return true; } },
      {
        auditsInTransaction: true,
        async getPending() { return pending; },
        async change(_t: string, c: unknown, audit: (r: unknown) => unknown[]) {
          change = c;
          const submitted = { ...pending, id: "p2", requestedBy: "admin" };
          events = audit({ decided: { ...pending, status: "WITHDRAWN" }, submitted, config: null });
          return { decided: { ...pending, status: "WITHDRAWN" }, submitted, config: null };
        },
      } as never,
    );
    const out = await svc.setSelfValidationPolicy(actorOf(["config.read", "config.selfvalidation.set"], "admin"), "DOUBLE_CONFIRMATION", "motif", "r");
    expect(out.pendingRequest?.id).toBe("p2");
    expect(change).toMatchObject({ decide: { id: "p1", status: "WITHDRAWN" }, submit: { policy: "DOUBLE_CONFIRMATION" } });
    expect(events.map((e) => (e as { action: string }).action)).toEqual(["CLOSE", "SUBMIT"]);
    expect(recorded).toEqual([]);
  });

  it("GovernanceDesignation.end: already ended -> ConflictError and no audit row", async () => {
    const recorded: unknown[] = [];
    const svc = new GovernanceDesignationService(
      { async getById() { return { id: "d1", kind: "MANAGER", userId: "u", activatedAt: null }; }, async end() { return null; } } as never,
      { async record(e: unknown) { recorded.push(e); } } as never,
      {} as never,
      {} as never,
    );
    await expect(svc.end(actorOf(["designation.manage"]), "d1", "fin", "r")).rejects.toThrow(/already ended/);
    expect(recorded).toEqual([]);
  });
});
