import { Router } from "express";
import { z } from "zod";
import { boundedArray, reasonText } from "../validation.js";
import type { KriService } from "../../services/KriService.js";
import type { KriStatus } from "../../domain/entities/Kri.js";

const Frequency = z.enum(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL"]);
const Status = z.enum(["VERT", "ORANGE", "ROUGE", "NO_MEASURE"]);

// SEC INFO-04/06: ids are uuids and dates must parse (400 instead of a 500 / a silently ignored filter).
const Id = z.guid();
const OptionalDate = z.iso.date().or(z.iso.datetime()).optional().transform((v) => (v ? new Date(v) : undefined));

// Strict: an unknown key (notably `active`, F7S6-02 / QA-F7S6-02) is a 400, never silently dropped.
const CreateKriBody = z.strictObject({
  label: z.string().min(1),
  formula: z.string().min(1),
  thresholdGreen: z.number().finite(),
  thresholdOrange: z.number().finite(),
  thresholdRed: z.number().finite(),
  frequency: Frequency,
  riskId: Id,
  entity: z.string().nullish(),
  methodologyVersion: z.string().nullish(),
  description: z.string().nullish(),
});

// `active` is never accepted: deactivation is terminal and goes through PATCH /:id/disable (kri.delete).
const UpdateKriBody = CreateKriBody.omit({ riskId: true }).partial();

const CoveredRisksBody = z.object({ riskIds: boundedArray(Id, 1000) });

const DisableKriBody = z.object({ reason: reasonText(2000) });

export function krisRouter(kriService: KriService): Router {
  const router = Router();

  // ACT-137: dashboard listing — registered before "/:id" so "dashboard"
  // is never parsed as a KRI id (same trick roles.routes.ts uses for
  // "/matrix" and "/users/:userId").
  router.get("/dashboard", async (req, res, next) => {
    try {
      const departmentId = typeof req.query["departmentId"] === "string" ? Id.parse(req.query["departmentId"]) : undefined;
      const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : undefined;
      const statusRaw = typeof req.query["status"] === "string" ? req.query["status"] : undefined;
      const status = statusRaw ? (Status.parse(statusRaw) as KriStatus) : undefined;
      const periodFrom = OptionalDate.parse(typeof req.query["from"] === "string" ? req.query["from"] : undefined);
      const periodTo = OptionalDate.parse(typeof req.query["to"] === "string" ? req.query["to"] : undefined);

      const rows = await kriService.dashboard(req.user, { departmentId, entity, status, periodFrom, periodTo });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const riskId = typeof req.query["riskId"] === "string" ? Id.parse(req.query["riskId"]) : undefined;
      const entity = typeof req.query["entity"] === "string" ? req.query["entity"] : undefined;
      const kris = await kriService.list(req.user, { includeInactive, riskId, entity });
      res.json({ data: kris });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const kri = await kriService.get(req.user, Id.parse(req.params["id"]));
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
      const kri = await kriService.update(req.user, Id.parse(req.params["id"]), body, req.requestId);
      res.json({ data: kri });
    } catch (err) {
      next(err);
    }
  });

  // ACT-136: additional risks covered by this KRI, beyond the mandatory primary riskId.
  router.post("/:id/risks", async (req, res, next) => {
    try {
      const body = CoveredRisksBody.parse(req.body);
      const result = await kriService.addCoveredRisks(req.user, Id.parse(req.params["id"]), body.riskIds, req.requestId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  });

  // ACT-132: soft-delete, gated behind kri.delete (never kri.update).
  router.patch("/:id/disable", async (req, res, next) => {
    try {
      const body = DisableKriBody.parse(req.body);
      await kriService.disable(req.user, Id.parse(req.params["id"]), body.reason, req.requestId);
      res.json({ data: { status: "DISABLED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
