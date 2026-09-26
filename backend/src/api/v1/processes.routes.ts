import { Router } from "express";
import { z } from "zod";
import type { ProcessService } from "../../services/ProcessService.js";

const Level = z.enum(["PROCESS", "SUBPROCESS", "ACTIVITY"]);
const DocumentType = z.enum(["CHARTER", "POLICY", "PROCEDURES_MANUAL", "PROCEDURE", "WORK_INSTRUCTION"]);

const CreateProcessBody = z.object({
  parentId: z.string().nullish(),
  level: Level,
  name: z.string().min(1),
  description: z.string().nullish(),
  documentType: DocumentType.nullish(),
  documentReference: z.string().nullish(),
  owner: z.string().nullish(),
  active: z.boolean().optional(),
});

const UpdateProcessBody = CreateProcessBody.partial();
const ArchiveProcessBody = z.object({ reason: z.string().min(1) });

export function processesRouter(processService: ProcessService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const includeInactive = req.query["includeInactive"] === "true";
      const processes = await processService.list(req.user, includeInactive);
      res.json({ data: processes });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const process = await processService.get(req.user, req.params["id"] as string);
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateProcessBody.parse(req.body);
      const process = await processService.create(req.user, body, req.requestId);
      res.status(201).json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const body = UpdateProcessBody.parse(req.body);
      const process = await processService.update(req.user, req.params["id"] as string, body, req.requestId);
      res.json({ data: process });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/archive", async (req, res, next) => {
    try {
      const body = ArchiveProcessBody.parse(req.body);
      await processService.archive(req.user, req.params["id"] as string, body.reason, req.requestId);
      res.json({ data: { status: "ARCHIVED" } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
