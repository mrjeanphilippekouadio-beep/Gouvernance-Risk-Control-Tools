import { Router } from "express";
import { z } from "zod";
import type { NotificationService } from "../../services/NotificationService.js";

const ResourceType = z.enum(["RISK", "KRI", "ACTION_PLAN", "CONTROL", "ANOMALY", "RISK_EVALUATION", "REVIEW_CYCLE"]);

const SubscribeBody = z.object({
  resourceType: ResourceType,
  eventType: z.string().min(1),
  enabled: z.boolean(),
});

/** ACT-200: mounted at /api/v1/notification-subscriptions by server.ts. Always scoped to the caller — no userId in the body/params. */
export function notificationSubscriptionsRouter(notificationService: NotificationService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const subscriptions = await notificationService.listSubscriptions(req.user);
      res.json({ data: subscriptions });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = SubscribeBody.parse(req.body);
      const subscription = await notificationService.subscribe(req.user, body, req.requestId);
      res.status(201).json({ data: subscription });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
