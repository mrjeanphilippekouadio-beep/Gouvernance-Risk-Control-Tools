import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DashboardScopeResolver } from "../src/services/DashboardScopeResolver.js";
import type { RaciAssignmentRepository } from "../src/domain/repositories/RaciAssignmentRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { RaciAssignment, RaciRole } from "../src/domain/entities/RaciAssignment.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

const TENANT = "tenant-1";
const NOT_IMPLEMENTED = () => {
  throw new Error("not implemented");
};

function fakeRaci(assignments: RaciAssignment[]): RaciAssignmentRepository {
  let calls = 0;
  return {
    create: NOT_IMPLEMENTED,
    getById: NOT_IMPLEMENTED,
    listForEntity: NOT_IMPLEMENTED,
    async listForUser(tenantId, userId, options) {
      calls++;
      return assignments.filter(
        (a) =>
          a.tenantId === tenantId &&
          a.userId === userId &&
          !a.deletedAt &&
          (!options?.roles || options.roles.includes(a.role)),
      );
    },
    remove: NOT_IMPLEMENTED,
    // exposed for the "GLOBAL never touches repositories" assertion
    _calls: () => calls,
  } as unknown as RaciAssignmentRepository & { _calls: () => number };
}

function fakeRisks(risks: Risk[]): RiskRepository {
  return {
    getById: NOT_IMPLEMENTED,
    async listByIds(tenantId, ids) {
      return risks.filter((r) => r.tenantId === tenantId && ids.includes(r.id));
    },
    async list(tenantId, options) {
      return risks.filter((r) => r.tenantId === tenantId && (options?.ownerId === undefined || r.ownerId === options.ownerId));
    },
    create: NOT_IMPLEMENTED,
    update: NOT_IMPLEMENTED,
    assignOwner: NOT_IMPLEMENTED,
    assignSuperiorOwner: NOT_IMPLEMENTED,
    softDelete: NOT_IMPLEMENTED,
  };
}

function raci(entityId: string, userId: string, role: RaciRole): RaciAssignment {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    entityType: "RISK",
    entityId,
    userId,
    role,
    createdBy: userId,
    createdAt: new Date(),
    deletedAt: null,
  };
}

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: randomUUID(),
    tenantId: TENANT,
    process: "Some process",
    processId: null,
    description: "d",
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

function actor(mode: "GLOBAL" | "DEPARTMENT" | "PROCESS", userId = "user-1"): AuthenticatedUser {
  return {
    userId,
    tenantId: TENANT,
    email: `${userId}@djamo.example`,
    displayName: userId,
    roles: [],
    dashboardScopeMode: mode,
  };
}

describe("DashboardScopeResolver", () => {
  it("GLOBAL short-circuits without touching RACI or Risk repositories", async () => {
    const raciRepo = fakeRaci([]) as RaciAssignmentRepository & { _calls: () => number };
    const risksRepo = fakeRisks([]);
    const resolver = new DashboardScopeResolver(raciRepo, risksRepo);

    const scope = await resolver.resolve(actor("GLOBAL"));

    expect(scope).toEqual({ mode: "GLOBAL" });
    expect(raciRepo._calls()).toBe(0);
  });

  it("DEPARTMENT: R/A on risks in 2 departments widens to those departments, but a 3rd department reached only via I stays process-level, not department-wide", async () => {
    const deptA = "dept-a";
    const deptB = "dept-b";
    const deptC = "dept-c-out-of-perimeter";
    const processInC = "process-in-dept-c";

    const riskWideA = risk({ ownerDepartmentId: deptA });
    const riskWideB = risk({ ownerDepartmentId: deptB });
    const riskNarrowC = risk({ ownerDepartmentId: deptC, processId: processInC });
    // A second, different risk in dept C that the actor has NO RACI role
    // on at all — must never leak into the resolved scope.
    const otherRiskInC = risk({ ownerDepartmentId: deptC });

    const assignments = [
      raci(riskWideA.id, "user-1", "R"),
      raci(riskWideB.id, "user-1", "A"),
      raci(riskNarrowC.id, "user-1", "I"),
    ];

    const resolver = new DashboardScopeResolver(
      fakeRaci(assignments),
      fakeRisks([riskWideA, riskWideB, riskNarrowC, otherRiskInC]),
    );

    const scope = await resolver.resolve(actor("DEPARTMENT"));

    expect(scope.mode).toBe("DEPARTMENT");
    if (scope.mode !== "DEPARTMENT") throw new Error("unreachable");
    expect([...scope.departmentIds].sort()).toEqual([deptA, deptB].sort());
    expect(scope.processIds).toEqual([processInC]);
    // The 3rd department itself is never in departmentIds — only its one process is reachable.
    expect(scope.departmentIds).not.toContain(deptC);
  });

  it("DEPARTMENT: Risk.ownerId counts as an implicit R/A seed even with no RACI row at all", async () => {
    const dept = "dept-owned";
    const owned = risk({ ownerDepartmentId: dept, ownerId: "user-1" });
    const resolver = new DashboardScopeResolver(fakeRaci([]), fakeRisks([owned]));

    const scope = await resolver.resolve(actor("DEPARTMENT"));

    expect(scope).toEqual({ mode: "DEPARTMENT", departmentIds: [dept], processIds: [] });
  });

  it("DEPARTMENT: an actor with zero RACI and zero owned risks resolves to an empty perimeter, never GLOBAL", async () => {
    const resolver = new DashboardScopeResolver(fakeRaci([]), fakeRisks([]));

    const scope = await resolver.resolve(actor("DEPARTMENT"));

    expect(scope).toEqual({ mode: "DEPARTMENT", departmentIds: [], processIds: [] });
  });

  it("PROCESS mode: both R/A and C/I widen only to the risk's own process", async () => {
    const processWide = "process-wide";
    const processNarrow = "process-narrow";
    const riskWide = risk({ processId: processWide });
    const riskNarrow = risk({ processId: processNarrow });

    const resolver = new DashboardScopeResolver(
      fakeRaci([raci(riskWide.id, "user-1", "R"), raci(riskNarrow.id, "user-1", "C")]),
      fakeRisks([riskWide, riskNarrow]),
    );

    const scope = await resolver.resolve(actor("PROCESS"));

    expect(scope.mode).toBe("PROCESS");
    if (scope.mode !== "PROCESS") throw new Error("unreachable");
    expect([...scope.processIds].sort()).toEqual([processNarrow, processWide].sort());
  });
});
