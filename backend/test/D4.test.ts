import { describe, expect, it } from "vitest";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { withIndependence } from "../src/api/validationIndependence.js";
import { GovernanceConfirmationBody } from "../src/api/validation.js";
import { selfValidationOutcome, type GovernanceConfirmation } from "../src/domain/governance/selfValidation.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { ControlExecution } from "../src/domain/entities/ControlExecution.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

/** Lot D4 (DECISION-074): self-validation policy, gate, config route service, validationIndependence. Level 1. */

const confirmation: GovernanceConfirmation = { rule: "noSelfValidation", reason: "Seule personne de la structure" };

describe("selfValidationOutcome", () => {
  it("not self -> ALLOW whatever the policy", () => {
    expect(selfValidationOutcome("REFUSE", false, true)).toBe("ALLOW");
  });
  it("REFUSE policy refuses a self-validation, even with a confirmation", () => {
    expect(selfValidationOutcome("REFUSE", true, false, confirmation)).toBe("REFUSE");
  });
  it("DOUBLE_CONFIRMATION is not offered when somebody else can validate (q141)", () => {
    expect(selfValidationOutcome("DOUBLE_CONFIRMATION", true, true, confirmation)).toBe("OTHER_VALIDATOR_EXISTS");
  });
  it("DOUBLE_CONFIRMATION with nobody else needs the explicit confirmation", () => {
    expect(selfValidationOutcome("DOUBLE_CONFIRMATION", true, false)).toBe("CONFIRMATION_REQUIRED");
    expect(selfValidationOutcome("DOUBLE_CONFIRMATION", true, false, { rule: "noSelfValidation", reason: "  " })).toBe("CONFIRMATION_REQUIRED");
    expect(selfValidationOutcome("DOUBLE_CONFIRMATION", true, false, confirmation)).toBe("ALLOW");
  });
});

describe("GovernanceConfirmationBody", () => {
  it("requires the rule and a bounded non-empty reason", () => {
    expect(GovernanceConfirmationBody.safeParse(confirmation).success).toBe(true);
    expect(GovernanceConfirmationBody.safeParse({ rule: "other", reason: "x" }).success).toBe(false);
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "  " }).success).toBe(false);
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "x".repeat(501) }).success).toBe(false);
  });
});

const actor = (userId: string, roles: AuthenticatedUser["roles"]): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: `${userId}@x`, displayName: userId, roles }) as AuthenticatedUser;

const executor = actor("u-exec", ["execution.read", "execution.validate"]);

function world(policy: Config["selfValidationPolicy"] | null, otherValidatorExists: boolean) {
  const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
  const queries: Array<{ permission: string; exclude: string[] | undefined }> = [];
  const execution: ControlExecution = {
    id: "e1", tenantId: "t1", controlId: "c1", plannedDate: null, completedDate: null, executedBy: "u-exec",
    result: null, observedAnomalies: null, justificationIfNotDone: null, status: "DONE", validatedBy: null,
    validatedAt: null, createdAt: new Date(),
  };
  const gate = new SelfValidationGate(
    { getByTenant: async () => (policy ? ({ selfValidationPolicy: policy } as Config) : null) },
    { existsOther: async (_t, _a, permission, exclude) => { queries.push({ permission, exclude }); return otherValidatorExists; } },
  );
  const build = (withGate = true) =>
    new ControlExecutionService(
      {
        getById: async () => execution,
        recordValidation: async (_t, _id, by) => ({ ...execution, validatedBy: by, validatedAt: new Date() }),
      } as never,
      {} as never,
      { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); }, listForEntity: async () => [] } as never,
      withGate ? gate : undefined,
    );
  return { build, events, queries };
}

describe("self-validation guard (ControlExecutionService.validate)", () => {
  it("another person validating is unchanged: no marker, no validator query", async () => {
    const w = world("DOUBLE_CONFIRMATION", false);
    await w.build().validate(actor("u-other", ["execution.read", "execution.validate"]), "e1", null, "r");
    expect(w.events[0]!.governanceException).toBeUndefined();
    expect(w.queries).toHaveLength(0);
  });

  it("without a gate, or with the default policy, a self-validation is refused as before", async () => {
    await expect(world(null, false).build(false).validate(executor, "e1", null, "r", confirmation)).rejects.toThrow(ForbiddenError);
    const w = world("REFUSE", false);
    await expect(w.build().validate(executor, "e1", null, "r", confirmation)).rejects.toThrow(ForbiddenError);
    expect(w.events).toHaveLength(0);
  });

  it("DOUBLE_CONFIRMATION but another validator exists: refused, makers excluded from the search", async () => {
    const w = world("DOUBLE_CONFIRMATION", true);
    await expect(w.build().validate(executor, "e1", null, "r", confirmation)).rejects.toThrow(/un autre validateur existe/);
    expect(w.queries[0]).toEqual({ permission: "execution.validate", exclude: ["u-exec"] });
  });

  it("DOUBLE_CONFIRMATION, nobody else, no confirmation: 409 and nothing written", async () => {
    const w = world("DOUBLE_CONFIRMATION", false);
    await expect(w.build().validate(executor, "e1", null, "r")).rejects.toThrow(ConflictError);
    expect(w.events).toHaveLength(0);
  });

  it("DOUBLE_CONFIRMATION, nobody else, confirmed: applied, audit carries the explicit marker and the reason", async () => {
    const w = world("DOUBLE_CONFIRMATION", false);
    const result = await w.build().validate(executor, "e1", "ok", "r", confirmation);
    expect(result.validatedBy).toBe("u-exec");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]!.governanceException).toBe("noSelfValidation");
    expect(w.events[0]!.newValue).toMatchObject({ selfValidation: { otherValidatorExists: false, reason: confirmation.reason } });
    expect(w.events[0]!.userId).toBe("u-exec");
  });
});

describe("ConfigService.setSelfValidationPolicy", () => {
  type Req = import("../src/domain/repositories/SelfValidationPolicyRequestRepository.js").SelfValidationPolicyRequest;
  function configWorld(approver: boolean | "unwired", initial: "REFUSE" | "DOUBLE_CONFIRMATION" = "REFUSE") {
    const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
    let row: Config | null = { id: "cfg", tenantId: "t1", version: 1, selfValidationPolicy: initial } as Config;
    let request: Req | null = null;
    const requests = {
      getPending: async () => (request?.status === "PENDING" ? request : null),
      getById: async (_t: string, id: string) => (request?.id === id ? request : null),
      create: async (t: string, policy: never, reason: string, by: string, expiresAt?: Date | null) => (request = { id: "req1", tenantId: t, requestedPolicy: policy, reason, status: "PENDING", requestedBy: by, requestedAt: new Date(), decidedBy: null, decidedAt: null, decisionReason: null, expiresAt: expiresAt ?? null }),
      decide: async (_t: string, id: string, status: never, by: string, why: string | null) =>
        request?.id === id && request.status === "PENDING" ? (request = { ...request, status, decidedBy: by, decisionReason: why }) : null,
      reopen: async () => { if (request) request = { ...request, status: "PENDING", decidedBy: null }; },
    };
    const service = new ConfigService(
      {
        getByTenant: async () => row,
        upsert: async (tenantId, patch, by) => (row = { ...(row ?? ({ id: "cfg", tenantId, version: 0 } as Config)), ...patch, updatedBy: by } as Config),
      },
      { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never,
      undefined,
      undefined,
      approver === "unwired" ? undefined : { existsOther: async () => approver },
      requests,
    );
    return { service, events, policy: () => row!.selfValidationPolicy, request: () => request };
  }
  const admin = actor("u-admin", ["config.read", "config.selfvalidation.set"]);
  const approverActor = actor("u-rm", ["config.read", "config.selfvalidation.approve"]);

  it("needs its dedicated permission", async () => {
    await expect(configWorld(false).service.setSelfValidationPolicy(actor("u", ["config.read", "config.update"]), "DOUBLE_CONFIRMATION", "r", "q")).rejects.toThrow(ForbiddenError);
  });

  it("needs a reason and a known value", async () => {
    const { service } = configWorld(false);
    await expect(service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "  ", "q")).rejects.toThrow(ValidationError);
    await expect(service.setSelfValidationPolicy(admin, "ALLOW" as never, "r", "q")).rejects.toThrow(ValidationError);
  });

  it("q158 no approver exists: the administrator applies alone, audited with before/after, reason and adminAlone marker", async () => {
    const w = configWorld(false);
    const { config, pendingRequest } = await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "Structure à une personne", "q");
    expect(pendingRequest).toBeNull();
    expect(config.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
    expect(w.events[0]).toMatchObject({
      entityType: "Config", action: "UPDATE", reason: "Structure à une personne", userId: "u-admin",
      governanceException: "config.selfvalidation.adminAlone",
    });
    expect((w.events[0]!.oldValue as Config).selfValidationPolicy).toBe("REFUSE");
  });

  it("q158 an approver exists: relaxing is only requested (policy unchanged), no adminAlone marker", async () => {
    const w = configWorld(true);
    const { config, pendingRequest } = await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
    expect(config.selfValidationPolicy).toBe("REFUSE");
    expect(pendingRequest).toMatchObject({ status: "PENDING", requestedBy: "u-admin", requestedPolicy: "DOUBLE_CONFIRMATION" });
    expect(w.policy()).toBe("REFUSE");
    expect(w.events).toHaveLength(1);
    expect(w.events[0]).toMatchObject({ entityType: "SelfValidationPolicyRequest", action: "SUBMIT" });
    expect(w.events[0]!.governanceException).toBeUndefined();
  });

  it("q158 relaxing fails closed when the approver query or the request store is not wired", async () => {
    await expect(configWorld("unwired").service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q")).rejects.toThrow(ValidationError);
  });

  it("q158 tightening and a no-op change stay direct and unmarked, even with an approver", async () => {
    const tighten = configWorld(true, "DOUBLE_CONFIRMATION");
    await tighten.service.setSelfValidationPolicy(admin, "REFUSE", "durcir", "q");
    expect(tighten.policy()).toBe("REFUSE");
    expect(tighten.events[0]!.governanceException).toBeUndefined();
    const noop = configWorld(true, "REFUSE");
    await noop.service.setSelfValidationPolicy(admin, "REFUSE", "rien", "q");
    expect(noop.events[0]!.governanceException).toBeUndefined();
    expect(noop.request()).toBeNull();
  });

  it("DECISION-083 governance delays: own permission, reason, whole days or null, audited", async () => {
    const w = configWorld(true);
    const delaysAdmin = actor("u-admin", ["config.read", "config.governancedelays.set"]);
    await expect(w.service.setGovernanceDelays(admin, { policyRequestExpiryDays: 7 }, "r", "q")).rejects.toThrow(ForbiddenError);
    await expect(w.service.setGovernanceDelays(delaysAdmin, { policyRequestExpiryDays: 7 }, " ", "q")).rejects.toThrow(ValidationError);
    for (const bad of [0, -1, 1.5, 3651]) {
      await expect(w.service.setGovernanceDelays(delaysAdmin, { acceptanceMaxDays: bad }, "r", "q")).rejects.toThrow(ValidationError);
    }
    await expect(w.service.setGovernanceDelays(delaysAdmin, {}, "r", "q")).rejects.toThrow(ValidationError);
    const after = await w.service.setGovernanceDelays(delaysAdmin, { exceptionReviewDelayDays: 30, acceptanceMaxDays: 90, policyRequestExpiryDays: 7 }, "Paramétrage", "q");
    expect([after.exceptionReviewDelayDays, after.acceptanceMaxDays, after.policyRequestExpiryDays]).toEqual([30, 90, 7]);
    expect(w.events.at(-1)).toMatchObject({ entityType: "Config", reason: "Paramétrage" });
    const cleared = await w.service.setGovernanceDelays(delaysAdmin, { acceptanceMaxDays: null }, "r", "q");
    // The dedicated permission alone is enough: config.read is not required on top.
    await expect(w.service.setGovernanceDelays(actor("u-only", ["config.governancedelays.set"]), { acceptanceMaxDays: 5 }, "r", "q")).resolves.toMatchObject({ acceptanceMaxDays: 5 });
    expect([cleared.acceptanceMaxDays, cleared.policyRequestExpiryDays]).toEqual([null, 7]);
  });

  it("q174: a request past the configured expiry cannot be approved (still rejectable); the pending view shows its expiry", async () => {
    const w = configWorld(true);
    await w.service.setGovernanceDelays(actor("u-admin", ["config.read", "config.governancedelays.set"]), { policyRequestExpiryDays: 7 }, "r", "q");
    await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
    const pending = await w.service.getPendingSelfValidationPolicyRequest(approverActor);
    expect(Math.abs(pending!.expiresAt!.getTime() - pending!.requestedAt.getTime() - 7 * 86_400_000)).toBeLessThan(1000);
    w.request()!.expiresAt = new Date(Date.now() - 1000);
    // F-SAD-02: clearing the delay afterwards does not revive the expired request.
    await w.service.setGovernanceDelays(actor("u-admin", ["config.read", "config.governancedelays.set"]), { policyRequestExpiryDays: null }, "r", "q");
    await expect(w.service.approveSelfValidationPolicy(approverActor, "req1", "q")).rejects.toThrow(/expired/);
    expect(w.policy()).toBe("REFUSE");
    await expect(w.service.rejectSelfValidationPolicy(approverActor, "req1", "Échue", "q")).resolves.toMatchObject({ status: "REJECTED" });
  });

  it("q158 another person approves: policy applied, audited APPROVE; the author never can", async () => {
    const w = configWorld(true);
    await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
    await expect(w.service.approveSelfValidationPolicy(actor("u-admin", ["config.selfvalidation.set", "config.selfvalidation.approve"]), "req1", "q")).rejects.toThrow(ForbiddenError);
    await expect(w.service.approveSelfValidationPolicy(admin, "req1", "q")).rejects.toThrow(ForbiddenError); // no approve permission
    expect(w.policy()).toBe("REFUSE");
    const after = await w.service.approveSelfValidationPolicy(approverActor, "req1", "q");
    expect(after.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
    expect(w.events.at(-1)).toMatchObject({ entityType: "Config", action: "APPROVE", userId: "u-rm" });
    await expect(w.service.approveSelfValidationPolicy(approverActor, "req1", "q")).rejects.toThrow(ValidationError); // already decided
  });

  it("q158 a rejection needs a reason, leaves the policy unchanged, and never comes from the author", async () => {
    const w = configWorld(true);
    await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
    await expect(w.service.rejectSelfValidationPolicy(approverActor, "req1", " ", "q")).rejects.toThrow(ValidationError);
    await expect(w.service.rejectSelfValidationPolicy(actor("u-admin", ["config.selfvalidation.approve"]), "req1", "non", "q")).rejects.toThrow(ForbiddenError);
    const rejected = await w.service.rejectSelfValidationPolicy(approverActor, "req1", "non", "q");
    expect(rejected.status).toBe("REJECTED");
    expect(w.policy()).toBe("REFUSE");
  });

  it("q158 a new change replaces a pending request (WITHDRAWN)", async () => {
    const w = configWorld(true);
    await w.service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
    await w.service.setSelfValidationPolicy(admin, "REFUSE", "annule", "q");
    expect(w.request()!.status).toBe("WITHDRAWN");
    expect(w.events.some((e) => e.entityType === "SelfValidationPolicyRequest" && e.action === "CLOSE")).toBe(true);
  });
});

describe("withIndependence (q142, q153)", () => {
  const lookup = {
    forEntities: async (_t: string, _type: string, ids: string[]) =>
      new Map(ids.map((id) => [id, id === "a" ? ("WITHOUT_INDEPENDENT_REVIEW" as const) : ("INDEPENDENT" as const)])),
  };
  it("decorates an object and a list without touching the status", async () => {
    const f = withIndependence(lookup, "ControlExecution");
    expect(await f("t1", { id: "a", status: "VALIDATED" })).toEqual({ id: "a", status: "VALIDATED", validationIndependence: "WITHOUT_INDEPENDENT_REVIEW" });
    expect((await f("t1", [{ id: "a" }, { id: "b" }])).map((x) => x.validationIndependence)).toEqual(["WITHOUT_INDEPENDENT_REVIEW", "INDEPENDENT"]);
  });
  it("is a no-op without a lookup", async () => {
    const data = { id: "a" };
    expect(await withIndependence(undefined, "X")("t1", data)).toBe(data);
  });
});
