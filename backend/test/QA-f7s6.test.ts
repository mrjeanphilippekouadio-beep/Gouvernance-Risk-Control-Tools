import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { KriService } from "../src/services/KriService.js";
import { KriMeasureService } from "../src/services/KriMeasureService.js";
import type { KriRepository } from "../src/domain/repositories/KriRepository.js";
import type { KriMeasureRepository } from "../src/domain/repositories/KriMeasureRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { AuditEvent } from "../src/domain/entities/AuditEvent.js";
import type { Kri } from "../src/domain/entities/Kri.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/domain/errors/DomainErrors.js";

// QA F7-S6 (niveau 2). Fakes minimaux : la sémantique Postgres réelle est couverte par le parcours navigateur.
const T1 = "tenant-1";
const T2 = "tenant-2";
const risks = new Map<string, { tenantId: string; deleted: boolean }>([
  ["r1", { tenantId: T1, deleted: false }],
  ["r2", { tenantId: T1, deleted: false }],
  ["r-other", { tenantId: T2, deleted: false }],
  ["r-deleted", { tenantId: T1, deleted: true }],
]);
const visible = (t: string, id: string) => {
  const r = risks.get(id);
  return r && r.tenantId === t && !r.deleted ? ({ id, tenantId: t, ownerDepartmentId: "d1" } as never) : null;
};
const riskRepo = {
  getById: async (t: string, id: string) => visible(t, id),
  listByIds: async (t: string, ids: string[]) => ids.map((i) => visible(t, i)).filter(Boolean),
} as unknown as RiskRepository;

function setup() {
  const store = new Map<string, Kri>();
  const covered = new Map<string, string[]>();
  const events: AuditEvent[] = [];
  const kriRepo = {
    getById: async (t: string, id: string) => {
      const k = store.get(id);
      return k && k.tenantId === t && !k.deletedAt ? k : null;
    },
    list: async () => [...store.values()],
    create: async (i: Omit<Kri, "id">) => {
      const k = { ...i, id: randomUUID(), active: i.active ?? true, deletedAt: null } as Kri;
      store.set(k.id, k);
      return k;
    },
    update: async (_t: string, id: string, i: Partial<Kri>) => {
      const k = { ...store.get(id)!, ...i };
      store.set(id, k);
      return k;
    },
    softDelete: async (_t: string, id: string, by: string, reason: string) => {
      store.set(id, { ...store.get(id)!, deletedAt: new Date(), deletedBy: by, deletionReason: reason });
    },
    listCoveredRiskIds: async (_t: string, id: string) => covered.get(id) ?? [],
    replaceCoveredRisks: async (_t: string, id: string, ids: string[]) => void covered.set(id, ids),
  } as unknown as KriRepository;
  const measures: unknown[] = [];
  const measureRepo = {
    getLatest: async () => null,
    create: async (i: object) => (measures.push(i), { id: randomUUID(), ...i }),
  } as unknown as KriMeasureRepository;
  const audit = { record: async (e: AuditEvent) => void events.push(e) } as unknown as AuditRepository;
  return {
    svc: new KriService(kriRepo, measureRepo, riskRepo, audit),
    measureSvc: new KriMeasureService(measureRepo, kriRepo, audit, undefined, undefined, riskRepo),
    events,
    measures,
  };
}

const user = (roles: string[], tenantId = T1): AuthenticatedUser =>
  ({ userId: `u-${roles.join("-")}-${tenantId}`, tenantId, email: "x@x.test", displayName: "X", roles }) as AuthenticatedUser;
const admin = user(["kri.read", "kri.create", "kri.update", "kri.delete"]);
const input = { label: "L", formula: "f", thresholdGreen: 1, thresholdOrange: 2, thresholdRed: 3, frequency: "MONTHLY" as const, riskId: "r1" };

describe("QA-f7s6 PUT /kris/:id n'altère jamais active", () => {
  it.each([true, false])("refuse active=%s, sans effet ni audit", async (active) => {
    const { svc, events } = setup();
    const k = await svc.create(admin, input, "q");
    const n = events.length;
    await expect(svc.update(admin, k.id, { active }, "q")).rejects.toThrow(ValidationError);
    expect((await svc.get(admin, k.id)).active).toBe(true);
    expect(events).toHaveLength(n);
  });
  it("refuse active même combiné à un champ valide (rien n'est appliqué)", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.update(admin, k.id, { label: "Nouveau", active: false }, "q")).rejects.toThrow(ValidationError);
    expect((await svc.get(admin, k.id)).label).toBe("L");
  });
  it("une mise à jour sans active reste possible", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    expect((await svc.update(admin, k.id, { label: "Nouveau" }, "q")).label).toBe("Nouveau");
  });
  it("l'ordre des seuils reste contrôlé", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.update(admin, k.id, { thresholdRed: 0 }, "q")).rejects.toThrow(ValidationError);
  });
});

describe("QA-f7s6 désactivation", () => {
  it.each(["", "   ", "\n\t"])("refuse un motif vide (%j), KRI intact", async (reason) => {
    const { svc, events } = setup();
    const k = await svc.create(admin, input, "q");
    const n = events.length;
    await expect(svc.disable(admin, k.id, reason, "q")).rejects.toThrow(ValidationError);
    expect(await svc.get(admin, k.id)).toBeTruthy();
    expect(events).toHaveLength(n);
  });
  it("refuse sans kri.delete (kri.update ne suffit pas)", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.disable(user(["kri.read", "kri.update"]), k.id, "motif", "q")).rejects.toThrow(ForbiddenError);
    expect(await svc.get(admin, k.id)).toBeTruthy();
  });
  it("autre tenant : NotFound, KRI intact", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.disable(user(["kri.delete"], T2), k.id, "motif", "q")).rejects.toThrow(NotFoundError);
    expect(await svc.get(admin, k.id)).toBeTruthy();
  });
  it("succès : audit DELETE avec motif et ancien état ; KRI ensuite introuvable, non modifiable, non mesurable, non re-désactivable", async () => {
    const { svc, measureSvc, events, measures } = setup();
    const k = await svc.create(admin, input, "q");
    await svc.disable(admin, k.id, "obsolète", "req-d");
    const ev = events.at(-1)!;
    expect([ev.action, ev.reason, ev.entityId, ev.newValue]).toEqual(["DELETE", "obsolète", k.id, null]);
    expect((ev.oldValue as Kri).id).toBe(k.id);
    await expect(svc.get(admin, k.id)).rejects.toThrow(NotFoundError);
    await expect(svc.update(admin, k.id, { label: "x" }, "q")).rejects.toThrow(NotFoundError);
    await expect(svc.addCoveredRisks(admin, k.id, ["r2"], "q")).rejects.toThrow(NotFoundError);
    await expect(svc.disable(admin, k.id, "encore", "q")).rejects.toThrow(NotFoundError);
    await expect(measureSvc.record(admin, { kriId: k.id, measureDate: new Date(), value: 1, source: "s" }, "q")).rejects.toThrow(ValidationError);
    expect(measures).toHaveLength(0);
  });
});

describe("QA-f7s6 risques couverts", () => {
  it.each([["autre tenant", "r-other"], ["supprimé", "r-deleted"], ["inexistant", "nope"]])("refuse un risque %s, rien n'est remplacé ni audité", async (_n, rid) => {
    const { svc, events } = setup();
    const k = await svc.create(admin, input, "q");
    await svc.addCoveredRisks(admin, k.id, ["r2"], "q");
    const n = events.length;
    await expect(svc.addCoveredRisks(admin, k.id, ["r2", rid], "q")).rejects.toThrow(ValidationError);
    expect((await svc.get(admin, k.id)).coveredRiskIds).toEqual(["r2"]);
    expect(events).toHaveLength(n);
  });
  it("refuse sans kri.update", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.addCoveredRisks(user(["kri.read"]), k.id, ["r2"], "q")).rejects.toThrow(ForbiddenError);
  });
  it("KRI d'un autre tenant : NotFound", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await expect(svc.addCoveredRisks(user(["kri.update"], T2), k.id, ["r-other"], "q")).rejects.toThrow(NotFoundError);
  });
  it("audit avant/après : [] -> [r2], puis [r2] -> [], doublons et risque principal écartés", async () => {
    const { svc, events } = setup();
    const k = await svc.create(admin, input, "q");
    const r = await svc.addCoveredRisks(admin, k.id, ["r2", "r2", "r1"], "q");
    expect(r.coveredRiskIds).toEqual(["r2"]);
    expect([events.at(-1)!.oldValue, events.at(-1)!.newValue]).toEqual([{ coveredRiskIds: [] }, { coveredRiskIds: ["r2"] }]);
    await svc.addCoveredRisks(admin, k.id, [], "q");
    expect([events.at(-1)!.oldValue, events.at(-1)!.newValue]).toEqual([{ coveredRiskIds: ["r2"] }, { coveredRiskIds: [] }]);
    expect((await svc.get(admin, k.id)).coveredRiskIds).toEqual([]);
  });
  it("GET renvoie coveredRiskIds", async () => {
    const { svc } = setup();
    const k = await svc.create(admin, input, "q");
    await svc.addCoveredRisks(admin, k.id, ["r2"], "q");
    expect((await svc.get(admin, k.id)).coveredRiskIds).toEqual(["r2"]);
  });
});

describe("QA-f7s6 KRI active=false (créé inactif)", () => {
  it("CONSTAT : un KRI inactif reste modifiable et mesurable (aucune garde sur active)", async () => {
    const { svc, measureSvc } = setup();
    const k = await svc.create(admin, { ...input, active: false }, "q");
    expect((await svc.update(admin, k.id, { label: "modif" }, "q")).label).toBe("modif");
    const m = await measureSvc.record(admin, { kriId: k.id, measureDate: new Date(), value: 1, source: "s" }, "q");
    expect(m).toBeTruthy();
  });
});
