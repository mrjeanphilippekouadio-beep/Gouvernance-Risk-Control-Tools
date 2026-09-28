import { Router } from "express";
import { z } from "zod";
import type { RegulatoryFrameworkService } from "../../services/RegulatoryFrameworkService.js";

const CreateBody = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateBody = CreateBody.partial();

/** ACT-223 — regulatory framework registry (BCEAO, ISO 31000, COSO ERM, DORA...), CRUD + active/inactive only. */
export function regulatoryFrameworksRouter(frameworkService: RegulatoryFrameworkService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const frameworks = await frameworkService.list(req.user, includeInactive);
      res.json({ data: frameworks });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const framework = await frameworkService.get(req.user, req.params["id"] as string);
      res.json({ data: framework });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateBody.parse(req.body);
      const framework = await frameworkService.create(req.user, body, req.requestId);
      res.status(201).json({ data: framework });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const body = UpdateBody.parse(req.body);
      const framework = await frameworkService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: framework });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
