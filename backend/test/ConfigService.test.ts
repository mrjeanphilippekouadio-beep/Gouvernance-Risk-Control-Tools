import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ConfigService } from "../src/services/ConfigService.js";
import type { ConfigRepository } from "../src/domain/repositories/ConfigRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { Config } from "../src/domain/entities/Config.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";

function defaultRow(tenantId: string): Config {
  return {
    id: randomUUID(),
    tenantId,
    scoreFormula: "P_X_I",
    levelThresholds: [],
    impactRetenuRule: "MAX",
    appetiteMode: "AUTO_AVEC_SURCHARGE_MANUELLE",
    evaluationMode: "CLASSIQUE",
    version: 0,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function inMemoryConfigRepository(): ConfigRepository {
  const byTenant = new Map<string, Config>();
  return {
    async getByTenant(tenantId) {
      return byTenant.get(tenantId) ?? null;
    },
    async upsert(tenantId, patch, updatedBy) {
      const before = byTenant.get(tenantId) ?? { ...defaultRow(tenantId), id: randomUUID() };
      const after: Config = {
        ...before,
        ...patch,
        version: before.version + 1,
        updatedBy,
        updatedAt: new Date(),
      };
      byTenant.set(tenantId, after);
      return after;
    },
  };
}

function inMemoryAuditRepository(): { repo: AuditRepository; events: Omit<AuditEvent, "id" | "timestamp">[] } {
  const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
  return {
    events,
    repo: {
      async record(event) {
        events.push(event);
      },
      async listForEntity() {
        return [];
      },
      async listRecent() {
        return [];
      },
    },
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["config.read", "config.update"],
};

const readOnlyActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["config.read"] };

describe("ConfigService", () => {
  it("returns an as-shipped default (version 0) when no config row has ever been saved", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    const config = await service.get(actor);
    expect(config.version).toBe(0);
    expect(config.scoreFormula).toBe("P_X_I");
    expect(config.impactRetenuRule).toBe("MAX");
    expect(config.appetiteMode).toBe("AUTO_AVEC_SURCHARGE_MANUELLE");
  });

  it("rejects get() for an actor without config.read", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    const noPerms: AuthenticatedUser = { ...actor, userId: "user-3", roles: [] };
    await expect(service.get(noPerms)).rejects.toThrow(ForbiddenError);
  });

  it("rejects updateMethodology for an actor without config.update", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(
      service.updateMethodology(readOnlyActor, { scoreFormula: "WEIGHTED_SUM" }, "reason", "REQ-1"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("requires a reason to change methodology settings", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(
      service.updateMethodology(actor, { scoreFormula: "WEIGHTED_SUM" }, "  ", "REQ-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown scoreFormula/impactRetenuRule", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(
      service.updateMethodology(actor, { scoreFormula: "NOT_A_FORMULA" as never }, "because", "REQ-1"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a level threshold where min > max", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(
      service.updateMethodology(
        actor,
        { levelThresholds: [{ label: "Critique", min: 20, max: 10 }] },
        "because",
        "REQ-1",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("updates methodology settings in place and records a fully audited old/new UPDATE event", async () => {
    const { repo: auditRepo, events } = inMemoryAuditRepository();
    const service = new ConfigService(inMemoryConfigRepository(), auditRepo);

    const after = await service.updateMethodology(
      actor,
      { scoreFormula: "WEIGHTED_SUM", impactRetenuRule: "AVERAGE" },
      "Alignement sur la nouvelle méthodologie 2026",
      "REQ-1",
    );

    expect(after.scoreFormula).toBe("WEIGHTED_SUM");
    expect(after.impactRetenuRule).toBe("AVERAGE");
    expect(after.version).toBe(1);

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe("UPDATE");
    expect(event.entityType).toBe("Config");
    expect(event.reason).toBe("Alignement sur la nouvelle méthodologie 2026");
    expect((event.oldValue as Config).version).toBe(0);
    expect((event.oldValue as Config).scoreFormula).toBe("P_X_I");
    expect((event.newValue as Config).scoreFormula).toBe("WEIGHTED_SUM");
  });

  it("applies only the provided fields on a partial methodology update, leaving the rest untouched", async () => {
    const repo = inMemoryConfigRepository();
    const service = new ConfigService(repo, inMemoryAuditRepository().repo);

    await service.updateMethodology(actor, { scoreFormula: "WEIGHTED_SUM" }, "first change", "REQ-1");
    const after = await service.updateMethodology(actor, { impactRetenuRule: "AVERAGE" }, "second change", "REQ-2");

    expect(after.scoreFormula).toBe("WEIGHTED_SUM");
    expect(after.impactRetenuRule).toBe("AVERAGE");
    expect(after.version).toBe(2);
  });

  it("rejects updateAppetiteMode for an actor without config.update", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(service.updateAppetiteMode(readOnlyActor, "MANUEL", "reason", "REQ-1")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("requires a reason to change the appetite mode", async () => {
    const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
    await expect(service.updateAppetiteMode(actor, "MANUEL", "", "REQ-1")).rejects.toThrow(ValidationError);
  });

  it("updates the appetite mode and audits old/new without touching methodology fields", async () => {
    const { repo: auditRepo, events } = inMemoryAuditRepository();
    const service = new ConfigService(inMemoryConfigRepository(), auditRepo);

    const after = await service.updateAppetiteMode(actor, "MANUEL", "Bascule en mode manuel pour Q1", "REQ-1");

    expect(after.appetiteMode).toBe("MANUEL");
    expect(after.scoreFormula).toBe("P_X_I");
    expect(events).toHaveLength(1);
    expect((events[0]!.oldValue as Config).appetiteMode).toBe("AUTO_AVEC_SURCHARGE_MANUELLE");
    expect((events[0]!.newValue as Config).appetiteMode).toBe("MANUEL");
  });

  describe("updateEvaluationMode (DIV-06)", () => {
    it("defaults to CLASSIQUE when no config row has ever been saved", async () => {
      const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
      const config = await service.get(actor);
      expect(config.evaluationMode).toBe("CLASSIQUE");
    });

    it("rejects for an actor without config.update", async () => {
      const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
      await expect(
        service.updateEvaluationMode(readOnlyActor, "PARTICIPATIF", "reason", "REQ-1"),
      ).rejects.toThrow(ForbiddenError);
    });

    it("requires a reason", async () => {
      const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
      await expect(service.updateEvaluationMode(actor, "PARTICIPATIF", "", "REQ-1")).rejects.toThrow(
        ValidationError,
      );
    });

    it("rejects an unknown evaluation mode", async () => {
      const service = new ConfigService(inMemoryConfigRepository(), inMemoryAuditRepository().repo);
      await expect(
        service.updateEvaluationMode(actor, "NOT_A_MODE" as never, "because", "REQ-1"),
      ).rejects.toThrow(ValidationError);
    });

    it("updates the evaluation mode and audits old/new without touching other fields", async () => {
      const { repo: auditRepo, events } = inMemoryAuditRepository();
      const service = new ConfigService(inMemoryConfigRepository(), auditRepo);

      const after = await service.updateEvaluationMode(actor, "PARTICIPATIF", "Pilote Q1 2027", "REQ-1");

      expect(after.evaluationMode).toBe("PARTICIPATIF");
      expect(after.scoreFormula).toBe("P_X_I");
      expect(events).toHaveLength(1);
      expect((events[0]!.oldValue as Config).evaluationMode).toBe("CLASSIQUE");
      expect((events[0]!.newValue as Config).evaluationMode).toBe("PARTICIPATIF");
    });
  });
});
