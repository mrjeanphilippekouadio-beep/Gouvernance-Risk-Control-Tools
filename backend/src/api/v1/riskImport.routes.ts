import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { reasonText } from "../validation.js";
import type { RiskImportService } from "../../services/RiskImportService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";
import { costlyOperationRateLimiter } from "../middleware/rateLimit.js";

/** Workbook size cap (2 000 rows fit far below it); one value for preview and commit. */
const MAX_IMPORT_BYTES = 8_000_000; // 8 Mo (décimal), seuil Sonar S5693

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 0, parts: 1 }, // the only part is the xlsx file
});
// q263: the commit also takes the re-import confirmation (two short text fields) next to the file.
const commitUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 2, parts: 3, fieldSize: 2048 },
});
const CommitFields = z.strictObject({
  confirmReimport: z.literal("true").optional(),
  reason: reasonText(500).optional(),
});

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

  router.post("/commit", importRateLimiter, commitUpload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError("Missing file field");
      const fields = CommitFields.parse({ ...req.body });
      const report = await riskImportService.commit(req.user, req.file.buffer, req.requestId, {
        confirmReimport: fields.confirmReimport === "true",
        reason: fields.reason,
      });
      res.json({ data: report });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
