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
  function configWorld(thirdParty: boolean | "unwired") {
    const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
    let row: Config | null = null;
    const service = new ConfigService(
      {
        getByTenant: async () => row,
        upsert: async (tenantId, patch, by) => (row = { ...(row ?? ({ id: "cfg", tenantId, version: 0 } as Config)), ...patch, updatedBy: by } as Config),
      },
      { record: async (e: Omit<AuditEvent, "id" | "timestamp">) => { events.push(e); } } as never,
      undefined,
      undefined,
      thirdParty === "unwired" ? undefined : { existsGovernanceThirdParty: async () => thirdParty },
    );
    return { service, events };
  }
  const admin = actor("u-admin", ["config.read", "config.selfvalidation.set"]);

  it("needs its dedicated permission", async () => {
    await expect(configWorld(false).service.setSelfValidationPolicy(actor("u", ["config.read", "config.update"]), "DOUBLE_CONFIRMATION", "r", "q")).rejects.toThrow(ForbiddenError);
  });

  it("needs a reason and a known value", async () => {
    const { service } = configWorld(false);
    await expect(service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "  ", "q")).rejects.toThrow(ValidationError);
    await expect(service.setSelfValidationPolicy(admin, "ALLOW" as never, "r", "q")).rejects.toThrow(ValidationError);
  });

  it("administrator alone: applied, audited with before/after, reason and adminAlone marker", async () => {
    const { service, events } = configWorld(false);
    const after = await service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "Structure à une personne", "q");
    expect(after.selfValidationPolicy).toBe("DOUBLE_CONFIRMATION");
    expect(events[0]).toMatchObject({
      entityType: "Config", action: "UPDATE", reason: "Structure à une personne", userId: "u-admin",
      governanceException: "config.selfvalidation.adminAlone",
    });
    expect((events[0]!.oldValue as Config).selfValidationPolicy).toBe("REFUSE");
  });

  it("a third party exists (or cannot be told): applied with the distinct 'direct' marker, the two-person circuit being not built", async () => {
    for (const tp of [true, "unwired"] as const) {
      const { service, events } = configWorld(tp);
      await service.setSelfValidationPolicy(admin, "DOUBLE_CONFIRMATION", "r", "q");
      expect(events[0]!.governanceException).toBe("config.selfvalidation.direct");
    }
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
