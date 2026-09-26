import { Router } from "express";
import type { AuditLogService } from "../../services/AuditLogService.js";

export function auditLogRouter(auditLogService: AuditLogService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const entityType = req.query["entityType"];
      const entityId = req.query["entityId"];

      if (typeof entityType === "string" && typeof entityId === "string") {
        const events = await auditLogService.listForEntity(req.user, entityType, entityId);
        res.json({ data: events });
        return;
      }

      const limit = Number(req.query["limit"]) || undefined;
      const events = await auditLogService.listRecent(req.user, limit);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
