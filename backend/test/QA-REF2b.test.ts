import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DepartmentService } from "../src/services/DepartmentService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Department } from "../src/domain/entities/Department.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { Permission } from "../src/domain/permissions.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// QA-REF2b retest of QA-REF2-01: sequential paths, real ProcessService + DepartmentService. Fakes copied from QA-REF2.
// (level-2 checks on 60560c4 (QA-REF-01/02, QA-B6bF-03). Oracles written before running.
// Fakes mirror the real Postgres repositories: list() hides inactive rows by default, getById() hides archived ones.

const T = "t1";
const actor = (perms: Permission[], userId = "u1", tenantId = T): AuthenticatedUser => ({ userId, tenantId, email: "a@x", roles: perms }) as AuthenticatedUser;
const audit = { async record() {}, async listForEntity() { return []; }, async listRecent() { return []; } } as never;

// ---- fakes --------------------------------------------------------------
function deptRepo() {
  const store = new Map<string, Department>();
  return {
    store,
    async getById(t: string, id: string) { const d = store.get(id); return d && d.tenantId === t && !d.deletedAt ? d : null; },
    async list(t: string, o?: { includeInactive?: boolean }) { return [...store.values()].filter((d) => d.tenantId === t && !d.deletedAt && (o?.includeInactive || d.active)); },
    async create(input: any, by: string) {
      const d = { id: randomUUID(), tenantId: input.tenantId, name: input.name, entity: null, manager: input.manager, riskOwner: input.riskOwner ?? input.manager,
        riskOwnerDesignatedBy: input.riskOwner ? by : "Pilote par défaut (manager, aucune désignation explicite)", riskOwnerDesignatedAt: new Date(),
        linkedProcesses: null, active: input.active ?? true, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null } as Department;
      store.set(d.id, d); return d;
    },
    async update(t: string, id: string, input: any) { const d = { ...store.get(id)!, ...input }; store.set(id, d); return d; },
    async designateRiskOwner() { throw new Error("n/a"); },
    async softDelete(_t: string, id: string, by: string, reason: string) { store.set(id, { ...store.get(id)!, deletedAt: new Date(), deletedBy: by, deletionReason: reason }); },
  };
}
function procRepo() {
  const store = new Map<string, Process>();
  return {
    store,
    async getById(t: string, id: string) { const p = store.get(id); return p && p.tenantId === t && !p.deletedAt ? p : null; },
    async list(t: string, o?: { includeInactive?: boolean }) { return [...store.values()].filter((p) => p.tenantId === t && !p.deletedAt && (o?.includeInactive || p.active)); },
    async create(input: any) {
      const p = { id: randomUUID(), tenantId: input.tenantId, parentId: null, level: "PROCESS", name: input.name, description: null, documentType: null, documentReference: null,
        owner: null, active: input.active ?? true, evaluationMode: null, departmentId: input.departmentId ?? null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null } as Process;
      store.set(p.id, p); return p;
    },
    async update(_t: string, id: string, input: any) { const p = { ...store.get(id)!, ...input }; store.set(id, p); return p; },
    async softDelete() { throw new Error("n/a"); },
  };
}
const PERMS: Permission[] = ["department.read", "department.create", "department.update", "department.delete", "process.create", "process.update", "process.read", "process.delete"];

describe("QA-REF2b invariant: never a process (active or not) attached to an archived department", () => {
  async function world() {
    const departments = deptRepo(); const processes = procRepo();
    const dsvc = new DepartmentService(departments as never, audit, processes as never);
    const psvc = new ProcessService(processes as never, audit, undefined, undefined, undefined, departments as never);
    const a = actor(PERMS);
    const d1 = await dsvc.create(a, { name: "Fin", manager: "m@x" }, "r1");
    const d2 = await dsvc.create(a, { name: "RH", manager: "m@x" }, "r2");
    return { processes, dsvc, psvc, a, d1, d2 };
  }
  it("create on an archived department is refused", async () => {
    const { dsvc, psvc, a, d1, processes } = await world();
    await dsvc.archive(a, d1.id, "x", "r");
    await expect(psvc.create(a, { name: "P", level: "PROCESS", departmentId: d1.id } as never, "r")).rejects.toThrow(ValidationError);
    expect(processes.store.size).toBe(0);
  });
  it("reassigning a process (active or inactive) to an archived department is refused", async () => {
    const { dsvc, psvc, a, d1, d2 } = await world();
    const act = await psvc.create(a, { name: "A", level: "PROCESS", departmentId: d2.id } as never, "r");
    const ina = await psvc.create(a, { name: "I", level: "PROCESS", departmentId: d2.id, active: false } as never, "r");
    await dsvc.archive(a, d1.id, "x", "r");
    for (const p of [act, ina]) await expect(psvc.update(a, p.id, { departmentId: d1.id }, "r")).rejects.toThrow(ValidationError);
  });
  it("inactive process blocks the archive, move it, archive, reactivate: it sits on a live department", async () => {
    const { dsvc, psvc, a, d1, d2, processes } = await world();
    const p = await psvc.create(a, { name: "I", level: "PROCESS", departmentId: d1.id, active: false } as never, "r");
    await expect(dsvc.archive(a, d1.id, "x", "r")).rejects.toThrow(ValidationError);
    await psvc.update(a, p.id, { departmentId: d2.id }, "r");
    await dsvc.archive(a, d1.id, "x", "r");
    await psvc.update(a, p.id, { active: true }, "r");
    expect(processes.store.get(p.id)).toMatchObject({ active: true, departmentId: d2.id });
  });
  it("an inactive department is not archived: attaching to it stays allowed (documented, not a violation)", async () => {
    const { dsvc, psvc, a, d1 } = await world();
    await dsvc.update(a, d1.id, { active: false }, "r");
    await expect(psvc.create(a, { name: "P", level: "PROCESS", departmentId: d1.id } as never, "r")).resolves.toBeDefined();
  });
});
