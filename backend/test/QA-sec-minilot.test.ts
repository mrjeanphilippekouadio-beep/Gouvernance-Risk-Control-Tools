import { describe, expect, it } from "vitest";
import express from "express";
import { randomUUID } from "node:crypto";
import { auditLogRouter } from "../src/api/v1/auditLog.routes.js";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { AuditLogService } from "../src/services/AuditLogService.js";
import { ActionPlanService } from "../src/services/ActionPlanService.js";
import type { AuditRepository, AuditSearchFilters } from "../src/domain/repositories/AuditRepository.js";
import type { ActionPlanRepository } from "../src/domain/repositories/ActionPlanRepository.js";
import type { EvidenceRepository } from "../src/domain/repositories/EvidenceRepository.js";
import type { ActionPlan } from "../src/domain/entities/ActionPlan.js";
import type { Evidence } from "../src/domain/entities/Evidence.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

// ---------- GET /audit-logs : limit + filters (real AuditLogService, spy repo) ----------

interface Call {
  fn: "listRecent" | "search" | "listForEntity";
  limit?: number;
  filters?: AuditSearchFilters;
}

async function get(query: string): Promise<{ status: number; calls: Call[] }> {
  const calls: Call[] = [];
  const repo: AuditRepository = {
    async record() {},
    async listForEntity() {
      calls.push({ fn: "listForEntity" });
      return [];
    },
    async listRecent(_t, limit) {
      calls.push({ fn: "listRecent", limit });
      return [];
    },
    async search(_t, filters, limit) {
      calls.push({ fn: "search", filters, limit });
      return [];
    },
  };
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId: "u", tenantId: "t", roles: ["audit.read"] };
    next();
  });
  app.use("/", auditLogRouter(new AuditLogService(repo)));
  app.use(errorHandler);
  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/${query}`);
    return { status: res.status, calls };
  } finally {
    server.close();
  }
}

describe("QA-sec-minilot: GET /audit-logs limit boundaries", () => {
  it.each([
    ["1", 1],
    ["500", 500],
  ])("accepts boundary limit=%s", async (v, expected) => {
    const r = await get(`?limit=${v}`);
    expect(r.status).toBe(200);
    expect(r.calls).toEqual([{ fn: "listRecent", limit: expected }]);
  });

  // Number() coercion semantics, documented as the explicit expected behaviour.
  it.each([
    ["%2010%20", 10], // " 10 " -> trimmed by Number()
    ["1e2", 100], // integer-valued exponent notation
    ["0x10", 16], // hex literal is also coerced by Number()
  ])("coerces limit=%s to %i (accepted, in range)", async (v, expected) => {
    const r = await get(`?limit=${v}`);
    expect(r.status).toBe(200);
    expect(r.calls[0]?.limit).toBe(expected);
  });

  it.each([
    ["empty string", "?limit="], // Number("") = 0 -> below min
    ["Infinity", "?limit=Infinity"],
    ["-Infinity", "?limit=-Infinity"],
    ["NaN", "?limit=NaN"],
    ["repeated param (array)", "?limit=1&limit=2"], // Number(["1","2"]) = NaN
    ["1e3 (>500)", "?limit=1e3"],
    ["501", "?limit=501"],
    ["whitespace only", "?limit=%20"],
  ])("rejects %s with 400 and never reaches the repository", async (_label, q) => {
    const r = await get(q);
    expect(r.status).toBe(400);
    expect(r.calls).toEqual([]);
  });

  it("Express 5 simple query parser: limit[a]=1 is a different key, so limit is absent -> default 100 (200)", async () => {
    const r = await get("?limit[a]=1");
    expect(r.status).toBe(200);
    expect(r.calls).toEqual([{ fn: "listRecent", limit: 100 }]);
  });

  it("applies the bound to the filtered search path too", async () => {
    expect((await get("?userId=u1&limit=501")).status).toBe(400);
    const ok = await get("?userId=u1&limit=500");
    expect(ok.status).toBe(200);
    expect(ok.calls[0]).toMatchObject({ fn: "search", limit: 500 });
  });
});

describe("QA-sec-minilot: GET /audit-logs filters still work", () => {
  it("routes userId/action/entityType/entityId/from/to to search with parsed dates", async () => {
    const r = await get(
      "?userId=u1&action=CLOSE&entityType=ActionPlan&entityId=e1&from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z&limit=20",
    );
    expect(r.status).toBe(200);
    expect(r.calls).toHaveLength(1);
    const c = r.calls[0]!;
    expect(c.fn).toBe("search");
    expect(c.limit).toBe(20);
    expect(c.filters).toMatchObject({ userId: "u1", action: "CLOSE", entityType: "ActionPlan", entityId: "e1" });
    expect(c.filters?.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(c.filters?.to?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });

  it("entityType+entityId without other filter still uses listForEntity; no filter uses listRecent with default limit", async () => {
    expect((await get("?entityType=Risk&entityId=r1")).calls).toEqual([{ fn: "listForEntity" }]);
    expect((await get("")).calls).toEqual([{ fn: "listRecent", limit: 100 }]);
  });

  it("filter without limit uses the default limit (100)", async () => {
    const r = await get("?from=2026-01-01");
    expect(r.calls[0]).toMatchObject({ fn: "search", limit: 100 });
  });

  it("a malformed date filter yields 400, not a 500 / Invalid Date passed to the repository", async () => {
    const r = await get("?from=not-a-date");
    expect(r.status).toBe(400);
    expect(r.calls).toEqual([]);
  });
});

// ---------- ActionPlanService.close : evidence oracle + no side effect on refusal ----------

const creator: AuthenticatedUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  email: "c@example.com",
  displayName: "Creator",
  roles: ["actionplan.read", "actionplan.create", "actionplan.update", "actionplan.validate"],
};
const closer: AuthenticatedUser = { ...creator, userId: "user-2" };

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev-1",
    tenantId: "tenant-1",
    controlExecutionId: null,
    fileName: "p.pdf",
    driveFileId: "d",
    driveUrl: "https://drive.example/1",
    documentType: "PDF",
    uploadedBy: "user-2",
    uploadedAt: new Date(),
    version: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

function setup(evidences: Evidence[]) {
  const store = new Map<string, ActionPlan>();
  let closeCalls = 0;
  const auditRecords: unknown[] = [];
  const actions = {
    async getById(t: string, id: string) {
      const a = store.get(id);
      return a && a.tenantId === t ? a : null;
    },
    async create(input: Record<string, unknown>) {
      const a = {
        id: randomUUID(),
        status: "PLANIFIEE",
        progressPercent: 0,
        progressComment: null,
        evidenceId: null,
        closedBy: null,
        closedAt: null,
        closureComment: null,
        description: null,
        sourceId: null,
        departmentId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...input,
      } as unknown as ActionPlan;
      store.set(a.id, a);
      return a;
    },
    async close(_t: string, id: string, closedBy: string, evidenceId: string, comment: string | null) {
      closeCalls++;
      const a = { ...store.get(id)!, status: "TERMINEE", closedBy, evidenceId, closureComment: comment, closedAt: new Date() } as ActionPlan;
      store.set(id, a);
      return a;
    },
    async listLinks() {
      return [];
    },
  } as unknown as ActionPlanRepository;
  const audit: AuditRepository = {
    async record(e) {
      auditRecords.push(e);
    },
    async listForEntity() {
      return [];
    },
    async listRecent() {
      return [];
    },
  };
  const evRepo: EvidenceRepository = {
    async getById(t, id) {
      return evidences.find((e) => e.id === id && e.tenantId === t) ?? null;
    },
    async listForControlExecution() {
      return [];
    },
    async create() {
      throw new Error("unused");
    },
    async markDeleted() {},
  };
  const unused = {} as never;
  const service = new ActionPlanService(actions, audit, unused, unused, unused, unused, evRepo);
  return { service, store, auditRecords, closeCalls: () => closeCalls };
}

async function newAction(s: ReturnType<typeof setup>): Promise<string> {
  const due = new Date();
  due.setFullYear(due.getFullYear() + 1);
  const a = await s.service.create(creator, { title: "T", sourceType: "MANAGEMENT", responsibleUserId: "user-3", dueDate: due }, "REQ-c");
  s.auditRecords.length = 0; // only observe what close() does
  return a.id;
}

async function closeError(s: ReturnType<typeof setup>, actionId: string, evidenceId: string): Promise<Error> {
  try {
    await s.service.close(closer, actionId, evidenceId, "c", "REQ-x");
  } catch (e) {
    return e as Error;
  }
  throw new Error("close() unexpectedly succeeded");
}

describe("QA-sec-minilot: ActionPlanService.close evidence oracle", () => {
  const DELETED = evidence({ id: "ev-del", status: "DELETED" });
  const OTHER_TENANT = evidence({ id: "ev-other", tenantId: "tenant-2" });
  const ACTIVE = evidence({ id: "ev-ok" });

  it("DELETED, other-tenant and nonexistent evidences produce the same error class and the same message shape", async () => {
    const s = setup([DELETED, OTHER_TENANT, ACTIVE]);
    const id = await newAction(s);
    const ids = ["ev-del", "ev-other", "ev-ghost"];
    const errs = await Promise.all(ids.map((e) => closeError(s, id, e)));
    for (const e of errs) expect(e).toBeInstanceOf(ValidationError);
    const shapes = errs.map((e, i) => e.message.replace(ids[i]!, "<ID>"));
    expect(new Set(shapes).size).toBe(1);
  });

  it("with the SAME evidence id, DELETED (own tenant) vs other tenant vs absent are byte-identical", async () => {
    const msg = async (evs: Evidence[]) => {
      const s = setup(evs);
      return (await closeError(s, await newAction(s), "ev-same")).message;
    };
    const deleted = await msg([evidence({ id: "ev-same", status: "DELETED" })]);
    const other = await msg([evidence({ id: "ev-same", tenantId: "tenant-2" })]);
    const absent = await msg([]);
    expect(deleted).toBe(absent);
    expect(other).toBe(absent);
  });

  it("refusals write no audit event, call no repository close(), and leave the plan open", async () => {
    const s = setup([DELETED, OTHER_TENANT]);
    const id = await newAction(s);
    for (const ev of ["ev-del", "ev-other", "ev-ghost"]) await closeError(s, id, ev);
    expect(s.auditRecords).toEqual([]);
    expect(s.closeCalls()).toBe(0);
    const stored = s.store.get(id)!;
    expect(stored.status).toBe("PLANIFIEE");
    expect(stored.evidenceId).toBeNull();
    expect(stored.closedBy).toBeNull();
  });

  it("an ACTIVE evidence still closes after previous refusals (and exactly one CLOSE audit is written)", async () => {
    const s = setup([DELETED, ACTIVE]);
    const id = await newAction(s);
    await closeError(s, id, "ev-del");
    const closed = await s.service.close(closer, id, "ev-ok", "ok", "REQ-y");
    expect(closed.status).toBe("TERMINEE");
    expect(s.auditRecords).toHaveLength(1);
    expect(s.auditRecords[0]).toMatchObject({ action: "CLOSE", entityId: id, tenantId: "tenant-1" });
  });

  it("whitespace-only evidenceId is refused as missing", async () => {
    const s = setup([ACTIVE]);
    const id = await newAction(s);
    const e = await closeError(s, id, "   ");
    expect(e).toBeInstanceOf(ValidationError);
    expect(s.auditRecords).toEqual([]);
    expect(s.store.get(id)!.status).toBe("PLANIFIEE");
  });
});
