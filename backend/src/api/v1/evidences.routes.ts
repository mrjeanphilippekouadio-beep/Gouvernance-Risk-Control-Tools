import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { EvidenceService } from "../../services/EvidenceService.js";
import { ValidationError } from "../../domain/errors/DomainErrors.js";
import { costlyOperationRateLimiter } from "../middleware/rateLimit.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const UploadMetadata = z.object({
  documentType: z.string().min(1),
  controlExecutionId: z.string().nullish(),
  // multipart fields arrive as strings
  allowDuplicate: z.enum(["true", "false"]).optional(),
});

/**
 * Thin HTTP layer — tenant scoping and the "never touch Drive without a
 * tenant-owned DB record first" rule live in EvidenceService, not here.
 */
export function evidencesRouter(evidenceService: EvidenceService): Router {
  const router = Router();

  router.post("/", costlyOperationRateLimiter(), upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError("Missing file field");
      const metadata = UploadMetadata.parse(req.body);

      const evidence = await evidenceService.upload(
        req.user,
        {
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          content: req.file.buffer,
          documentType: metadata.documentType,
          controlExecutionId: metadata.controlExecutionId ?? null,
          allowDuplicate: metadata.allowDuplicate === "true",
        },
        req.requestId,
      );
      res.status(201).json({ data: evidence });
    } catch (err) {
      next(err);
    }
  });

  router.get("/", async (req, res, next) => {
    try {
      const { controlExecutionId } = z.object({ controlExecutionId: z.string().min(1) }).parse(req.query);
      res.json({ data: await evidenceService.listForControlExecution(req.user, controlExecutionId) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id/url", async (req, res, next) => {
    try {
      const url = await evidenceService.getUrl(req.user, req.params["id"] as string, req.requestId);
      res.json({ data: { url } });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await evidenceService.delete(req.user, req.params["id"] as string, req.requestId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
