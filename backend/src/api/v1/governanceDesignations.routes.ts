import { Router } from "express";
import { z } from "zod";
import { reasonText } from "../validation.js";
import type { GovernanceDesignationService } from "../../services/GovernanceDesignationService.js";
import { DESIGNATION_KINDS, type DesignationKind } from "../../domain/entities/GovernanceDesignation.js";

// designatedBy is never accepted: the service forces it to the authenticated actor.
const DesignateBody = z.object({
  kind: z.enum(DESIGNATION_KINDS as [DesignationKind, ...DesignationKind[]]),
  userId: z.guid(),
  reason: reasonText(),
  validUntil: z.coerce.date().nullish(),
});
const EndBody = z.object({ reason: reasonText() });
const ListQuery = z.object({ includeEnded: z.enum(["true", "false"]).default("false") });
const IdParam = z.guid();

/** DECISION-074/075 (D2c): designated manager and Risk Manager interim. All routes need designation.manage (service). */
export function governanceDesignationsRouter(service: GovernanceDesignationService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const query = ListQuery.parse(req.query);
      res.json({ data: await service.list(req.user, query.includeEnded === "true") });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = DesignateBody.parse(req.body);
      const created = await service.designate(req.user, { ...body, validUntil: body.validUntil ?? null }, req.requestId);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/end", async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = EndBody.parse(req.body);
      res.json({ data: await service.end(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
