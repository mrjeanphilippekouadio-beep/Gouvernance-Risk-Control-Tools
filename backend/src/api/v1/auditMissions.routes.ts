import { Router } from "express";
import { z } from "zod";
import type { AuditMissionService } from "../../services/AuditMissionService.js";

const Status = z.enum(["PLANIFIEE", "EN_COURS", "CLOTUREE"]);

const CreateAuditMissionBody = z.object({
  reference: z.string().min(1),
  title: z.string().min(1),
  scope: z.string().min(1),
  leadAuditorId: z.string().min(1),
  auditorIds: z.array(z.string().min(1)).optional(),
  plannedStartDate: z.coerce.date(),
  plannedEndDate: z.coerce.date(),
});

const CloseAuditMissionBody = z.object({
  comment: z.string().min(1),
});

export function auditMissionsRouter(auditMissionService: AuditMissionService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const status = req.query["status"];
      const leadAuditorId = req.query["leadAuditorId"];
      const missions = await auditMissionService.list(req.user, {
        status: typeof status === "string" ? Status.parse(status) : undefined,
        leadAuditorId: typeof leadAuditorId === "string" ? leadAuditorId : undefined,
      });
      res.json({ data: missions });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const mission = await auditMissionService.get(req.user, req.params["id"] as string);
      res.json({ data: mission });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateAuditMissionBody.parse(req.body);
      const mission = await auditMissionService.create(req.user, body, req.requestId);
      res.status(201).json({ data: mission });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/start", async (req, res, next) => {
    try {
      const mission = await auditMissionService.start(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: mission });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/close", async (req, res, next) => {
    try {
      const body = CloseAuditMissionBody.parse(req.body);
      const mission = await auditMissionService.close(req.user, req.params["id"] as string, body.comment, req.requestId);
      res.json({ data: mission });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
