import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ControlExecutionService } from "../src/services/ControlExecutionService.js";
import { RoleService } from "../src/services/RoleService.js";
import { DepartmentService } from "../src/services/DepartmentService.js";
import { AnomalyService } from "../src/services/AnomalyService.js";
import { AuditLogService } from "../src/services/AuditLogService.js";
import { EvidenceService } from "../src/services/EvidenceService.js";
import { filterKnownPermissions, requirePermission } from "../src/domain/permissions.js";
import type { ControlExecutionRepository } from "../src/domain/repositories/ControlExecutionRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RoleRepository } from "../src/domain/repositories/RoleRepository.js";
import type { DepartmentRepository } from "../src/domain/repositories/DepartmentRepository.js";
import type { AnomalyRepository } from "../src/domain/repositories/AnomalyRepository.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { DocumentStorage } from "../src/infrastructure/storage/DocumentStorage.js";
import type { ControlExecution } from "../src/domain/entities/ControlExecution.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { Role, RoleAssignment } from "../src/domain/entities/Role.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { Anomaly } from "../src/domain/entities/Anomaly.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// --- round 2 (SEC-009..SEC-014) ------------------------------------------
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import { KpiMeasureService } from "../src/services/KpiMeasureService.js";
import { UserService } from "../src/services/UserService.js";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import { RatingScaleService } from "../src/services/RatingScaleService.js";
import { RiskAppetiteService } from "../src/services/RiskAppetiteService.js";
import type { KriMeasureRepository } from "../src/domain/repositories/KriMeasureRepository.js";
import type { KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { KpiMeasureRepository } from "../src/domain/repositories/KpiMeasureRepository.js";
import type { KpiRepository } from "../src/domain/repositories/KpiRepository.js";
import type { UserRepository } from "../src/domain/repositories/UserRepository.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RatingScaleRepository } from "../src/domain/repositories/RatingScaleRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { RiskAppetiteRepository } from "../src/domain/repositories/RiskAppetiteRepository.js";
import type { CreateKriMeasureInput, KriMeasure } from "../src/domain/entities/KriMeasure.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { CreateKpiMeasureInput, KpiMeasure } from "../src/domain/entities/KpiMeasure.js";
import type { Kpi } from "../src/domain/entities/Kpi.js";
import type { CreateUserInput, User } from "../src/domain/entities/User.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { RatingScale } from "../src/domain/entities/RatingScale.js";
import type { ActionPlan, CreateActionPlanInput } from "../src/domain/entities/ActionPlan.js";
import type { RiskAppetite, SetRiskAppetiteInput } from "../src/domain/entities/RiskAppetite.js";

/**
 * Security boundary tests (agent A10 / Security review).
 *
 * Two kinds of test live here, and the difference matters:
 *
 * - plain `it(...)` — a boundary that currently HOLDS. These are
 *   regression locks: if a later change breaks them, the suite goes red.
 * - `it.fails(...)` — a boundary that currently does NOT hold. The body
 *   states the expected (secure) behaviour; `.fails` records that the
 *   assertion does not pass yet, so the suite stays green while the
 *   finding is open. The owning agent (A06 Dev Backend) must remove the
 *   `.fails` marker as part of the fix — at that point the test flips
 *   into a real regression test, and leaving `.fails` in place after a
 *   fix makes the suite red, which is the intended forcing function.
 *   Each one names its finding id so the report and the code line up.
 */

// --- shared doubles -------------------------------------------------------

function inMemoryAuditRepository(sink?: Omit<AuditEvent, "id" | "timestamp">[]): AuditRepository {
  return {
    async record(event) {
      sink?.push(event);
    },
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
}

const TENANT = "tenant-1";

const attacker: AuthenticatedUser = {
  userId: "user-attacker",
  tenantId: TENANT,
  email: "attacker@example.com",
  displayName: "Attacker",
  roles: [
    "execution.read",
    "execution.create",
    "execution.validate",
    "role.read",
    "role.create",
    "role.update",
    "role.delete",
    "role.assign",
    "department.read",
    "department.create",
    "department.update",
    "anomaly.read",
    "anomaly.create",
    "audit.read",
  ],
};

const otherAdmin: AuthenticatedUser = { ...attacker, userId: "user-other-admin" };

// --- SEC-001: control execution attribution / maker-checker ---------------

function inMemoryExecutionRepository(): ControlExecutionRepository {
  const store = new Map<string, ControlExecution>();
  return {
    async getById(tenantId, id) {
      const e = store.get(id);
      return e && e.tenantId === tenantId ? e : null;
    },
    async listForControl(tenantId, controlId) {
      return [...store.values()].filter((e) => e.tenantId === tenantId && e.controlId === controlId);
    },
    async create(input) {
      const execution: ControlExecution = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlId: input.controlId,
        plannedDate: input.plannedDate ?? null,
        completedDate: input.completedDate ?? null,
        executedBy: input.executedBy,
        result: input.result ?? null,
        observedAnomalies: input.observedAnomalies ?? null,
        justificationIfNotDone: input.justificationIfNotDone ?? null,
        status: input.status,
        validatedBy: null,
        validatedAt: null,
        createdAt: new Date(),
      };
      store.set(execution.id, execution);
      return execution;
    },
    async recordValidation(tenantId, id, validatedBy, appendToResult) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: ControlExecution = {
        ...existing,
        validatedBy,
        validatedAt: new Date(),
        result: appendToResult ? `${existing.result ?? ""}\n[Validation] ${appendToResult}` : existing.result,
      };
      store.set(id, updated);
      return updated;
    },
  };
}

function fakeControlRepository(existingControlIds: string[]): ControlRepository {
  const control = (id: string): Control => ({
    id,
    tenantId: TENANT,
    label: "L",
    objective: null,
    coveredRiskIds: [],
    process: null,
    departmentId: null,
    procedureDescription: null,
    controlType: "DETECTIVE",
    nature: null,
    defenseLine: null,
    frequency: "Mensuel",
    executor: "IT",
    validator: null,
    expectedEvidence: null,
    complianceCriteria: "criteria",
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
  });
  return {
    async getById(_tenantId, id) {
      return existingControlIds.includes(id) ? control(id) : null;
    },
    async list() {
      return existingControlIds.map(control);
    },
    async listCoveringRisk() {
      return [];
    },
    async create() {
      throw new Error("not used in this test");
    },
    async update() {
      throw new Error("not used in this test");
    },
    async softDelete() {
      throw new Error("not used in this test");
    },
  };
}

describe("SEC-001 control execution attribution (maker-checker)", () => {
  it(
    "SEC-001: does not let the caller choose executedBy — attribution must be the authenticated actor",
    async () => {
      const service = new ControlExecutionService(
        inMemoryExecutionRepository(),
        fakeControlRepository(["control-1"]),
        inMemoryAuditRepository(),
      );

      // `create`'s input type no longer accepts executedBy (fixed by
      // removing it from CreateExecutionBody/the service signature), but a
      // raw HTTP client bypassing TypeScript could still send the field —
      // the `as` cast simulates that attacker-controlled JSON body.
      const execution = await service.create(
        attacker,
        { controlId: "control-1", status: "DONE", executedBy: "user-victim" } as Parameters<
          typeof service.create
        >[1],
        "REQ-SEC-001a",
      );

      expect(execution.executedBy).toBe(attacker.userId);
    },
  );

  it(
    "SEC-001: refuses the create-as-someone-else then self-validate chain",
    async () => {
      const service = new ControlExecutionService(
        inMemoryExecutionRepository(),
        fakeControlRepository(["control-1"]),
        inMemoryAuditRepository(),
      );

      const execution = await service.create(
        attacker,
        { controlId: "control-1", status: "DONE", executedBy: "user-victim", result: "fabricated" } as Parameters<
          typeof service.create
        >[1],
        "REQ-SEC-001b",
      );

      // Now stamped to the real actor regardless of the attacker-supplied
      // executedBy, so the maker-checker guard in validate() correctly fires.
      await expect(service.validate(attacker, execution.id, "self-approved", "REQ-SEC-001c")).rejects.toThrow(
        ForbiddenError,
      );
    },
  );

  it("keeps the maker-checker guard when attribution is left to the server (regression lock)", async () => {
    const service = new ControlExecutionService(
      inMemoryExecutionRepository(),
      fakeControlRepository(["control-1"]),
      inMemoryAuditRepository(),
    );
    const execution = await service.create(attacker, { controlId: "control-1", status: "DONE" }, "REQ-SEC-001d");
    expect(execution.executedBy).toBe(attacker.userId);
    await expect(service.validate(attacker, execution.id, null, "REQ-SEC-001e")).rejects.toThrow(ForbiddenError);
  });
});

// --- SEC-002: RBAC self-escalation through role editing ------------------

function inMemoryRoleRepository(): RoleRepository {
  const roles = new Map<string, Role>();
  const assignments = new Map<string, RoleAssignment>();

  return {
    async getById(tenantId, id) {
      const r = roles.get(id);
      return r && r.tenantId === tenantId && !r.deletedAt ? r : null;
    },
    async getByName(tenantId, name) {
      return [...roles.values()].find((r) => r.tenantId === tenantId && r.name === name && !r.deletedAt) ?? null;
    },
    async list(tenantId, options) {
      return [...roles.values()].filter((r) => r.tenantId === tenantId && (options?.includeDisabled || !r.deletedAt));
    },
    async create(input) {
      const role: Role = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };
      roles.set(role.id, role);
      return role;
    },
    async update(tenantId, id, input) {
      const existing = roles.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated = { ...existing, ...input, updatedAt: new Date() };
      roles.set(id, updated);
      return updated;
    },
    async disable(tenantId, id) {
      const existing = roles.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      roles.set(id, { ...existing, deletedAt: new Date() });
    },
    async countActiveAssignments(tenantId, roleId) {
      return [...assignments.values()].filter((a) => a.tenantId === tenantId && a.roleId === roleId && !a.revokedAt)
        .length;
    },
    async assignToUser(tenantId, roleId, userId, grantedBy) {
      // Mirrors user_roles_active_idx (013_roles.sql:33): one active grant
      // per (tenant, user, role) — a duplicate insert is a DB error, not a
      // second grant.
      const duplicate = [...assignments.values()].some(
        (a) => a.tenantId === tenantId && a.roleId === roleId && a.userId === userId && !a.revokedAt,
      );
      if (duplicate) throw new Error("duplicate key value violates unique constraint user_roles_active_idx");
      const assignment: RoleAssignment = {
        id: randomUUID(),
        tenantId,
        roleId,
        userId,
        grantedBy,
        grantedAt: new Date(),
        revokedAt: null,
      };
      assignments.set(assignment.id, assignment);
      return assignment;
    },
    async revokeFromUser(tenantId, roleId, userId) {
      const assignment = [...assignments.values()].find(
        (a) => a.tenantId === tenantId && a.roleId === roleId && a.userId === userId && !a.revokedAt,
      );
      if (!assignment) throw new Error("not found");
      assignments.set(assignment.id, { ...assignment, revokedAt: new Date() });
    },
    async listForUser(tenantId, userId) {
      const activeRoleIds = [...assignments.values()]
        .filter((a) => a.tenantId === tenantId && a.userId === userId && !a.revokedAt)
        .map((a) => a.roleId);
      return [...roles.values()].filter((r) => activeRoleIds.includes(r.id) && !r.deletedAt);
    },
    async listAssignments(tenantId, roleId) {
      return [...assignments.values()].filter((a) => a.tenantId === tenantId && a.roleId === roleId);
    },
  };
}

describe("SEC-002 RBAC privilege escalation through role editing", () => {
  it(
    "SEC-002: refuses to let an actor widen the permissions of a role they themselves hold",
    async () => {
      const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());

      // Another admin creates a narrow role and grants it to the actor —
      // the maker-checker path works as designed here.
      const role = await service.create(otherAdmin, { name: "Analyste", permissions: ["risk.read"] }, "REQ-SEC-002a");
      await service.assignToUser(otherAdmin, role.id, attacker.userId, "REQ-SEC-002b");

      // The actor holds `role.update`, so they can rewrite the permission
      // set of the very role they hold — self-granting without any second
      // pair of eyes. RoleService.update has no such guard.
      await expect(
        service.update(attacker, role.id, { permissions: ["risk.read", "risk.delete", "audit.read"] }, "REQ-SEC-002c"),
      ).rejects.toThrow(ForbiddenError);
    },
  );

  it("still blocks the direct self-assignment path (regression lock)", async () => {
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository());
    const role = await service.create(attacker, { name: "Admin", permissions: ["risk.delete"] }, "REQ-SEC-002d");
    await expect(service.assignToUser(attacker, role.id, attacker.userId, "REQ-SEC-002e")).rejects.toThrow(
      ForbiddenError,
    );
    await expect(service.revokeFromUser(attacker, role.id, attacker.userId, "REQ-SEC-002f")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("records a PERMISSION_CHANGE audit event for every role permission edit (regression lock)", async () => {
    const events: Omit<AuditEvent, "id" | "timestamp">[] = [];
    const service = new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository(events));
    const role = await service.create(otherAdmin, { name: "Analyste", permissions: ["risk.read"] }, "REQ-SEC-002g");
    await service.update(otherAdmin, role.id, { permissions: ["risk.read", "risk.delete"] }, "REQ-SEC-002h");

    const permissionChange = events.find((e) => e.action === "PERMISSION_CHANGE");
    expect(permissionChange?.userId).toBe(otherAdmin.userId);
  });
});

// --- SEC-003: department risk-owner designation bypass -------------------

function inMemoryDepartmentRepository(): DepartmentRepository {
  const store = new Map<string, Department>();
  // Mirrors PostgresDepartmentRepository: `risk_owner_designated_by` is
  // written from the *input* on create/update, and only stamped with the
  // actor on the dedicated designateRiskOwner path.
  return {
    async getById(tenantId, id) {
      const d = store.get(id);
      return d && d.tenantId === tenantId && !d.deletedAt ? d : null;
    },
    async list(tenantId) {
      return [...store.values()].filter((d) => d.tenantId === tenantId && !d.deletedAt);
    },
    async create(input) {
      const explicitOwner = input.riskOwner?.trim();
      const department: Department = {
        id: randomUUID(),
        tenantId: input.tenantId,
        name: input.name,
        entity: input.entity ?? null,
        manager: input.manager,
        riskOwner: explicitOwner || input.manager,
        riskOwnerDesignatedBy: explicitOwner
          ? (input.riskOwnerDesignatedBy ?? input.manager)
          : "Pilote par défaut (manager, aucune désignation explicite)",
        riskOwnerDesignatedAt: new Date(),
        linkedProcesses: input.linkedProcesses ?? null,
        active: input.active ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
      };
      store.set(department.id, department);
      return department;
    },
    async update(tenantId, id, input) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      // Mirrors the fixed PostgresDepartmentRepository: UpdateDepartmentInput
      // no longer carries riskOwner/riskOwnerDesignatedBy at all — only
      // designateRiskOwner() may change them.
      const updated: Department = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.manager !== undefined ? { manager: input.manager } : {}),
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async designateRiskOwner(tenantId, id, riskOwner, designatedBy) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: Department = {
        ...existing,
        riskOwner,
        riskOwnerDesignatedBy: designatedBy,
        riskOwnerDesignatedAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
    async softDelete(tenantId, id, deletedBy, reason) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, deletedAt: new Date(), deletedBy, deletionReason: reason });
    },
  };
}

describe("SEC-003 risk-owner designation attribution", () => {
  it("stamps the actor on the dedicated designate path (regression lock)", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const created = await service.create(attacker, { name: "Ops", manager: "manager@example.com" }, "REQ-SEC-003a");
    const after = await service.designateRiskOwner(attacker, created.id, "owner@example.com", "REQ-SEC-003b");
    expect(after.riskOwnerDesignatedBy).toBe(attacker.userId);
  });

  it("SEC-003: the generic update cannot rewrite riskOwner/riskOwnerDesignatedBy (regression lock)", async () => {
    const service = new DepartmentService(inMemoryDepartmentRepository(), inMemoryAuditRepository());
    const created = await service.create(attacker, { name: "Ops", manager: "manager@example.com" }, "REQ-SEC-003c");

    // Same shape as the ARCHIVED-via-update bypass CLAUDE.md documents:
    // a dedicated action (designate-risk-owner, which stamps the actor
    // and audits action=ASSIGN) must not be reachable through the generic
    // PATCH. UpdateDepartmentInput no longer has these fields at all — the
    // `as` cast simulates an attacker-controlled JSON body bypassing
    // TypeScript, same as SEC-001. The fields are silently ignored rather
    // than rejected (Zod's `.omit()` strips them at the HTTP boundary too).
    const after = await service.update(
      attacker,
      created.id,
      { riskOwner: "puppet@example.com", riskOwnerDesignatedBy: "ceo@example.com" } as Parameters<
        typeof service.update
      >[2],
      "REQ-SEC-003d",
    );

    expect(after.riskOwner).toBe(created.riskOwner);
    expect(after.riskOwnerDesignatedBy).toBe(created.riskOwnerDesignatedBy);
  });
});

// --- SEC-004: unvalidated cross-entity references ------------------------

function inMemoryAnomalyRepository(): AnomalyRepository {
  const store = new Map<string, Anomaly>();
  return {
    async getById(tenantId, id) {
      const a = store.get(id);
      return a && a.tenantId === tenantId ? a : null;
    },
    async list(tenantId, options) {
      return [...store.values()].filter(
        (a) => a.tenantId === tenantId && (!options?.status || a.status === options.status),
      );
    },
    async create(input) {
      const anomaly: Anomaly = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlId: input.controlId ?? null,
        controlExecutionId: input.controlExecutionId ?? null,
        riskId: input.riskId ?? null,
        observedAt: new Date(),
        description: input.description,
        severity: input.severity,
        origin: input.origin ?? null,
        detectedBy: input.detectedBy,
        status: "NEW",
        associatedActions: null,
        closedAt: null,
        closureComment: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(anomaly.id, anomaly);
      return anomaly;
    },
    async updateStatus(tenantId, id, newStatus, note) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      const updated: Anomaly = {
        ...existing,
        status: newStatus,
        closedAt: newStatus === "CLOSED" ? new Date() : existing.closedAt,
        closureComment: newStatus === "CLOSED" ? note : existing.closureComment,
        updatedAt: new Date(),
      };
      store.set(id, updated);
      return updated;
    },
  };
}

// Minimal fakes — only getById matters for this finding; every other
// method is unused by AnomalyService and throws if accidentally called.
function fakeCrossTenantControlRepository(): ControlRepository {
  return {
    async getById(tenantId, id) {
      return tenantId === "tenant-2" && id === "control-of-tenant-2"
        ? ({ id, tenantId } as unknown as Awaited<ReturnType<ControlRepository["getById"]>>)
        : null;
    },
    list: () => {
      throw new Error("not used in this test");
    },
    listCoveringRisk: () => {
      throw new Error("not used in this test");
    },
    create: () => {
      throw new Error("not used in this test");
    },
    update: () => {
      throw new Error("not used in this test");
    },
    softDelete: () => {
      throw new Error("not used in this test");
    },
  };
}

function fakeCrossTenantRiskRepository(): RiskRepository {
  return {
    async getById(tenantId, id) {
      return tenantId === "tenant-2" && id === "risk-of-tenant-2"
        ? ({ id, tenantId } as unknown as Awaited<ReturnType<RiskRepository["getById"]>>)
        : null;
    },
    listByIds: () => {
      throw new Error("not used in this test");
    },
    list: () => {
      throw new Error("not used in this test");
    },
    create: () => {
      throw new Error("not used in this test");
    },
    update: () => {
      throw new Error("not used in this test");
    },
    softDelete: () => {
      throw new Error("not used in this test");
    },
  };
}

describe("SEC-004 cross-entity reference validation", () => {
  it("stamps detectedBy from the actor, not the client (regression lock)", async () => {
    const service = new AnomalyService(inMemoryAnomalyRepository(), inMemoryAuditRepository());
    const anomaly = await service.create(
      attacker,
      { description: "something odd", severity: "HIGH" },
      "REQ-SEC-004a",
    );
    expect(anomaly.detectedBy).toBe(attacker.userId);
  });

  it(
    "SEC-004: refuses an anomaly pointing at a control/risk that is not in the actor's tenant",
    async () => {
      const service = new AnomalyService(
        inMemoryAnomalyRepository(),
        inMemoryAuditRepository(),
        fakeCrossTenantControlRepository(),
        undefined,
        fakeCrossTenantRiskRepository(),
      );

      // AnomalyService.create used to pass controlId/controlExecutionId/riskId
      // straight through — unlike ControlExecutionService.create (which
      // checks the control is in the tenant) or ControlService (which uses
      // assertRisksExist). The DB FKs are on (id) alone, not
      // (tenant_id, id), so a foreign-tenant id used to satisfy them.
      await expect(
        service.create(
          attacker,
          {
            description: "linked to another tenant's control",
            severity: "HIGH",
            controlId: "control-of-tenant-2",
            riskId: "risk-of-tenant-2",
          },
          "REQ-SEC-004b",
        ),
      ).rejects.toThrow(ValidationError);
    },
  );
});

// --- SEC-005 / SEC-006: permission engine + read amplification ----------

describe("SEC-005 filterKnownPermissions (regression lock)", () => {
  it("drops unknown/typo/stale strings from a users.roles-style list, keeps only real permissions", () => {
    const result = filterKnownPermissions(["risk.read", "role.*", "admin", "riks.read", "audit.read"]);
    expect(result).toEqual(["risk.read", "audit.read"]);
  });

  it("returns an empty array for an all-unknown list rather than throwing", () => {
    expect(filterKnownPermissions(["nope", "*", ""])).toEqual([]);
  });
});

describe("permission engine fail-closed semantics (regression lock)", () => {
  it("matches permissions exactly — no prefix, wildcard or case-insensitive match", () => {
    // `users.roles` (migration 002) is a free-form text[] merged into
    // actor.roles by server.ts:127 with no validation against
    // ALL_PERMISSIONS, so junk/legacy values must never grant anything.
    const bootstrapUser: AuthenticatedUser = {
      userId: "user-legacy",
      tenantId: TENANT,
      email: "legacy@example.com",
      displayName: "Legacy",
      roles: ["role", "role.*", "*", "ROLE.ASSIGN", "admin", "role.assign.extra"],
    };

    expect(() => requirePermission(bootstrapUser, "role.assign")).toThrow(ForbiddenError);
    expect(() => requirePermission(bootstrapUser, "audit.read")).toThrow(ForbiddenError);
    expect(() => requirePermission({ ...bootstrapUser, roles: ["role.assign"] }, "role.assign")).not.toThrow();
  });
});

describe("audit journal read amplification (regression lock)", () => {
  it("caps a client-supplied limit instead of passing it through to the database", async () => {
    let requestedLimit = -1;
    const audit: AuditRepository = {
      async record() {},
      async listForEntity() {
        return [];
      },
      async listRecent(_tenantId, limit) {
        requestedLimit = limit;
        return [];
      },
    };
    const service = new AuditLogService(audit);
    await service.listRecent({ ...attacker, roles: ["audit.read"] }, 10_000_000);
    expect(requestedLimit).toBe(500);
  });

  it("requires audit.read even for the unfiltered tail", async () => {
    const service = new AuditLogService(inMemoryAuditRepository());
    await expect(service.listRecent({ ...attacker, roles: [] })).rejects.toThrow(ForbiddenError);
  });
});

// --- SEC-008: evidence deletion ordering ----------------------------------

function inMemoryEvidenceRepository(): EvidenceRepository & { _store: Map<string, Evidence> } {
  const store = new Map<string, Evidence>();
  return {
    async getById(tenantId, id) {
      const e = store.get(id);
      return e && e.tenantId === tenantId ? e : null;
    },
    async listForControlExecution(tenantId, controlExecutionId) {
      return [...store.values()].filter((e) => e.tenantId === tenantId && e.controlExecutionId === controlExecutionId);
    },
    async create(input) {
      const evidence: Evidence = {
        id: randomUUID(),
        tenantId: input.tenantId,
        controlExecutionId: input.controlExecutionId,
        fileName: input.fileName,
        driveFileId: input.driveFileId,
        driveUrl: input.driveUrl,
        documentType: input.documentType,
        uploadedBy: input.uploadedBy,
        uploadedAt: new Date(),
        version: 1,
        status: "ACTIVE",
      };
      store.set(evidence.id, evidence);
      return evidence;
    },
    async markDeleted(tenantId, id) {
      const existing = store.get(id);
      if (!existing || existing.tenantId !== tenantId) throw new Error("not found");
      store.set(id, { ...existing, status: "DELETED" });
    },
    _store: store,
  };
}

describe("SEC-008 evidence deletion ordering (regression lock)", () => {
  it("marks the DB row deleted before touching storage, so a storage failure never loses the audit record", async () => {
    const repo = inMemoryEvidenceRepository();
    const failingStorage: DocumentStorage = {
      async upload(params) {
        return { storageFileId: randomUUID(), url: `https://drive.example/${params.fileName}`, fileName: params.fileName };
      },
      async getUrl(id) {
        return `https://drive.example/file/${id}`;
      },
      async delete() {
        throw new Error("Drive is down");
      },
    };
    const evidenceUser: AuthenticatedUser = {
      ...attacker,
      roles: [...attacker.roles, "evidence.upload", "evidence.read", "evidence.delete"],
    };
    const service = new EvidenceService(repo, failingStorage, inMemoryAuditRepository());
    const evidence = await service.upload(
      evidenceUser,
      {
        fileName: "proof.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("x"),
        documentType: "CONTROL_EVIDENCE",
        controlExecutionId: null,
      },
      "REQ-SEC-008a",
    );

    await expect(service.delete(evidenceUser, evidence.id, "REQ-SEC-008b")).rejects.toThrow("Drive is down");

    // Even though storage.delete threw, the DB row is already marked
    // DELETED — the old order (storage first) could leave it ACTIVE and
    // pointing at a file already gone.
    expect(repo._store.get(evidence.id)?.status).toBe("DELETED");
  });
});

// =========================================================================
// Round 2 (agent A10 / Security review, 2026-09-27) — the 9 domain modules
// shipped after the first pass (Kpi/KpiMeasure, RiskAppetite, RatingScale,
// User, RiskEvaluation, Kri/KriMeasure, RiskOwnership, ActionPlan,
// Cartography), none of which had ever been security-reviewed.
//
// Same convention as above: `it.fails` = confirmed open finding, the body
// asserts the SECURE behaviour. Stubs here are deliberately partial (only
// the methods the path under test actually calls) — the point is to prove
// the boundary, not to rebuild a database.
// =========================================================================

// --- SEC-009: client-supplied recordedBy on KPI/KRI measures -------------
// Exact reintroduction of SEC-001: attribution of an append-only record is
// taken from the request body instead of being forced to the actor.
// `Omit<..., "recordedBy"> & { recordedBy?: string }` in both service
// signatures, and `recordedBy: z.string().nullish()` in both route bodies,
// put the field back under client control.

describe("SEC-009 measure attribution (append-only recordedBy)", () => {
  const measureActor: AuthenticatedUser = { ...attacker, roles: ["kri.create", "kpi.create"] };

  it("SEC-009: KriMeasureService.record must ignore a client-supplied recordedBy", async () => {
    let recordedBy = "";
    const measures = {
      async create(input: CreateKriMeasureInput) {
        recordedBy = input.recordedBy;
        return { ...input, id: randomUUID(), createdAt: new Date() } as KriMeasure;
      },
    } as unknown as KriMeasureRepository;
    const kris = {
      async getById() {
        return {
          id: "kri-1",
          label: "Fraud rate",
          riskId: "risk-1",
          thresholdGreen: 1,
          thresholdOrange: 2,
          thresholdRed: 3,
        } as unknown as Kri;
      },
    } as unknown as KriRepository;

    await new KriMeasureService(measures, kris, inMemoryAuditRepository()).record(
      measureActor,
      { kriId: "kri-1", measureDate: new Date(), value: 5, source: "manual", comment: null },
      "REQ-SEC-009a",
    );

    expect(recordedBy).toBe(measureActor.userId);
  });

  it("SEC-009: KpiMeasureService.record must ignore a client-supplied recordedBy", async () => {
    let recordedBy = "";
    const measures = {
      async create(input: CreateKpiMeasureInput) {
        recordedBy = input.recordedBy;
        return { ...input, id: randomUUID(), createdAt: new Date() } as KpiMeasure;
      },
    } as unknown as KpiMeasureRepository;
    const kpis = {
      async getById() {
        return { id: "kpi-1", targetValue: 10 } as unknown as Kpi;
      },
    } as unknown as KpiRepository;

    await new KpiMeasureService(measures, kpis, inMemoryAuditRepository()).record(
      measureActor,
      { kpiId: "kpi-1", period: new Date(), value: 5, comment: null },
      "REQ-SEC-009b",
    );

    expect(recordedBy).toBe(measureActor.userId);
  });
});

// --- SEC-010: account provisioning without role.assign -------------------
// UserService.create now checks role.assign up front, before the users row
// is inserted — an actor holding only user.create gets a 403 with no row
// ever written. (Previously it inserted the users row first and only then
// called RoleService.assignToUser, which is what actually required
// role.assign — the 403 came back after the account already existed, and
// server.ts resolves identity with `SELECT ... FROM users WHERE email = $1
// AND deleted_at IS NULL`, so that orphan row was a login-capable account
// nobody authorised and no role was ever attached to.)

describe("SEC-010 user provisioning bypasses the role.assign gate", () => {
  it("SEC-010: a refused role grant must not leave a login-capable account behind", async () => {
    const inserted: string[] = [];
    const users = {
      async create(input: CreateUserInput) {
        inserted.push(input.email);
        return { ...input, id: randomUUID(), roles: [], createdAt: new Date(), deletedAt: null } as User;
      },
    } as unknown as UserRepository;

    // user.create but NOT role.assign — so assignToUser throws ForbiddenError.
    const actor: AuthenticatedUser = { ...attacker, roles: ["user.create"] };
    const service = new UserService(
      users,
      inMemoryAuditRepository(),
      new RoleService(inMemoryRoleRepository(), inMemoryAuditRepository()),
    );

    await expect(
      service.create(actor, { email: "ghost@example.com", displayName: "Ghost", roleId: "role-1" }, "REQ-SEC-010a"),
    ).rejects.toThrow(ForbiddenError);

    // The call failed, so no account should exist.
    expect(inserted).toEqual([]);
  });
});

// --- SEC-011: RiskEvaluation maker-checker binds the wrong actor ----------
// validate()/reject() compare actor.userId against `evaluatorId`, which is
// stamped at create() time only. The scoring setters require nothing but
// `riskevaluation.update` and never check the actor is the evaluator, and no
// field records who actually supplied the numbers. So a third party can
// author 100% of an evaluation's content (including the appetiteOverride
// that decides `appetiteExceeded`) on a shell draft opened by someone else,
// then validate it themselves — evaluatorId still names the shell creator,
// so the four-eyes guard never fires.

describe("SEC-011 RiskEvaluation scoring is not bound to the evaluator", () => {
  it("SEC-011: a non-evaluator must not be able to record scoring on another evaluator's draft", async () => {
    const draft = {
      id: "ev-1",
      tenantId: TENANT,
      evaluatorId: "user-victim",
      status: "BROUILLON",
      ratingScaleId: "rs-1",
      masteryGlobal: 2,
      subCategory: "Fraude",
      entity: null,
      residualScore: null,
    } as unknown as RiskEvaluation;

    const evaluations = {
      async getById() {
        return draft;
      },
      async recordResidualScoring() {
        return { ...draft, residualScore: 9 };
      },
    } as unknown as RiskEvaluationRepository;
    const ratingScales = {
      async getById() {
        return {
          id: "rs-1",
          probabilityLevels: 5,
          impactLevels: 5,
          impactAxes: { axes: [{ code: "FIN", label: "Financier", order: 1 }], retainedImpactRule: "MAX" },
        } as unknown as RatingScale;
      },
    } as unknown as RatingScaleRepository;

    const service = new RiskEvaluationService(evaluations, inMemoryAuditRepository(), undefined, ratingScales);
    const thirdParty: AuthenticatedUser = { ...attacker, roles: ["riskevaluation.read", "riskevaluation.update"] };

    await expect(
      service.recordResidualScoring(
        thirdParty,
        "ev-1",
        { probability: 3, impacts: [{ code: "FIN", value: 3 }], justification: "rewritten by a third party" },
        "REQ-SEC-011a",
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

// --- SEC-012: ActionPlan responsibleUserId/departmentId unvalidated -------
// create() carefully validates `sourceId` against Risk/Control/Kri in the
// actor's tenant (assertSourceExists) but takes `responsibleUserId` and
// `departmentId` on trust — ActionPlanService has no UserRepository or
// DepartmentRepository at all. RiskService.assignOwner (assertActiveUser)
// and RiskService.create (assertDepartmentExists) show the intended
// pattern; this module skipped it.

describe("SEC-012 ActionPlan cross-entity reference validation", () => {
  it("SEC-012: responsibleUserId must resolve to an active user in the actor's tenant", async () => {
    const actions = {
      async create(input: CreateActionPlanInput) {
        return {
          ...input,
          id: randomUUID(),
          status: "PLANIFIEE",
          progressPercent: 0,
          progressComment: null,
          evidenceId: null,
          closedBy: null,
          closedAt: null,
          closureComment: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as ActionPlan;
      },
    } as unknown as ActionPlanRepository;

    // Simulates the responsible user not existing in the actor's tenant
    // (e.g. belongs to another tenant) — getById returns null.
    const users = {
      async getById() {
        return null;
      },
    } as unknown as UserRepository;

    const service = new ActionPlanService(
      actions,
      inMemoryAuditRepository(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      users,
    );
    const actor: AuthenticatedUser = { ...attacker, roles: ["actionplan.create"] };

    await expect(
      service.create(
        actor,
        {
          title: "Remediate",
          sourceType: "MANAGEMENT",
          responsibleUserId: "user-of-tenant-2",
          dueDate: new Date(Date.now() + 86_400_000),
        },
        "REQ-SEC-012a",
      ),
    ).rejects.toThrow(ValidationError);
  });
});

// --- SEC-013: rating scale archived under the generic update permission ---
// disable() correctly demands ratingscale.delete + a reason. But
// activateVersion() — gated on ratingscale.update alone, no reason — calls
// activateAndArchivePrevious, which pushes the previously ACTIVE scale to
// ARCHIVED, and that is irreversible ("Cannot re-activate an archived
// rating scale"). Exactly the "a generic update must never reach a terminal
// state" bypass CLAUDE.md documents for Risk/Control.

describe("SEC-013 rating scale terminal transition via the update permission", () => {
  it("SEC-013: archiving the previously-active scale must require ratingscale.delete", async () => {
    let archivedPrevious = false;
    const ratingScales = {
      async getById() {
        return { id: "rs-new", status: "DRAFT", version: "v2" } as unknown as RatingScale;
      },
      async activateAndArchivePrevious() {
        archivedPrevious = true;
        return { id: "rs-new", status: "ACTIVE", version: "v2" } as unknown as RatingScale;
      },
    } as unknown as RatingScaleRepository;

    const service = new RatingScaleService(ratingScales, inMemoryAuditRepository());
    const actor: AuthenticatedUser = { ...attacker, roles: ["ratingscale.read", "ratingscale.update"] };

    await expect(service.activateVersion(actor, "rs-new", "REQ-SEC-013a")).rejects.toThrow(ForbiddenError);
    expect(archivedPrevious).toBe(false);
  });
});

// --- SEC-014: appetite threshold retired under the update permission -----
// archive() demands riskappetite.delete + a reason. setThreshold() accepts
// `active` straight from the body (`active: z.boolean().optional()` in the
// route) and upserts it, so `active: false` retires a governance ceiling
// with only riskappetite.update, no reason, audited as a plain UPDATE.
// Worse, the two readers disagree: list() filters `active = true`, so the
// threshold vanishes from the ACT-168 oversight table, while
// getBySubCategory() (what RiskEvaluationService actually compares a
// residual score against) ignores `active` entirely and keeps applying it.

describe("SEC-014 risk appetite retired via the update permission", () => {
  it("SEC-014: deactivating an appetite threshold must require riskappetite.delete", async () => {
    const appetites = {
      async getBySubCategory() {
        return null;
      },
      async upsert(input: SetRiskAppetiteInput) {
        return { ...input, id: randomUUID(), createdAt: new Date(), updatedAt: new Date() } as RiskAppetite;
      },
    } as unknown as RiskAppetiteRepository;

    const service = new RiskAppetiteService(appetites, inMemoryAuditRepository());
    const actor: AuthenticatedUser = { ...attacker, roles: ["riskappetite.update"] };

    await expect(
      service.setThreshold(actor, "Fraude", { threshold: 10, methodologyVersion: "v1", active: false }, "REQ-SEC-014a"),
    ).rejects.toThrow(ForbiddenError);
  });
});
