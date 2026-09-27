import { Router } from "express";
import { z } from "zod";
import type { FeedbackService } from "../../services/FeedbackService.js";

const CreateFeedbackBody = z.object({
  category: z.enum(["BUG", "IDEA", "RECOMMENDATION", "OTHER"]),
  message: z.string().min(1),
  page: z.string().nullish(),
});

const UpdateStatusBody = z.object({
  status: z.enum(["NEW", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DECLINED"]),
});

export function feedbackRouter(feedbackService: FeedbackService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const status = req.query["status"];
      const feedback = await feedbackService.list(
        req.user,
        typeof status === "string" ? (status as never) : undefined,
      );
      res.json({ data: feedback });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateFeedbackBody.parse(req.body);
      const entry = await feedbackService.create(req.user, body, req.requestId);
      res.status(201).json({ data: entry });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateStatusBody.parse(req.body);
      const entry = await feedbackService.updateStatus(req.user, req.params["id"] as string, body.status, req.requestId);
      res.json({ data: entry });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
