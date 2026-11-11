import { describe, expect, it } from "vitest";
import { auditPersonTextPair, auditWithoutPersonText } from "../src/services/auditPersonText.js";
import { DepartmentService } from "../src/services/DepartmentService.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";

describe("q273 free-text person fields leave the journal", () => {
  it("removes the values and flags only the fields that changed", () => {
    const before = { id: "1", manager: "Alice A", riskOwner: "Alice A", name: "Fin" };
    const after = { ...before, manager: "Bob B", name: "Finance" };
    const { oldValue, newValue } = auditPersonTextPair(before, after, ["manager", "riskOwner"]);
    expect(JSON.stringify([oldValue, newValue])).not.toMatch(/Alice|Bob/);
    expect(newValue).toMatchObject({ id: "1", name: "Finance", managerChanged: true });
    expect(newValue).not.toHaveProperty("riskOwnerChanged");
    expect(auditWithoutPersonText(before, ["manager"])).not.toHaveProperty("manager");
  });

  it("DepartmentService writes create and update rows without the typed names", async () => {
    const events: AuditEvent[] = [];
    let stored: Record<string, unknown> = {};
    const repo = {
      async create(input: { manager: string }) { stored = { id: "d1", tenantId: "t", name: "F", manager: input.manager, riskOwner: input.manager }; return stored; },
      async getById() { return stored; },
      async update(_t: string, _i: string, input: object) { stored = { ...stored, ...input }; return stored; },
    } as never;
    const audit = { async record(e: AuditEvent) { events.push(e); }, async listForEntity() { return []; } } as never;
    const service = new DepartmentService(repo, audit);
    const actor = { userId: "u", tenantId: "t", email: "a@b.c", displayName: "A", roles: ["department.create", "department.update", "department.read"] };
    await service.create(actor, { name: "F", manager: "Zoe Zed" }, "R1");
    await service.update(actor, "d1", { manager: "Yan Yi" }, "R2");
    expect(JSON.stringify(events)).not.toMatch(/Zoe|Yan/);
    expect(events[1]!.newValue).toMatchObject({ managerChanged: true });
  });
});
