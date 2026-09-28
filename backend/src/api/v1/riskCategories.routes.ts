import { Router } from "express";
import { z } from "zod";
import type { RiskCategoryService } from "../../services/RiskCategoryService.js";

const CreateBody = z.object({
  name: z.string().min(1),
  parentId: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateBody = CreateBody.partial();

/** ACT-224 — risk category/sub-category taxonomy. */
export function riskCategoriesRouter(riskCategoryService: RiskCategoryService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const categories = await riskCategoryService.list(req.user, includeInactive);
      res.json({ data: categories });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const category = await riskCategoryService.get(req.user, req.params["id"] as string);
      res.json({ data: category });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateBody.parse(req.body);
      const category = await riskCategoryService.create(req.user, body, req.requestId);
      res.status(201).json({ data: category });
    } catch (err) {
      next(err);
    }
  });

  router.put("/:id", async (req, res, next) => {
    try {
      const body = UpdateBody.parse(req.body);
      const category = await riskCategoryService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: category });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
