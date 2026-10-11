import { describe, expect, it, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { errorHandler } from "../src/api/middleware/errorHandler.js";
import { ratingScalesRouter } from "../src/api/v1/ratingScales.routes.js";
import { controlsRouter } from "../src/api/v1/controls.routes.js";
import { rolesRouter } from "../src/api/v1/roles.routes.js";
import { ALL_PERMISSIONS } from "../src/domain/permissions.js";
import type { RatingScaleService } from "../src/services/RatingScaleService.js";
import type { ControlService } from "../src/services/ControlService.js";
import type { RaciEnrichmentViewService } from "../src/services/RaciEnrichmentViewService.js";
import type { RoleService } from "../src/services/RoleService.js";

// QA-S1: boundary / regression cases for boundedArray (S-1, CVE-2023-54404).
// Oracle: max accepted, max+1 -> 400, min kept, generic 400 message, nullish kept.

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function start(mount: string, router: express.Router): Promise<string> {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId: "u1", tenantId: "t1", roles: [], permissions: [] };
    next();
  });
  app.use(mount, router);
  app.use(errorHandler);
  const port = await new Promise<number>((resolve) => {
    server = app.listen(0, () => resolve((server!.address() as { port: number }).port));
  });
  return `http://127.0.0.1:${port}`;
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as { error?: string; data?: unknown } };
}

const th = (i: number) => ({ label: `L${i}`, min: i, max: i + 1 });
const lvl = (i: number) => ({ level: i, label: `N${i}` });

describe("rating scales: boundaries", () => {
  const mk = () => ({
    updateThresholds: vi.fn().mockResolvedValue({ id: "s1" }),
    updateMastery: vi.fn().mockResolvedValue({ id: "s1" }),
    updateImpactAxes: vi.fn().mockResolvedValue({ id: "s1" }),
  });

  it("thresholds: exactly 50 accepted, 51 -> 400 generic", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const ok = await send(`${base}/rs/s1/thresholds`, "PUT", { thresholds: Array.from({ length: 50 }, (_, i) => th(i)) });
    expect(ok.status).toBe(200);
    expect(svc.updateThresholds).toHaveBeenCalledTimes(1);
    const ko = await send(`${base}/rs/s1/thresholds`, "PUT", { thresholds: Array.from({ length: 51 }, (_, i) => th(i)) });
    expect(ko.status).toBe(400);
    expect(ko.json.error).toBe("Requête invalide.");
    expect(svc.updateThresholds).toHaveBeenCalledTimes(1);
  });

  it("thresholds: empty accepted (no min); invalid element / non-array / null / missing -> 400 generic", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const url = `${base}/rs/s1/thresholds`;
    expect((await send(url, "PUT", { thresholds: [] })).status).toBe(200);
    const bad = await send(url, "PUT", { thresholds: [th(1), { label: "", min: 1, max: 2 }] });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("Requête invalide.");
    expect((await send(url, "PUT", { thresholds: "x" })).status).toBe(400);
    expect((await send(url, "PUT", { thresholds: null })).status).toBe(400);
    expect((await send(url, "PUT", {})).status).toBe(400);
  });

  it("impact-axes: 7 accepted, 8 -> 400 (B-9)", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const ax = (i: number) => ({ code: `A${i}`, label: `Axe ${i}`, order: i });
    const url = `${base}/rs/s1/impact-axes`;
    expect((await send(url, "PUT", { axes: Array.from({ length: 7 }, (_, i) => ax(i)) })).status).toBe(200);
    const ko = await send(url, "PUT", { axes: Array.from({ length: 8 }, (_, i) => ax(i)) });
    expect(ko.status).toBe(400);
    expect(ko.json.error).toBe("Requête invalide.");
  });

  it("mastery: thresholds nullish (null and absent accepted); defenseLines bounded at 50", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const levels = [lvl(1), lvl(2)];
    const url = `${base}/rs/s1/mastery`;
    expect((await send(url, "PUT", { levels, defenseLines: ["1L"], thresholds: null })).status).toBe(200);
    expect((await send(url, "PUT", { levels, defenseLines: ["1L"] })).status).toBe(200);
    expect(svc.updateMastery).toHaveBeenCalledTimes(2);
    expect(svc.updateMastery.mock.calls[0]![2].thresholds ?? null).toBeNull();
    expect(svc.updateMastery.mock.calls[1]![2].thresholds ?? null).toBeNull();
    expect((await send(url, "PUT", { levels, defenseLines: Array(50).fill("1L") })).status).toBe(200);
    expect((await send(url, "PUT", { levels, defenseLines: Array(51).fill("1L") })).status).toBe(400);
    expect((await send(url, "PUT", { levels, defenseLines: ["1L", ""] })).status).toBe(400);
    expect((await send(url, "PUT", { levels, defenseLines: ["1L"], thresholds: Array.from({ length: 51 }, (_, i) => th(i)) })).status).toBe(400);
  });

  it("create scale: labels nullish kept (null/absent ok); 6 ok, 7 -> 400 (B-9)", async () => {
    const svc = { create: vi.fn().mockResolvedValue({ id: "s1" }) };
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const core = { name: "Echelle", version: "v1", probabilityLevels: 4, impactLevels: 4 };
    expect((await send(`${base}/rs`, "POST", core)).status).toBe(201);
    expect((await send(`${base}/rs`, "POST", { ...core, probabilityLabels: null, impactLabels: null })).status).toBe(201);
    expect((await send(`${base}/rs`, "POST", { ...core, probabilityLabels: Array.from({ length: 6 }, (_, i) => lvl(i)) })).status).toBe(201);
    expect((await send(`${base}/rs`, "POST", { ...core, impactLabels: Array.from({ length: 7 }, (_, i) => lvl(i)) })).status).toBe(400);
  });

  it("E2E frontend payload: saveMastery with empty draft -> thresholds null, passed through intact", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const payload = {
      levels: [lvl(1), lvl(2), lvl(3), lvl(4)],
      defenseLines: ["1ère ligne", "2ème ligne", "3ème ligne"],
      thresholds: null,
    };
    expect((await send(`${base}/rs/s1/mastery`, "PUT", payload)).status).toBe(200);
    expect(svc.updateMastery.mock.calls[0]![2]).toEqual(payload);
  });

  it("E2E frontend payload: updateThresholds", async () => {
    const svc = mk();
    const base = await start("/rs", ratingScalesRouter(svc as unknown as RatingScaleService));
    const thresholds = [
      { label: "Faible", min: 1, max: 4 },
      { label: "Moyen", min: 5, max: 9 },
      { label: "Élevé", min: 10, max: 16 },
    ];
    expect((await send(`${base}/rs/s1/thresholds`, "PUT", { thresholds })).status).toBe(200);
    expect(svc.updateThresholds.mock.calls[0]![2]).toEqual({ thresholds });
  });
});

describe("controls: coveredRiskIds boundaries", () => {
  const control = {
    label: "Revue", coveredRiskIds: ["r1"], controlType: "PREVENTIVE", frequency: "MONTHLY",
    executor: "ops", complianceCriteria: "ok",
  };
  const mk = () => ({ create: vi.fn().mockResolvedValue({ id: "c1" }), update: vi.fn().mockResolvedValue({ id: "c1" }) });
  const router = (svc: unknown) => controlsRouter(svc as ControlService, {} as RaciEnrichmentViewService);

  it("empty -> 400 (min kept); 1 ok; 1000 ok; 1001 -> 400", async () => {
    const svc = mk();
    const base = await start("/c", router(svc));
    const empty = await send(`${base}/c`, "POST", { ...control, coveredRiskIds: [] });
    expect(empty.status).toBe(400);
    expect(empty.json.error).toBe("Requête invalide.");
    expect((await send(`${base}/c`, "POST", control)).status).toBe(201);
    expect((await send(`${base}/c`, "POST", { ...control, coveredRiskIds: Array.from({ length: 1000 }, (_, i) => `r${i}`) })).status).toBe(201);
    const ko = await send(`${base}/c`, "POST", { ...control, coveredRiskIds: Array.from({ length: 1001 }, (_, i) => `r${i}`) });
    expect(ko.status).toBe(400);
    expect(svc.create).toHaveBeenCalledTimes(2);
  });

  it("wrong element type / null / missing -> 400", async () => {
    const svc = mk();
    const base = await start("/c", router(svc));
    expect((await send(`${base}/c`, "POST", { ...control, coveredRiskIds: [1] })).status).toBe(400);
    expect((await send(`${base}/c`, "POST", { ...control, coveredRiskIds: null })).status).toBe(400);
    const { coveredRiskIds: _omit, ...noIds } = control;
    expect((await send(`${base}/c`, "POST", noIds)).status).toBe(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("PATCH: coveredRiskIds optional; present-but-empty -> 400", async () => {
    const svc = mk();
    const base = await start("/c", router(svc));
    expect((await send(`${base}/c/c1`, "PATCH", { label: "x" })).status).toBe(200);
    expect((await send(`${base}/c/c1`, "PATCH", { coveredRiskIds: [] })).status).toBe(400);
    expect((await send(`${base}/c/c1`, "PATCH", { coveredRiskIds: ["r2"] })).status).toBe(200);
  });

  it("E2E frontend payload: ControlsPage.submit (nulls for blanks)", async () => {
    const svc = mk();
    const base = await start("/c", router(svc));
    const payload = {
      label: "Rapprochement quotidien", objective: null, coveredRiskIds: ["a1", "b2"], process: null,
      controlType: "DETECTIVE", frequency: "DAILY", executor: "Finance", validator: null,
      procedureDescription: null, expectedEvidence: null, complianceCriteria: "Ecart nul",
    };
    expect((await send(`${base}/c`, "POST", payload)).status).toBe(201);
    expect(svc.create.mock.calls[0]![1]).toEqual(payload);
  });
});

describe("roles: permissions boundaries", () => {
  const mk = () => ({ create: vi.fn().mockResolvedValue({ id: "r1" }), update: vi.fn().mockResolvedValue({ id: "r1" }) });

  it("create: empty -> 400; 1 ok; full catalogue ok; catalogue + 1 -> 400", async () => {
    const svc = mk();
    const base = await start("/r", rolesRouter(svc as unknown as RoleService));
    expect((await send(`${base}/r`, "POST", { name: "A", permissions: [] })).status).toBe(400);
    expect((await send(`${base}/r`, "POST", { name: "A", permissions: [ALL_PERMISSIONS[0]] })).status).toBe(201);
    expect((await send(`${base}/r`, "POST", { name: "A", permissions: [...ALL_PERMISSIONS] })).status).toBe(201);
    const ko = await send(`${base}/r`, "POST", { name: "A", permissions: [...ALL_PERMISSIONS, ALL_PERMISSIONS[0]] });
    expect(ko.status).toBe(400);
    expect(ko.json.error).toBe("Requête invalide.");
    expect(svc.create).toHaveBeenCalledTimes(2);
  });

  it("unknown permission in a right-sized array -> 400 generic", async () => {
    const svc = mk();
    const base = await start("/r", rolesRouter(svc as unknown as RoleService));
    const ko = await send(`${base}/r`, "POST", { name: "A", permissions: ["risk.read", "nope.nope"] });
    expect(ko.status).toBe(400);
    expect(ko.json.error).toBe("Requête invalide.");
  });

  it("update: permissions optional; empty -> 400; valid ok", async () => {
    const svc = mk();
    const base = await start("/r", rolesRouter(svc as unknown as RoleService));
    expect((await send(`${base}/r/r1`, "PATCH", { name: "B" })).status).toBe(200);
    expect((await send(`${base}/r/r1`, "PATCH", { permissions: [] })).status).toBe(400);
    expect((await send(`${base}/r/r1`, "PATCH", { permissions: ["risk.read"] })).status).toBe(200);
  });

  it("E2E frontend payload: CreateRoleInput (description optional)", async () => {
    const svc = mk();
    const base = await start("/r", rolesRouter(svc as unknown as RoleService));
    const payload = { name: "Auditeur", description: "Lecture seule", permissions: ["audit.read"] };
    expect((await send(`${base}/r`, "POST", payload)).status).toBe(201);
    expect(svc.create.mock.calls[0]![1]).toEqual(payload);
    expect((await send(`${base}/r`, "POST", { name: "Auditeur2", permissions: ["audit.read"] })).status).toBe(201);
  });
});
