import { Router } from "express";
import { z } from "zod";
import { MAX_REVIEW_COMMENT_LENGTH, type GovernanceExceptionService } from "../../services/GovernanceExceptionService.js";
import { reasonText } from "../validation.js";
import { perUserRateLimiter } from "../middleware/rateLimit.js";

// reviewedBy is never accepted: the service takes the authenticated actor.
const ReviewBody = z.object({ outcome: z.enum(["REVIEWED", "CONTESTED"]), comment: reasonText(MAX_REVIEW_COMMENT_LENGTH) }).strict();
const IdParam = z.guid();

/** Lot D5: review / contest an action applied without a second validation (`:auditLogId` = the audit_log entry). */
export function governanceExceptionsRouter(service: GovernanceExceptionService): Router {
  const router = Router();

  router.post("/:auditLogId/reviews", perUserRateLimiter(), async (req, res, next) => {
    try {
      const auditLogId = IdParam.parse(req.params["auditLogId"]);
      const body = ReviewBody.parse(req.body);
      res.status(201).json({ data: await service.review(req.user, auditLogId, body, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
