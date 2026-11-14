import { Router } from "express";
import { z } from "zod";
import type { VisibilityReviewService } from "../../services/VisibilityReviewService.js";

/** Conservation L2c (q269 A): POST /visibility-reviews/:reasonId/confirm — the Risk Manager confirms a restriction's yearly review. */
export function visibilityReviewsRouter(service: VisibilityReviewService): Router {
  const router = Router();
  router.post("/:reasonId/confirm", async (req, res, next) => {
    try {
      const reasonId = z.guid().parse(req.params["reasonId"]);
      res.json({ data: await service.confirm(req.user, reasonId, req.requestId) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
