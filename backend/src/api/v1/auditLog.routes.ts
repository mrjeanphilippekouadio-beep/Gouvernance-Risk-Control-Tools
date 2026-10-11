import { Router } from "express";
import { z } from "zod";
import type { AuditLogService } from "../../services/AuditLogService.js";
import type { AuditAction } from "../../domain/entities/AuditEvent.js";

// Bounded integer; out of range / non-numeric -> ZodError -> 400 (max matches AuditLogService MAX_LIMIT).
const LimitQuery = z.coerce.number().int().min(1).max(500).optional();

// Unparseable date -> ZodError -> 400 (empty string stays "absent", as before).
const DateQuery = z
  .string()
  .refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "Invalid date")
  .optional();

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
      const from = DateQuery.parse(asString(req.query["from"]));
      const to = DateQuery.parse(asString(req.query["to"]));
      const limit = LimitQuery.parse(req.query["limit"]);

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
