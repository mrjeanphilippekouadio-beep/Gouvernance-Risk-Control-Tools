import { Router } from "express";
import { z } from "zod";
import type { KriService } from "../../services/KriService.js";
import type { KriStatus } from "../../domain/entities/Kri.js";

const Frequency = z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]);
const Status = z.enum(["VERT", "ORANGE", "ROUGE", "NO_MEASURE"]);

const CreateKriBody = z.object({
  label: z.string().min(1),
  formula: z.string().min(1),
  thresholdGreen: z.number().finite(),
  thresholdOrange: z.number().finite(),
  thresholdRed: z.number().finite(),
  frequency: Frequency,
  riskId: z.string().min(1),
  entity: z.string().nullish(),
  methodologyVersion: z.string().nullish(),
  description: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateKriBody = CreateKriBody.omit({ riskId: true }).partial();

const CoveredRisksBody = z.object({ riskIds: z.array(z.string().min(1)) });

const DisableKriBody = z.object({ reason: z.string().min(1) });

export function krisRouter(kriService: KriService): Router {
  const router = Router();

  // ACT-137: dashboard listing — registered before "/:id" so "dashboard"
  // is never parsed as a KRI id (same trick roles.routes.ts uses for
  // "/matrix" and "/users/:userId").
  router.get("/dashboard", async (req, res, next) => {
    try {
      const departmentId = typeof req.query["departmentId"] === "string" ? req.query["departmentId"] : undefined;
      const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : undefined;
      const statusRaw = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
      const status = statusRaw ? (Status.parse(statusRaw) as KriStatus) : undefined;
      const periodFrom = typeof req.query["from"] === "string" ? new Date(req.query["from"]) : undefined;
      const periodTo = typeof req.query["to"] === "string" ? new Date(req.query["to"]) : undefined;

      const rows = await kriService.dashboard(req.user, { departmentId, entity, status, periodFrom, periodTo });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const riskId = typeof req.query["riskId"] === "string" ? req.query["riskId"] : undefined;
      const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : undefined;
      const kris = await kriService.list(req.user, { includeInactive, riskId, entity });
      res.json({ data: kris });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const kri = await kriService.get(req.user, req.params["id"] as string);
      res.json({ data: kri });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateKriBody.parse(req.body);
      const kri = await kriService.create(req.user, body, req.requestId);
      res.status(201).json({ data: kri });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const body = UpdateKriBody.parse(req.body);
      const kri = await kriService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: kri });
    } catch (err) {
      next(err);
    }
  });

  // ACT-136: additional risks covered by this KRI, beyond the mandatory primary riskId.
  router.post("/:id/risks", async (req, res, next) => {
    try {
      const body = CoveredRisksBody.parse(req.body);
      const result = await kriService.addCoveredRisks(req.user, req.params["id"] as string, body.riskIds, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // ACT-132: soft-delete, gated behind kri.delete (never kri.update).
  router.patch("/:id/disable", async (req, res, next) => {
    try {
      const body = DisableKriBody.parse(req.body);
      await kriService.disable(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "DISABLED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
