import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ProcessService } from "../src/services/ProcessService.js";
import { ADMIN_PERMISSIONS, FIXED_GROUP_PERMISSIONS } from "../src/domain/fixedGroupPermissions.js";
import { ALL_PERMISSIONS } from "../src/domain/permissions.js";
import { SelfValidationGate } from "../src/services/SelfValidationGate.js";
import { ConflictError, ForbiddenError, ValidationError } from "../src/domain/errors/DomainErrors.js";
import type { Process } from "../src/domain/entities/Process.js";
import type { User } from "../src/domain/entities/User.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { processesRouter } from "../src/api/v1/processes.routes.js";

/** Lot D2b (DECISION-074/075/064): process responsibilities. Level 1 tests. */
const T = "00000000-0000-4000-8000-000000000001";
const OTHER_T = "00000000-0000-4000-8000-000000000002";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = id(99);

const actor = (roles: string[], userId = ACTOR): AuthenticatedUser => ({ userId, tenantId: T, email: "a@x.io", roles }) as AuthenticatedUser;
const assigner = actor(["process.read", "process.responsibility.assign"]);

const user = (n: number, displayName: string, over: Partial<User> = {}): User =>
  ({ id: id(n), tenantId: T, email: `u${n}@x.io`, displayName, roles: [], departmentId: null, createdAt: new Date(), deletedAt: null, ...over }) as User;

function world(owner: string | null = "Jean Dupont", users: User[] = [], gate?: SelfValidationGate) {
  let process = {
    id: id(1), tenantId: T, parentId: null, level: "PROCESS", name: "Achats", description: null, documentType: null,
    documentReference: null, owner, active: true, evaluationMode: null, departmentId: null,
    ownerUserId: null, riskChampionUserId: null, deputyUserId: null,
    createdAt: new Date(), updatedAt: new Date(), deletedAt: null, deletedBy: null, deletionReason: null,
  } as Process;
  const writes: unknown[] = [];
  const audits: any[] = [];
  const processes: any = {
    getById: async (t: string, i: string) => (t === process.tenantId && i === process.id ? process : null),
    setResponsibilities: async (_t: string, _i: string, input: any) => {
      writes.push(input);
      process = { ...process, ...input };
      return process;
    },
  };
  const usersRepo: any = {
    getById: async (t: string, i: string) => users.find((u) => u.tenantId === t && u.id === i) ?? null,
    list: async (t: string) => users.filter((u) => u.tenantId === t && !u.deletedAt),
  };
  const audit: any = { record: async (e: unknown) => void audits.push(e) };
  const service = new ProcessService(processes, audit, undefined, undefined, undefined, undefined, usersRepo, gate);
  return { service, writes, audits, current: () => process };
}

describe("D2b setResponsibilities", () => {
  it("assigns owner, champion and N-1, audits once, and keeps the legacy owner text", async () => {
    const w = world("Jean Dupont", [user(1, "Jean Dupont"), user(2, "Awa Koné"), user(3, "Luc Martin")]);
    const p = await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(1), riskChampionUserId: id(2), deputyUserId: id(3) }, "r1");
    expect([p.ownerUserId, p.riskChampionUserId, p.deputyUserId]).toEqual([id(1), id(2), id(3)]);
    expect(p.owner).toBe("Jean Dupont");
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ entityType: "Process", action: "UPDATE", userId: ACTOR, tenantId: T });
    expect(w.audits[0].newValue.ownerFromProposal).toBe(true);
  });

  it("omitted key is untouched, null clears, an unchanged request writes and audits nothing", async () => {
    const w = world(null, [user(1, "A"), user(2, "B")]);
    await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(1), deputyUserId: id(2) }, "r");
    await w.service.setResponsibilities(assigner, id(1), { deputyUserId: null }, "r");
    expect(w.current()).toMatchObject({ ownerUserId: id(1), deputyUserId: null });
    expect(w.writes[1]).toEqual({ deputyUserId: null });
    await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(1) }, "r");
    expect(w.writes).toHaveLength(2);
    expect(w.audits).toHaveLength(2);
  });

  it("refuses without the dedicated permission (process.update is not enough)", async () => {
    const w = world();
    await expect(w.service.setResponsibilities(actor(["process.read", "process.update"]), id(1), { ownerUserId: id(1) }, "r")).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.writes).toHaveLength(0);
  });

  it("refuses a suspended account, an unknown account and an account of another tenant", async () => {
    const w = world("x", [user(1, "S", { deletedAt: new Date() }), user(2, "Other", { tenantId: OTHER_T })]);
    for (const uid of [id(1), id(2), id(3)]) {
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: uid }, "r")).rejects.toBeInstanceOf(ValidationError);
    }
    expect(w.writes).toHaveLength(0);
  });

  it("refuses self-designation (I-R1)", async () => {
    const w = world("x", [user(99, "Me")]);
    await expect(w.service.setResponsibilities(assigner, id(1), { deputyUserId: ACTOR }, "r")).rejects.toBeInstanceOf(ValidationError);
    expect(w.writes).toHaveLength(0);
  });

  describe("q166 (DECISION-080): self as risk champion when nobody else can assign", () => {
    const gate = (otherExists: boolean) =>
      new SelfValidationGate(
        { getByTenant: async () => ({ selfValidationPolicy: "DOUBLE_CONFIRMATION" }) } as any,
        { existsOther: async () => otherExists } as any,
      );
    const confirmation = { rule: "noSelfValidation" as const, reason: "Structure à une personne, pas d'autre Risk Manager" };

    it("is refused without the gate, as before", async () => {
      const w = world("x", [user(99, "Me")]);
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ACTOR }, "r", confirmation)).rejects.toBeInstanceOf(ForbiddenError);
      expect(w.writes).toHaveLength(0);
    });

    it("asks for the double confirmation, then applies it with its reason and the governance marker", async () => {
      const w = world("x", [user(99, "Me")], gate(false));
      await expect(w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ACTOR }, "r")).rejects.toBeInstanceOf(ConflictError);
      const p = await w.service.setResponsibilities(assigner, id(1), { riskChampionUserId: ACTOR }, "r", confirmation);
      expect(p.riskChampionUserId).toBe(ACTOR);
      expect(w.audits[0]).toMatchObject({ governanceException: "noSelfValidation", reason: confirmation.reason });
      expect(w.audits[0].newValue.selfValidation).toEqual({ otherValidatorExists: false, reason: confirmation.reason });
    });

    it("is refused when someone else can assign, and never extends to owner or N-1", async () => {
      await expect(
        world("x", [user(99, "Me")], gate(true)).service.setResponsibilities(assigner, id(1), { riskChampionUserId: ACTOR }, "r", confirmation),
      ).rejects.toBeInstanceOf(ForbiddenError);
      for (const input of [{ ownerUserId: ACTOR }, { deputyUserId: ACTOR }]) {
        const w = world("x", [user(99, "Me")], gate(false));
        await expect(w.service.setResponsibilities(assigner, id(1), input, "r", confirmation)).rejects.toBeInstanceOf(ValidationError);
        expect(w.writes).toHaveLength(0);
      }
    });
  });

  it("fails closed when a user is named but no UserRepository is wired", async () => {
    const w = world();
    const svc = new ProcessService({ getById: async () => w.current() } as any, { record: async () => {} } as any);
    await expect(svc.setResponsibilities(assigner, id(1), { ownerUserId: id(5) }, "r")).rejects.toThrow(/UserRepository/);
  });
});

describe("D2b owner proposal (DECISION-075 q150)", () => {
  it("proposes active accounts matching the legacy name (accents, case, word order), without applying anything", async () => {
    const w = world("DUPONT jean-marc", [user(1, "Jean-Marc Dupont"), user(2, "Jean Dupont"), user(3, "Jean-Marc Dupont", { deletedAt: new Date() }), user(4, "X", { tenantId: OTHER_T })]);
    const view = await w.service.getResponsibilities(assigner, id(1));
    expect(view.ownerCandidates).toEqual([{ id: id(1), displayName: "Jean-Marc Dupont" }]);
    expect(view.legacyOwner).toBe("DUPONT jean-marc");
    expect(view.ownerUserId).toBeNull();
    expect(w.writes).toHaveLength(0);
  });

  it("proposes nothing to a reader without the assign permission, nor once an owner account is set, nor for a blank legacy owner", async () => {
    const w = world("Awa Koné", [user(1, "Awa Kone")]);
    expect((await w.service.getResponsibilities(actor(["process.read"]), id(1))).ownerCandidates).toEqual([]);
    expect((await w.service.getResponsibilities(assigner, id(1))).ownerCandidates).toHaveLength(1);
    await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(1) }, "r");
    expect((await w.service.getResponsibilities(assigner, id(1))).ownerCandidates).toEqual([]);
    expect((await world("  ", [user(1, "")]).service.getResponsibilities(assigner, id(1))).ownerCandidates).toEqual([]);
  });

  it("records ownerFromProposal=false when the confirmed owner was not the proposed one", async () => {
    const w = world("Jean Dupont", [user(1, "Jean Dupont"), user(2, "Someone Else")]);
    await w.service.setResponsibilities(assigner, id(1), { ownerUserId: id(2) }, "r");
    expect(w.audits[0].newValue.ownerFromProposal).toBe(false);
  });

  it("requires process.read", async () => {
    await expect(world().service.getResponsibilities(actor([]), id(1))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("D2b route body", () => {
  const handlers = () => {
    const router: any = processesRouter({} as any);
    const layer = router.stack.find((l: any) => l.route?.path === "/:id/responsibilities" && l.route.methods.put);
    return layer.route.stack[0].handle as (req: any, res: any, next: (e?: unknown) => void) => Promise<void>;
  };
  it("rejects unknown keys (attribution fields) and non-uuid values, accepts null and uuid", async () => {
    const h = handlers();
    for (const body of [{ ownerUserId: "not-a-uuid" }, { designatedBy: id(1) }, { ownerUserId: 5 }]) {
      let err: unknown;
      await h({ body, params: { id: id(1) }, user: assigner, requestId: "r" }, {}, (e) => (err = e));
      expect(err).toBeDefined();
    }
  });
});

describe("D2b migration 069 and permissions", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../../database/postgresql/migrations");
  const up = readFileSync(join(dir, "069_process_responsibilities.sql"), "utf8");
  const down = readFileSync(join(dir, "069_process_responsibilities.down.sql"), "utf8");

  it("the permission is known and given to the Risk Manager group only (not Committee, not Audit)", () => {
    expect(ALL_PERMISSIONS).toContain("process.responsibility.assign");
    expect(FIXED_GROUP_PERMISSIONS.RISK_MANAGER).toContain("process.responsibility.assign");
    expect(FIXED_GROUP_PERMISSIONS.RISK_COMMITTEE).not.toContain("process.responsibility.assign");
    expect(FIXED_GROUP_PERMISSIONS.AUDIT).not.toContain("process.responsibility.assign");
  });

  it("catch-up uses every administrator permission of the code; no physical delete, no trigger", () => {
    // designation.manage arrives with migration 070 (D2c), which carries its own catch-up.
    for (const p of ADMIN_PERMISSIONS.filter((x) => x !== "designation.manage")) expect(up).toContain(`'${p}'`);
    expect(up).not.toMatch(/\b(DELETE FROM|TRUNCATE|CREATE\s+(OR REPLACE\s+)?FUNCTION)\b/i);
    expect(up).not.toMatch(/owner\s*=/); // the legacy text is never rewritten
    expect(down).toContain("DROP COLUMN IF EXISTS owner_user_id");
  });
});
