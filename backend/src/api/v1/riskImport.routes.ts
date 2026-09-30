import { Router } from "express";
import multer from "multer";
import type { RiskImportService } from "../../services/RiskImportService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";
import { costlyOperationRateLimiter } from "../middleware/rateLimit.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/** ACT-225 — POST /import/excel split into a dry-run preview and a separate confirmed commit, per the backlog's explicit requirement. */
export function riskImportRouter(riskImportService: RiskImportService): Router {
  const router = Router();
  const importRateLimiter = costlyOperationRateLimiter();

  router.post("/preview", importRateLimiter, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError("Missing file field");
      const report = await riskImportService.preview(req.user, req.file.buffer);
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  router.post("/commit", importRateLimiter, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError("Missing file field");
      const report = await riskImportService.commit(req.user, req.file.buffer, req.requestId);
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
