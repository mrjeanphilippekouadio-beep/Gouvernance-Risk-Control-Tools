import { Router } from "express";
import { z } from "zod";
import { REVIEWABLE_TYPES } from "../../domain/repositories/VisibilityReviewRepository.js";
import type { VisibilityReviewService } from "../../services/VisibilityReviewService.js";

const Params = z.object({ resourceType: z.enum(REVIEWABLE_TYPES), resourceId: z.guid() });

/** Conservation L2c (q269 A): POST /visibility-reviews/:resourceType/:resourceId/confirm — the Risk Manager confirms a restriction's yearly review. */
export function visibilityReviewsRouter(service: VisibilityReviewService): Router {
  const router = Router();
  router.post("/:resourceType/:resourceId/confirm", async (req, res, next) => {
    try {
      const { resourceType, resourceId } = Params.parse(req.params);
      res.json({ data: await service.confirm(req.user, resourceType, resourceId, req.requestId) });
    } catch (err) {
      next(err);
    }
  });
  return router;
}
