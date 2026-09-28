import { Router } from "express";
import { z } from "zod";
import type { KriMeasureService } from "../../services/KriMeasureService.js";

const CreateKriMeasureBody = z.object({
  kriId: z.string().min(1),
  measureDate: z.coerce.date(),
  value: z.number().finite(),
  source: z.string().min(1),
  comment: z.string().nullish(),
});

export function kriMeasuresRouter(kriMeasureService: KriMeasureService): Router {
  const router = Router();

  // ACT-138: paginated history — ?kriId=...&from=...&to=...&page=...&pageSize=...
  router.get("/", async (req, res, next) => {
    try {
      const kriId = req.query["kriId"];
      if (typeof kriId !== "string") {
        res.status(400).json({ error: "kriId query param is required" });
        return;
      }
      const from = typeof req.query["from"] === "string" ? new Date(req.query["from"]) : undefined;
      const to = typeof req.query["to"] === "string" ? new Date(req.query["to"]) : undefined;
      const page = typeof req.query["page"] === "string" ? Number(req.query["page"]) : undefined;
      const pageSize = typeof req.query["pageSize"] === "string" ? Number(req.query["pageSize"]) : undefined;

      const result = await kriMeasureService.listForKri(req.user, kriId, { from, to, page, pageSize });
      res.json({ data: result.items, total: result.total, page: result.page, pageSize: result.pageSize });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateKriMeasureBody.parse(req.body);
      const measure = await kriMeasureService.record(req.user, body, req.requestId);
      res.status(201).json({ data: measure });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
