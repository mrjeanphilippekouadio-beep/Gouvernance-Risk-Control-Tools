import { Router } from "express";
import type { AuditLogService } from "../../services/AuditLogService.js";
import type { AuditAction } from "../../domain/entities/AuditEvent.js";

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function auditLogRouter(auditLogService: AuditLogService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const entityType = req.query["entityType"];
      const entityId = req.query["entityId"];

      const userId = asString(req.query["userId"]);
      const action = asString(req.query["action"]);
      const from = asString(req.query["from"]);
      const to = asString(req.query["to"]);
      const limit = Number(req.query["limit"]) || undefined;

      // ACT-071 / ACT-230-231: any filter beyond a bare entity lookup or
      // a plain "recent" tail goes through the filtered search.
      if (userId || action || from || to || (entityType && !entityId)) {
        const events = await auditLogService.search(
          req.user,
          {
            userId,
            action: action as AuditAction | undefined,
            entityType: asString(entityType),
            entityId: asString(entityId),
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
          },
          limit,
        );
        res.json({ data: events });
        return;
      }

      if (typeof entityType === "string" && typeof entityId === "string") {
        const events = await auditLogService.listForEntity(req.user, entityType, entityId);
        res.json({ data: events });
        return;
      }

      const events = await auditLogService.listRecent(req.user, limit);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
