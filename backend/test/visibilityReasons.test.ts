import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insertAuditEvent } from "../src/infrastructure/database/postgres/PostgresAuditRepository.js";
import { displayReason, visibilityReasonOf } from "../src/domain/entities/VisibilityReason.js";

/**
 * Conservation L2a (migration 096, q246 A / q247 A): the text of a visibility reason lives in visibility_reasons, the journal
 * keeps a reference. Guard test on the writers, in the spirit of boundedArray.test.ts.
 */
const SERVICES = join(__dirname, "..", "src", "services");
const source = (file: string) => readFileSync(join(SERVICES, file), "utf8");

describe("visibility reasons never go back into audit_log.reason", () => {
  // Every writer of a visibility line builds its reason through visibilityReasonOf (text in `visibilityReason`, `reason` null).
  // A new writer, or one that drops the helper, changes a count here: it is a review point, not a number to adjust blindly.
  const WRITERS: Record<string, number> = {
    "resourceVisibility.ts": 3, // set, renew, applyPerimeterChange
    "RiskService.ts": 4, // setVisibility, renewAccess, update (perimeter), designation opening
    "RaciAssignmentService.ts": 2, // createChecked path and the path of the test fakes
    "ProcessService.ts": 1, // process owner opening
    "RoleService.ts": 5, // department group opening (update, assign), grant request / decision / revocation
  };

  it.each(Object.entries(WRITERS))("%s: %i call(s) of visibilityReasonOf", (file, count) => {
    expect(source(file).match(/visibilityReasonOf\(/g) ?? []).toHaveLength(count);
  });

  it("no opening / guard reason is written in a `reason:` field any more", () => {
    for (const file of Object.keys(WRITERS)) {
      expect(source(file), file).not.toMatch(/\breason:\s*(opening|guard)\b/);
    }
  });

  it("the sensitive-view grant snapshots carry no reason text (neither in the journal reason nor in oldValue/newValue)", () => {
    expect(source("RoleService.ts")).toMatch(/grantSnapshot\(g\)/);
    expect(source("RoleService.ts")).not.toMatch(/oldValue: before, newValue: g,/);
  });
});

describe("insertAuditEvent with a visibility reason", () => {
  const base = { tenantId: "t1", userId: "u1", entityType: "Risk", entityId: "r1", action: "PERMISSION_CHANGE" as const, oldValue: null, newValue: null, requestId: "req" };
  const fakeDb = () => {
    const query = vi.fn(async (sql: string) => (sql.includes("INSERT INTO visibility_reasons") ? { rows: [{ id: "reason-1" }] } : { rows: [] }));
    return { query, db: { query } as never };
  };
  const auditParams = (query: ReturnType<typeof fakeDb>["query"]) =>
    query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO audit_log")).map(([, params]) => params as unknown[]);

  it("stores the text once for events sharing the reason, and writes null + the reference in the journal", async () => {
    const { query, db } = fakeDb();
    const shared = visibilityReasonOf("RACI_OPENING", "  Expert consulté ");
    await insertAuditEvent(db, { ...base, ...shared });
    await insertAuditEvent(db, { ...base, entityType: "RaciAssignment", ...shared });
    const reasonInserts = query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO visibility_reasons"));
    expect(reasonInserts).toHaveLength(1);
    expect(reasonInserts[0]![1]).toEqual(["t1", "RACI_OPENING", "Expert consulté"]);
    for (const params of auditParams(query)) {
      expect(params[7]).toBeNull(); // reason
      expect(params[10]).toBe("reason-1"); // reason_ref
    }
  });

  it("a reason already stored by the repository (id) is referenced, not stored again", async () => {
    const { query, db } = fakeDb();
    await insertAuditEvent(db, { ...base, ...visibilityReasonOf("VISIBILITY_CHANGE", "Motif", "stored-9") });
    expect(query.mock.calls.filter(([sql]) => sql.includes("INSERT INTO visibility_reasons"))).toHaveLength(0);
    expect(auditParams(query)[0]![10]).toBe("stored-9");
  });

  it("refuses an event that carries the text both ways", async () => {
    const { db } = fakeDb();
    await expect(insertAuditEvent(db, { ...base, reason: "texte", visibilityReason: { source: "VISIBILITY_CHANGE", text: "texte" } }))
      .rejects.toThrow(/never written in audit_log.reason/);
  });

  it("a blank reason makes no reason at all", () => {
    expect(visibilityReasonOf("VISIBILITY_CHANGE", "   ")).toEqual({ reason: null });
  });
});

describe("displayReason", () => {
  it("shows the text, or the erasure date in the product's format once erased (server side)", () => {
    expect(displayReason("Motif", null)).toBe("Motif");
    expect(displayReason(null, new Date("2026-11-13T23:30:00Z"))).toBe("motif effacé le 13/11/2026 (conservation)");
  });
});

describe("migration 096 (static)", () => {
  const up = readFileSync(join(__dirname, "..", "..", "database", "postgresql", "migrations", "096_visibility_reasons.sql"), "utf8");
  it("moves the existing texts, re-enables the guards it paused, and deletes nothing", () => {
    expect(up).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(up.match(/DISABLE TRIGGER/g)).toHaveLength(2);
    expect(up.match(/ENABLE TRIGGER/g)).toHaveLength(2);
    expect(up.indexOf("DISABLE TRIGGER")).toBeLessThan(up.indexOf("ENABLE TRIGGER"));
    expect(up).not.toMatch(/\bUPDATE\s+audit_log\b/i);
  });
});
