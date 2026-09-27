import { Router } from "express";
import { z } from "zod";
import type { ControlExecutionService } from "../../services/ControlExecutionService.js";

const ExecutionStatus = z.enum(["DONE", "NOT_DONE", "NOT_APPLICABLE"]);

// SEC-001: executedBy is intentionally NOT accepted from the client —
// ControlExecutionService.create always stamps actor.userId. Accepting
// it here let one user attribute an execution to a colleague and then
// validate it themselves, defeating maker-checker.
const CreateExecutionBody = z.object({
  controlId: z.string().min(1),
  plannedDate: z.coerce.date().nullish(),
  completedDate: z.coerce.date().nullish(),
  result: z.string().nullish(),
  observedAnomalies: z.string().nullish(),
  justificationIfNotDone: z.string().nullish(),
  status: ExecutionStatus,
});

const ValidateExecutionBody = z.object({ comment: z.string().nullish() });

export function executionsRouter(executionService: ControlExecutionService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const controlId = req.query["controlId"];
      if (typeof controlId !== "string") {
        res.status(400).json({ error: "controlId query param is required" });
        return;
      }
      const executions = await executionService.listForControl(req.user, controlId);
      res.json({ data: executions });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:id", async (req, res, next) => {
    try {
      const execution = await executionService.get(req.user, req.params["id"] as string);
      res.json({ data: execution });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const body = CreateExecutionBody.parse(req.body);
      const execution = await executionService.create(req.user, body, req.requestId);
      res.status(201).json({ data: execution });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:id/validate", async (req, res, next) => {
    try {
      const body = ValidateExecutionBody.parse(req.body);
      const execution = await executionService.validate(
        req.user,
        req.params["id"] as string,
        body.comment ?? null,
        req.requestId,
      );
      res.json({ data: execution });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
