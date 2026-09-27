import { Router } from "express";
import { z } from "zod";
import type { GovernanceService } from "../../services/GovernanceService.js";

const CycleType = z.enum(["ANNUELLE", "ANTICIPEE"]);
const CycleStatus = z.enum(["OUVERT", "CLOTURE_PROPOSEE", "CLOTUREE"]);

const CreateReviewCycleBody = z.object({
  type: CycleType,
  title: z.string().min(1),
  scope: z.string().nullish(),
  reason: z.string().nullish(),
});

const CommentBody = z.object({ comment: z.string().nullish() });

/** ACT-250/251/252: mounted at /api/v1/review-cycles by server.ts. */
export function reviewCyclesRouter(governanceService: GovernanceService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const statusRaw = req.query["status"];
      const status = typeof statusRaw === "string" ? CycleStatus.parse(statusRaw) : undefined;
      const typeRaw = req.query["type"];
      const type = typeof typeRaw === "string" ? CycleType.parse(typeRaw) : undefined;
      const cycles = await governanceService.list(req.user, { status, type });
      res.json({ data: cycles });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const cycle = await governanceService.get(req.user, req.params["id"] as string);
      res.json({ data: cycle });
    } catch (err) {
      next(err);
    }
  });

  // ACT-250 (type=ANNUELLE) / ACT-251 (type=ANTICIPEE, reason mandatory) — same endpoint.
  router.post("/", async (req, res, next) => {
    try {
      const body = CreateReviewCycleBody.parse(req.body);
      const cycle = await governanceService.create(req.user, body, req.requestId);
      res.status(201).json({ data: cycle });
    } catch (err) {
      next(err);
    }
  });

  // ACT-252 step 1 (maker): Risk Manager proposes closure.
  router.patch("/:id/propose-closure", async (req, res, next) => {
    try {
      const body = CommentBody.parse(req.body);
      const cycle = await governanceService.proposeClosure(req.user, req.params["id"] as string, body.comment ?? null, req.requestId);
      res.json({ data: cycle });
    } catch (err) {
      next(err);
    }
  });

  // ACT-252 step 2 (checker): Direction validates and closes. Terminal.
  router.patch("/:id/close", async (req, res, next) => {
    try {
      const body = CommentBody.parse(req.body);
      const cycle = await governanceService.close(req.user, req.params["id"] as string, body.comment ?? null, req.requestId);
      res.json({ data: cycle });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
