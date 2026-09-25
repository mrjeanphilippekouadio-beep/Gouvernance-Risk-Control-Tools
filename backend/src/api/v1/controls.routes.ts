import { Router } from "express";
import { z } from "zod";
import type { ControlService } from "../../services/ControlService.js";

const ControlType = z.enum(["PREVENTIVE", "DETECTIVE", "CORRECTIVE"]);
const ControlStatus = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]);

const CreateControlBody = z.object({
  label: z.string().min(1),
  objective: z.string().nullish(),
  coveredRiskIds: z.array(z.string()).min(1),
  process: z.string().nullish(),
  departmentId: z.string().nullish(),
  procedureDescription: z.string().nullish(),
  controlType: ControlType,
  nature: z.string().nullish(),
  defenseLine: z.string().nullish(),
  frequency: z.string().min(1),
  executor: z.string().min(1),
  validator: z.string().nullish(),
  expectedEvidence: z.string().nullish(),
  complianceCriteria: z.string().min(1),
});

const UpdateControlBody = CreateControlBody.partial().extend({
  status: ControlStatus.optional(),
});

const ArchiveControlBody = z.object({ reason: z.string().min(1) });

export function controlsRouter(controlService: ControlService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeArchived = req.query["includeArchived"] === "true";
      const riskId = req.query["coveringRiskId"];
      const controls =
        typeof riskId === "string"
          ? await controlService.listCoveringRisk(req.user, riskId)
          : await controlService.list(req.user, includeArchived);
      res.json({ data: controls });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const control = await controlService.get(req.user, req.params["id"] as string);
      res.json({ data: control });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateControlBody.parse(req.body);
      const control = await controlService.create(req.user, body, req.requestId);
      res.status(201).json({ data: control });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateControlBody.parse(req.body);
      const control = await controlService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: control });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveControlBody.parse(req.body);
      await controlService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
