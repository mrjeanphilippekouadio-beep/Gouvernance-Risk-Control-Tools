import { Router } from "express";
import { z } from "zod";
import { MAX_HEADCOUNT, MAX_RISK_PEOPLE } from "../../domain/governance/organizationQuestionnaire.js";
import { MAX_REASON_LENGTH, type OrganizationProfileService } from "../../services/OrganizationProfileService.js";
import { reasonText } from "../validation.js";
import { perUserRateLimiter } from "../middleware/rateLimit.js";

const YesNoUnknown = z.enum(["NO", "YES", "UNKNOWN"]);

/**
 * The author is never read from the body: the service takes `actor.userId`. The service validates the answers again
 * against the questionnaire version (parseOrganizationAnswers); this schema bounds the shape at the HTTP edge.
 */
const SubmitBody = z
  .object({
    questionnaireVersion: z.string().min(1).max(40),
    answers: z
      .object({
        Q1: z.number().int().min(1).max(MAX_HEADCOUNT),
        Q2: z.number().int().min(0).max(MAX_RISK_PEOPLE),
        Q5: YesNoUnknown,
        Q7: YesNoUnknown,
        Q8: z.enum(["NO", "INFORMAL", "FORMAL", "UNKNOWN"]),
        Q11: YesNoUnknown,
      })
      .strict(),
    reason: reasonText(MAX_REASON_LENGTH),
  })
  .strict();
const RejectBody = z.object({ reason: reasonText(MAX_REASON_LENGTH) }).strict();
const IdParam = z.guid();

/**
 * Organization profile (lot D3). GET returns the questionnaire, the versions, what the tool observes and the size
 * computed by the server (classification, calculation detail, gaps): the client displays it, never recomputes it.
 */
export function organizationProfileRouter(service: OrganizationProfileService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      res.json({ data: await service.get(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/submit", perUserRateLimiter(), async (req, res, next) => {
    try {
      const body = SubmitBody.parse(req.body);
      const profile = await service.submit(req.user, body, req.requestId);
      res.status(201).json({ data: profile });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/approve", perUserRateLimiter(), async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      res.json({ data: await service.approve(req.user, id, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/reject", perUserRateLimiter(), async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = RejectBody.parse(req.body);
      res.json({ data: await service.reject(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
