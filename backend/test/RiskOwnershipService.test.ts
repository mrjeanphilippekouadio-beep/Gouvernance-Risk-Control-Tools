import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RiskOwnershipService } from "../src/services/RiskOwnershipService.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";

function inMemoryRiskRepository(risks: Risk[]): RiskRepository {
  return {
    async getById(tenantId, id) {
      return risks.find((r) => r.tenantId === tenantId && r.id === id && !r.deletedAt) ?? null;
    },
    async listByIds(tenantId, ids) {
      return risks.filter((r) => r.tenantId === tenantId && ids.includes(r.id) && !r.deletedAt);
    },
    async list(tenantId, options) {
      return risks.filter(
        (r) =>
          r.tenantId === tenantId &&
          !r.deletedAt &&
          (options?.includeArchived || r.status !== "ARCHIVED") &&
          (options?.ownerId === undefined || r.ownerId === options.ownerId),
      );
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async assignOwner() {
      throw new Error("not implemented");
    },
    async assignSuperiorOwner() {
      throw new Error("not implemented");
    },
    async softDelete() {
      throw new Error("not implemented");
    },
  };
}

function inMemoryUserRepository(users: User[]): UserRepository {
  return {
    async getById(tenantId, id) {
      return users.find((u) => u.tenantId === tenantId && u.id === id) ?? null;
    },
    async getByEmail(tenantId, email) {
      return users.find((u) => u.tenantId === tenantId && u.email === email) ?? null;
    },
    async list(tenantId) {
      return users.filter((u) => u.tenantId === tenantId && !u.deletedAt);
    },
    async count(tenantId) {
      return users.filter((u) => u.tenantId === tenantId && !u.deletedAt).length;
    },
    async create() {
      throw new Error("not implemented");
    },
    async update() {
      throw new Error("not implemented");
    },
    async suspend() {
      throw new Error("not implemented");
    },
    async reactivate() {
      throw new Error("not implemented");
    },
  };
}

/** Only listForRisk is exercised by RiskOwnershipService — everything else throws if reached. */
function fakeRiskEvaluationRepository(evaluationsByRisk: Map<string, RiskEvaluation[]>): RiskEvaluationRepository {
  return {
    async getById() {
      throw new Error("not implemented");
    },
    async listForRisk(tenantId, riskId, options) {
      const all = (evaluationsByRisk.get(riskId) ?? []).filter((e) => e.tenantId === tenantId);
      const statuses = options?.status ? (Array.isArray(options.status) ? options.status : [options.status]) : null;
      const filtered = statuses ? all.filter((e) => statuses.includes(e.status)) : all;
      const sorted = [...filtered].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const limit = options?.limit ?? sorted.length;
      return sorted.slice(0, limit);
    },
    async create() {
      throw new Error("not implemented");
    },
    async recordInherentScoring() {
      throw new Error("not implemented");
    },
    async recordMasteryAssessment() {
      throw new Error("not implemented");
    },
    async recordResidualScoring() {
      throw new Error("not implemented");
    },
    async recordValidation() {
      throw new Error("not implemented");
    },
    async recordRejection() {
      throw new Error("not implemented");
    },
    async recordCommitteeValidation() {
      throw new Error("not implemented");
    },
  };
}

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    process: "Onboarding",
    description: "KYC risk",
    ownerDepartmentId: null,
    ownerId: null,
    superiorOwnerId: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    ...overrides,
  };
}

function user(overrides: Partial<User> = {}): User {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    email: "owner@example.com",
    displayName: "Owner",
    roles: [],
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function evaluation(overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  return {
    id: randomUUID(),
    tenantId: "tenant-1",
    riskId: "risk-1",
    evaluationType: "ANNUELLE",
    status: "VALIDATED",
    evaluatorId: "evaluator-1",
    subCategory: "Fraude",
    entity: null,
    ratingScaleId: null,
    ratingScaleVersion: null,
    inherentProbability: null,
    inherentImpacts: null,
    inherentImpactRetained: null,
    inherentScore: null,
    masteryLines: null,
    masteryGlobal: null,
    residualProbability: null,
    residualImpacts: null,
    residualImpactRetained: null,
    residualScore: null,
    residualJustification: null,
    appetiteThresholdSuggested: null,
    appetiteThresholdOverride: null,
    appetiteThresholdApplied: null,
    appetiteExceeded: null,
    validatedBy: "validator-1",
    validatedAt: new Date(),
    comment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const actor: AuthenticatedUser = {
  userId: "admin-1",
  tenantId: "tenant-1",
  email: "admin@example.com",
  displayName: "Admin",
  roles: ["risk.read"],
};

describe("RiskOwnershipService (ACT-127)", () => {
  it("groups owned risks by department, resolving owner name/email and maxScore", async () => {
    const owner = user({ id: "owner-1", displayName: "Alice", email: "alice@example.com" });
    const r1 = risk({ id: "risk-1", ownerId: owner.id, ownerDepartmentId: "dept-1" });
    const r2 = risk({ id: "risk-2", ownerId: owner.id, ownerDepartmentId: "dept-1" });

    const evaluationsByRisk = new Map<string, RiskEvaluation[]>([
      ["risk-1", [evaluation({ riskId: "risk-1", residualScore: 12 })]],
      ["risk-2", [evaluation({ riskId: "risk-2", residualScore: 20 })]],
    ]);

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([r1, r2]),
      inMemoryUserRepository([owner]),
      fakeRiskEvaluationRepository(evaluationsByRisk),
    );

    const groups = await service.listOwners(actor);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.departmentId).toBe("dept-1");
    expect(groups[0]?.owners).toHaveLength(1);
    const summary = groups[0]?.owners[0];
    expect(summary?.ownerName).toBe("Alice");
    expect(summary?.ownerEmail).toBe("alice@example.com");
    expect(summary?.risks).toHaveLength(2);
    expect(summary?.maxScore).toBe(20);
  });

  it("excludes risks with no ownerId assigned", async () => {
    const owner = user({ id: "owner-1" });
    const owned = risk({ id: "risk-1", ownerId: owner.id });
    const unowned = risk({ id: "risk-2", ownerId: null });

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([owned, unowned]),
      inMemoryUserRepository([owner]),
    );

    const groups = await service.listOwners(actor);
    const allRiskIds = groups.flatMap((g) => g.owners.flatMap((o) => o.risks.map((r) => r.riskId)));
    expect(allRiskIds).toEqual(["risk-1"]);
  });

  it("is tenant-scoped: never returns another tenant's risks or owners", async () => {
    const ownerT1 = user({ id: "owner-1", tenantId: "tenant-1" });
    const ownerT2 = user({ id: "owner-2", tenantId: "tenant-2" });
    const riskT1 = risk({ id: "risk-1", tenantId: "tenant-1", ownerId: ownerT1.id });
    const riskT2 = risk({ id: "risk-2", tenantId: "tenant-2", ownerId: ownerT2.id });

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([riskT1, riskT2]),
      inMemoryUserRepository([ownerT1, ownerT2]),
    );

    const groups = await service.listOwners(actor);
    const ownerIds = groups.flatMap((g) => g.owners.map((o) => o.ownerId));
    expect(ownerIds).toEqual([ownerT1.id]);
  });

  it("2026-09-30 audit fix: counts a VALIDE_COMITE evaluation toward score/maxScore, not just VALIDATED", async () => {
    const owner = user({ id: "owner-1" });
    const r = risk({ id: "risk-1", ownerId: owner.id });

    const evaluationsByRisk = new Map<string, RiskEvaluation[]>([
      ["risk-1", [evaluation({ riskId: "risk-1", status: "VALIDE_COMITE", residualScore: 25 })]],
    ]);

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([r]),
      inMemoryUserRepository([owner]),
      fakeRiskEvaluationRepository(evaluationsByRisk),
    );

    const groups = await service.listOwners(actor);
    const summary = groups[0]?.owners[0];
    expect(summary?.risks[0]?.score).toBe(25);
    expect(summary?.maxScore).toBe(25);
  });

  it("still reports a null score for a risk whose only evaluations are BROUILLON/REJECTED", async () => {
    const owner = user({ id: "owner-1" });
    const r = risk({ id: "risk-1", ownerId: owner.id });

    const evaluationsByRisk = new Map<string, RiskEvaluation[]>([
      [
        "risk-1",
        [
          evaluation({ riskId: "risk-1", status: "BROUILLON", residualScore: null }),
          evaluation({ riskId: "risk-1", status: "REJECTED", residualScore: 99 }),
        ],
      ],
    ]);

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([r]),
      inMemoryUserRepository([owner]),
      fakeRiskEvaluationRepository(evaluationsByRisk),
    );

    const groups = await service.listOwners(actor);
    const summary = groups[0]?.owners[0];
    expect(summary?.risks[0]?.score).toBeNull();
    expect(summary?.maxScore).toBeNull();
  });

  it("produces a null maxScore when no evaluations exist for an owner's risks", async () => {
    const owner = user({ id: "owner-1" });
    const r = risk({ id: "risk-1", ownerId: owner.id });

    const service = new RiskOwnershipService(
      inMemoryRiskRepository([r]),
      inMemoryUserRepository([owner]),
      fakeRiskEvaluationRepository(new Map()),
    );

    const groups = await service.listOwners(actor);
    expect(groups[0]?.owners[0]?.maxScore).toBeNull();
  });

  it("PRIV-CH-DASH-001: never exposes a suspended owner's real name/email", async () => {
    const suspended = user({
      id: "owner-1",
      displayName: "Alice",
      email: "alice@example.com",
      deletedAt: new Date(),
    });
    const r = risk({ id: "risk-1", ownerId: suspended.id });

    const service = new RiskOwnershipService(inMemoryRiskRepository([r]), inMemoryUserRepository([suspended]));

    const groups = await service.listOwners(actor);
    const summary = groups[0]?.owners[0];
    expect(summary?.ownerName).not.toBe("Alice");
    expect(summary?.ownerEmail).not.toBe("alice@example.com");
    expect(summary?.ownerEmail).toBe("");
  });

  it("rejects an actor without risk.read permission", async () => {
    const service = new RiskOwnershipService(inMemoryRiskRepository([]), inMemoryUserRepository([]));
    const noReadActor = { ...actor, roles: [] };
    await expect(service.listOwners(noReadActor)).rejects.toThrow(ForbiddenError);
  });
});
