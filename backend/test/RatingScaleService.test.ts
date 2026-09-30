import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRatingScaleRepository(): RatingScaleRepository {
  const store = new Map<string, RatingScale>();
  return {
    async getById(tenantId, id) {
      const s = store.get(id);
      return s && s.tenantId === tenantId && !s.deletedAt ? s : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (s) => s.tenantId === tenantId && !s.deletedAt && (options?.includeArchived || s.status !== "ARCHIVED"),
      );
    },
    async create(input) {
      const scale: RatingScale = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        version: input.version,
        status: "DRAFT",
        probabilityLevels: input.probabilityLevels,
        probabilityLabels: input.probabilityLabels ?? null,
        impactLevels: input.impactLevels,
        impactLabels: input.impactLabels ?? null,
        criticalityThresholds: null,
        impactAxes: null,
        velocityLevels: null,
        persistenceLevels: null,
        masteryScale: null,
        activatedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(scale.id, scale);
      return scale;
    },
    async updateThresholds(tenantId, id, thresholds) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, criticalityThresholds: thresholds, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async updateImpactAxes(tenantId, id, config) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, impactAxes: config, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async updateVelocity(tenantId, id, levels) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, velocityLevels: levels, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async updatePersistence(tenantId, id, levels) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, persistenceLevels: levels, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async updateMastery(tenantId, id, config) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, masteryScale: config, updatedAt: new Date() };
      store.set(id, updated);
      return updated;
    },
    async activateAndArchivePrevious(tenantId, id) {
      const target = store.get(id);
      if (!target || target.tenantId !== tenantId) throw new Error("not found");
      for (const [otherId, other] of store) {
        if (other.tenantId === tenantId && other.status === "ACTIVE" && otherId !== id) {
          store.set(otherId, { ...other, status: "ARCHIVED", archivedAt: new Date(), updatedAt: new Date() });
        }
      }
      const activated: RatingScale = {
        ...target,
        status: "ACTIVE",
        activatedAt: new Date(),
        archivedAt: null,
        updatedAt: new Date(),
      };
      store.set(id, activated);
      return activated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
  };
}

function inMemoryAuditRepository(): AuditRepository {
  return {
    async record() {},
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

const actor: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "jp@example.com",
  displayName: "JP",
  roles: ["ratingscale.read", "ratingscale.create", "ratingscale.update", "ratingscale.delete"],
};

const readOnlyActor: AuthenticatedUser = { ...actor, userId: "user-2", roles: ["ratingscale.read"] };

function newService() {
  return new RatingScaleService(inMemoryRatingScaleRepository(), inMemoryAuditRepository());
}

async function createBaseScale(service: RatingScaleService) {
  return service.create(actor, { name: "Djamo Risk Scale", version: "2026.1", probabilityLevels: 5, impactLevels: 5 }, "REQ-1");
}

describe("RatingScaleService", () => {
  it("creates a DRAFT scale with valid dimensions", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    expect(scale.status).toBe("DRAFT");
    expect(scale.probabilityLevels).toBe(5);
    expect(scale.impactLevels).toBe(5);
  });

  it("rejects an out-of-range dimension", async () => {
    const service = newService();
    await expect(
      service.create(actor, { name: "Bad", version: "v1", probabilityLevels: 6, impactLevels: 5 }, "REQ-2"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects creation without the ratingscale.create permission", async () => {
    const service = newService();
    await expect(
      service.create(readOnlyActor, { name: "Bad", version: "v1", probabilityLevels: 5, impactLevels: 5 }, "REQ-3"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("configures criticality thresholds (ACT-171)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    const updated = await service.updateThresholds(
      actor,
      scale.id,
      {
        thresholds: [
          { label: "Faible", min: 1, max: 4 },
          { label: "Modéré", min: 5, max: 9 },
          { label: "Élevé", min: 10, max: 14 },
          { label: "Majeur", min: 15, max: 19 },
          { label: "Critique", min: 20, max: 25 },
        ],
      },
      "REQ-4",
    );
    expect(updated.criticalityThresholds).toHaveLength(5);
  });

  it("rejects overlapping thresholds", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await expect(
      service.updateThresholds(
        actor,
        scale.id,
        {
          thresholds: [
            { label: "Faible", min: 1, max: 5 },
            { label: "Modéré", min: 4, max: 9 },
          ],
        },
        "REQ-5",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("configures the 7 Djamo impact axes (ACT-172)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    const axes = [
      { code: "FINANCIAL", label: "Financier", order: 1 },
      { code: "CUSTOMER", label: "Client", order: 2 },
      { code: "OPERATIONAL", label: "Opérationnel", order: 3 },
      { code: "REGULATORY", label: "Réglementaire", order: 4 },
      { code: "SECURITY", label: "Sécurité", order: 5 },
      { code: "REPUTATIONAL", label: "Réputationnel", order: 6 },
      { code: "STRATEGIC", label: "Stratégique", order: 7 },
    ];
    const updated = await service.updateImpactAxes(actor, scale.id, { axes }, "REQ-6");
    expect(updated.impactAxes?.axes).toHaveLength(7);
    expect(updated.impactAxes?.retainedImpactRule).toBe("MAX");
  });

  it("rejects duplicate impact axis codes", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await expect(
      service.updateImpactAxes(
        actor,
        scale.id,
        {
          axes: [
            { code: "FINANCIAL", label: "Financier", order: 1 },
            { code: "FINANCIAL", label: "Financier bis", order: 2 },
          ],
        },
        "REQ-7",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("configures velocity levels 1-5 (ACT-173)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    const levels = [1, 2, 3, 4, 5].map((level) => ({ level, label: `Level ${level}` }));
    const updated = await service.updateVelocity(actor, scale.id, { levels }, "REQ-8");
    expect(updated.velocityLevels).toHaveLength(5);
  });

  it("rejects non-contiguous velocity levels", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await expect(
      service.updateVelocity(
        actor,
        scale.id,
        { levels: [{ level: 1, label: "A" }, { level: 3, label: "B" }] },
        "REQ-9",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("configures persistence levels 1-5 (ACT-174)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    const levels = [1, 2, 3, 4, 5].map((level) => ({ level, label: `Level ${level}` }));
    const updated = await service.updatePersistence(actor, scale.id, { levels }, "REQ-10");
    expect(updated.persistenceLevels).toHaveLength(5);
  });

  it("configures the mastery scale per line of defense (ACT-175)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    const updated = await service.updateMastery(
      actor,
      scale.id,
      {
        levels: [
          { level: 1, label: "Inadéquat" },
          { level: 2, label: "Partiellement adéquat" },
          { level: 3, label: "Adéquat" },
        ],
        defenseLines: ["L1", "L2", "L3"],
      },
      "REQ-11",
    );
    expect(updated.masteryScale?.aggregation).toBe("MIN");
    expect(updated.masteryScale?.defenseLines).toEqual(["L1", "L2", "L3"]);
  });

  it("rejects a mastery scale outside 1-3 levels", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await expect(
      service.updateMastery(
        actor,
        scale.id,
        {
          levels: [1, 2, 3, 4].map((level) => ({ level, label: `L${level}` })),
          defenseLines: ["L1", "L2", "L3"],
        },
        "REQ-12",
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("activates a version and archives the previous one (ACT-176)", async () => {
    const service = newService();
    const v1 = await createBaseScale(service);
    const activatedV1 = await service.activateVersion(actor, v1.id, "REQ-13");
    expect(activatedV1.status).toBe("ACTIVE");

    const v2 = await service.create(
      actor,
      { name: "Djamo Risk Scale", version: "2026.2", probabilityLevels: 5, impactLevels: 5 },
      "REQ-14",
    );
    const activatedV2 = await service.activateVersion(actor, v2.id, "REQ-15");
    expect(activatedV2.status).toBe("ACTIVE");

    const previous = await service.get(actor, v1.id);
    expect(previous.status).toBe("ARCHIVED");
  });

  it("refuses to re-activate an archived scale", async () => {
    const service = newService();
    const v1 = await createBaseScale(service);
    await service.activateVersion(actor, v1.id, "REQ-16");
    const v2 = await service.create(
      actor,
      { name: "Djamo Risk Scale", version: "2026.2", probabilityLevels: 5, impactLevels: 5 },
      "REQ-17",
    );
    await service.activateVersion(actor, v2.id, "REQ-18");

    await expect(service.activateVersion(actor, v1.id, "REQ-19")).rejects.toThrow(ValidationError);
  });

  it("refuses to disable the active scale (ACT-177)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await service.activateVersion(actor, scale.id, "REQ-20");
    await expect(service.disable(actor, scale.id, "cleanup", "REQ-21")).rejects.toThrow(ValidationError);
  });

  it("disables a non-active scale with a reason (ACT-177)", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await service.disable(actor, scale.id, "created by mistake", "REQ-22");
    await expect(service.get(actor, scale.id)).rejects.toThrow();
  });

  it("requires a reason to disable", async () => {
    const service = newService();
    const scale = await createBaseScale(service);
    await expect(service.disable(actor, scale.id, "", "REQ-23")).rejects.toThrow(ValidationError);
  });

  it("rejects sub-config changes on an archived scale", async () => {
    const service = newService();
    const v1 = await createBaseScale(service);
    await service.activateVersion(actor, v1.id, "REQ-24");
    const v2 = await service.create(
      actor,
      { name: "Djamo Risk Scale", version: "2026.2", probabilityLevels: 5, impactLevels: 5 },
      "REQ-25",
    );
    await service.activateVersion(actor, v2.id, "REQ-26");

    await expect(
      service.updateThresholds(actor, v1.id, { thresholds: [{ label: "Faible", min: 1, max: 25 }] }, "REQ-27"),
    ).rejects.toThrow(ValidationError);
  });
});
