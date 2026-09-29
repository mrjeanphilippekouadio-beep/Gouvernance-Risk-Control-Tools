import { Router } from "express";
import { z } from "zod";
import type { NotificationService } from "../../services/NotificationService.js";
import { NOTIFICATION_RESOURCE_TYPES, type NotificationResourceType } from "../../domain/entities/Notification.js";

const ResourceType = z.enum(NOTIFICATION_RESOURCE_TYPES);

/** ACT-202: mounted at /api/v1/notifications by server.ts. */
export function notificationsRouter(notificationService: NotificationService): Router {
  const router = Router();

  // GET /notifications?user_id=me&resourceType=&eventType=&read=&limit=&offset=
  router.get("/", async (req, res, next) => {
    try {
      const userId = typeof req.query["user_id"] === "string" ? req.query["user_id"] : "me";
      const resourceTypeRaw = req.query["resourceType"];
      const resourceType = typeof resourceTypeRaw === "string" ? (ResourceType.parse(resourceTypeRaw) as NotificationResourceType) : undefined;
      const eventType = typeof req.query["eventType"] === "string" ? req.query["eventType"] : undefined;
      const readRaw = req.query["read"];
      const read = readRaw === "true" ? true : readRaw === "false" ? false : undefined;
      const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
      const offset = req.query["offset"] ? Number(req.query["offset"]) : undefined;

      const result = await notificationService.listForRecipient(req.user, userId, { resourceType, eventType, read, limit, offset });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id/read", async (req, res, next) => {
    try {
      const notification = await notificationService.markAsRead(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: notification });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
