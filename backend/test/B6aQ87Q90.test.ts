import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { PostgresRiskFrameworkRepository } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { RiskFrameworkService } from "../src/services/RiskFrameworkService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// q90: every Dispositif action writes its audit_log row in the SAME transaction (a failing audit = ROLLBACK).
// q87: no new version can carry a Committee/Audit approver (create, edit, copy).

function fakePool(opts: { failAudit?: boolean } = {}) {
  const log: string[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      const s = sql.replace(/\s+/g, " ").trim();
      log.push(s.startsWith("INSERT INTO audit_log") ? `AUDIT ${String(params?.[4])} ${String(params?.[2])}` : s);
      if (s.startsWith("INSERT INTO audit_log") && opts.failAudit) throw new Error("audit down");
      if (s.includes("FROM risk_frameworks") && s.includes("FOR UPDATE")) return { rows: [{ id: "f1" }], rowCount: 1 };
      if (s.startsWith("UPDATE risk_framework_versions SET") && s.includes("last_edited_by")) {
        return { rows: [{ id: "v1", tenant_id: "t1", framework_id: "f1", status: "DRAFT", change_approver: "RISK_MANAGER" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { /* noop */ },
  };
  return { pool: { connect: async () => client } as unknown as Pool, log };
}

const event = { tenantId: "t1", userId: "u1", entityType: "RiskFrameworkVersion", entityId: "v1", action: "UPDATE" as const, oldValue: null, newValue: null, reason: null, requestId: "r" };

describe("q90 PostgresRiskFrameworkRepository audits in the same transaction", () => {
  it("announces it and inserts the audit event between the action and COMMIT", async () => {
    const f = fakePool();
    const repo = new PostgresRiskFrameworkRepository(f.pool);
    expect(repo.auditsInTransaction).toBe(true);
    await repo.updateDraft("t1", "f1", "v1", { selfProposalAllowed: false }, "u1", () => [event]);
    expect(f.log[0]).toBe("BEGIN");
    expect(f.log.at(-2)).toBe("AUDIT UPDATE RiskFrameworkVersion");
    expect(f.log.at(-1)).toBe("COMMIT");
  });

  it("a failing audit write rolls the action back and the error is reported", async () => {
    const f = fakePool({ failAudit: true });
    const repo = new PostgresRiskFrameworkRepository(f.pool);
    await expect(repo.updateDraft("t1", "f1", "v1", { selfProposalAllowed: false }, "u1", () => [event])).rejects.toThrow("audit down");
    expect(f.log.at(-1)).toBe("ROLLBACK");
    expect(f.log).not.toContain("COMMIT");
  });

  it("q87: a copied draft never carries a Committee/Audit approver", async () => {
    const f = fakePool();
    await new PostgresRiskFrameworkRepository(f.pool).createDraftFrom("t1", "f1", "v1", "u1").catch(() => undefined);
    const insert = f.log.find((l) => l.startsWith("INSERT INTO risk_framework_versions"))!;
    expect(insert).toContain("'RISK_MANAGER', s.self_proposal_allowed");
    expect(insert).not.toContain("s.change_approver");
  });
});

describe("q90 RiskFrameworkService with a transactional repository", () => {
  const actor = { userId: "u1", tenantId: "t1", roles: ["riskframework.update"] } as unknown as AuthenticatedUser;

  function build() {
    const audited: string[] = [];
    let passed: unknown;
    const repo = {
      auditsInTransaction: true,
      getFramework: async () => ({ id: "f1", tenantId: "t1", archivedAt: null }),
      updateIdentity: async (_t: string, _id: string, _f: unknown, audit: (r: unknown) => unknown[]) => {
        passed = audit;
        const after = { id: "f1", name: "N" };
        audited.push(...audit(after).map((e) => (e as { action: string }).action));
        return after;
      },
    };
    const records: unknown[] = [];
    const roles = { listForUser: async () => [{ systemGroup: "RISK_MANAGER" }] };
    const service = new RiskFrameworkService(repo as never, {} as never, roles as never, {} as never, { record: async (e: unknown) => records.push(e) } as never);
    return { service, audited, records, passed: () => passed };
  }

  it("hands the audit events to the repository and does not record them a second time", async () => {
    const w = build();
    await w.service.updateIdentity(actor, "f1", { name: "N", reason: "rename" }, "req");
    expect(w.audited).toEqual(["UPDATE"]);
    expect(w.records).toHaveLength(0);
  });
});

describe("q87 approver refused at input", () => {
  const actor = { userId: "u1", tenantId: "t1", roles: ["riskframework.create", "riskframework.update"] } as unknown as AuthenticatedUser;
  const roles = { listForUser: async () => [{ systemGroup: "RISK_MANAGER" }] };
  const scales = { getById: async () => ({ id: "s1", probabilityLevels: 5, impactLevels: 5 }) };
  const service = new RiskFrameworkService({} as never, scales as never, roles as never, {} as never, {} as never);

  it.each(["COMMITTEE", "AUDIT", "AUDIT_AND_COMMITTEE"] as const)("create with %s -> ValidationError", async (a) => {
    await expect(service.create(actor, { name: "X", ratingScaleId: "s1", params: { changeApprover: a } }, "r")).rejects.toThrow(/B-12/);
  });
});
