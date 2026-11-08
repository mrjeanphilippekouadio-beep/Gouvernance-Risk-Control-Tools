import { Router, type RequestHandler } from "express";
import { DEFAULT_RESOURCE_READALL_MAX_DAYS, GOVERNANCE_THRESHOLDS, MIN_LAST_SEEN_RETENTION_DAYS } from "../../domain/entities/Config.js";
import { z } from "zod";
import { ABSOLUTE_MAX_SCORE } from "../../domain/scoring.js";
import { reasonText } from "../validation.js";
import type { ConfigService } from "../../services/ConfigService.js";

const UpdateEvaluationModeBody = z.object({
  mode: z.enum(["CLASSIQUE", "PARTICIPATIF"]),
  reason: reasonText(2000),
});

const UpdateCommitteeThresholdsBody = z.object({
  evaluationMinScore: z.number().int().max(ABSOLUTE_MAX_SCORE).optional(),
  treatmentMinScore: z.number().int().max(ABSOLUTE_MAX_SCORE).nullable().optional(),
  reason: reasonText(2000),
});

const Days = z.number().int().min(1).max(3650).nullable().optional();
const GovernanceDelaysBody = z
  .object({ exceptionReviewDelayDays: Days, acceptanceMaxDays: Days, policyRequestExpiryDays: Days, riskManagerVacancyMaxDays: Days,
    // q221 (DECISION-111): a reading of every content lasts 90 days at most — adjustable downwards only (Privacy Q3).
    resourceReadallMaxDays: z.number().int().min(1).max(DEFAULT_RESOURCE_READALL_MAX_DAYS).nullable().optional(),
    // R3 (q227): retention of the « dernière activité » date after the end of an account.
    lastSeenRetentionDays: z.number().int().min(MIN_LAST_SEEN_RETENTION_DAYS).max(3650).nullable().optional(),
    // q233 A (DECISION-116): panel thresholds, never null, in the A13 ranges.
    govRmRiskShareMaxPct: z.number().int().min(GOVERNANCE_THRESHOLDS.govRmRiskShareMaxPct.min).max(GOVERNANCE_THRESHOLDS.govRmRiskShareMaxPct.max).optional(),
    govMaxAdmins: z.number().int().min(GOVERNANCE_THRESHOLDS.govMaxAdmins.min).max(GOVERNANCE_THRESHOLDS.govMaxAdmins.max).optional(),
    govRoleMaxPermissions: z.number().int().min(GOVERNANCE_THRESHOLDS.govRoleMaxPermissions.min).max(GOVERNANCE_THRESHOLDS.govRoleMaxPermissions.max).optional(),
    govRoleMaxFamilies: z.number().int().min(GOVERNANCE_THRESHOLDS.govRoleMaxFamilies.min).max(GOVERNANCE_THRESHOLDS.govRoleMaxFamilies.max).optional(),
    govDormantDays: z.number().int().min(GOVERNANCE_THRESHOLDS.govDormantDays.min).max(GOVERNANCE_THRESHOLDS.govDormantDays.max).optional(),
    govOwnerCreatorShareMaxPct: z.number().int().min(GOVERNANCE_THRESHOLDS.govOwnerCreatorShareMaxPct.min).max(GOVERNANCE_THRESHOLDS.govOwnerCreatorShareMaxPct.max).optional(),
    reason: reasonText(500) })
  .strict();

const UpdateCommitteeEnforcementBody = z.object({
  enforced: z.boolean(),
  reason: reasonText(2000),
});

const UpdateCommitteeAuditCumulBody = z.object({
  allowed: z.boolean(),
  reason: reasonText(500),
});

const UpdateSelfValidationPolicyBody = z.object({
  policy: z.enum(["REFUSE", "DOUBLE_CONFIRMATION"]),
  reason: reasonText(),
});

const IdParam = z.guid();
const RejectSelfValidationPolicyBody = z.object({ reason: reasonText() });
const ApproveSelfValidationPolicyBody = z.object({ reason: reasonText() });

/** PUT /config and PUT /config/appetite-mode answer 410 (DECISION-054); DIV-06 evaluation-mode and Lot A committee settings stay. */
export function configRouter(configService: ConfigService): Router {
  const router = Router();

  router.get("/", async (req, res, next) => {
    try {
      const config = await configService.get(req.user);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  // DECISION-054: these two settings are read by no code (scoring and appetite are driven by the Dispositif).
  // Accepting a write would let a client believe it changed something: answer clearly instead.
  const notApplied: RequestHandler = (_req, res) => {
    res.status(410).json({ error: "Réglage non appliqué : la formule de score, les seuils de niveau, la règle d'impact retenu et le mode d'appétence sont portés par le Dispositif (nouvelle version)." });
  };
  router.put("/", notApplied);
  router.put("/appetite-mode", notApplied);

  router.put("/evaluation-mode", async (req, res, next) => {
    try {
      const body = UpdateEvaluationModeBody.parse(req.body);
      const config = await configService.updateEvaluationMode(req.user, body.mode, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  // Lot A (RISK_MANAGEMENT_V1 §8): committee thresholds + enforcement toggle, two distinct endpoints/permissions — see ConfigService.
  router.put("/committee-thresholds", async (req, res, next) => {
    try {
      const body = UpdateCommitteeThresholdsBody.parse(req.body);
      const config = await configService.updateCommitteeThresholds(
        req.user,
        { evaluationMinScore: body.evaluationMinScore, treatmentMinScore: body.treatmentMinScore },
        body.reason,
        req.requestId,
      );
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/committee-enforcement", async (req, res, next) => {
    try {
      const body = UpdateCommitteeEnforcementBody.parse(req.body);
      const config = await configService.setCommitteeEnforcement(req.user, body.enforced, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/committee-audit-cumul", async (req, res, next) => {
    try {
      const body = UpdateCommitteeAuditCumulBody.parse(req.body);
      const config = await configService.setCommitteeAuditCumul(req.user, body.allowed, body.reason, req.requestId);
      res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.put("/governance-delays", async (req, res, next) => {
    try {
      const { reason, ...delays } = GovernanceDelaysBody.parse(req.body);
      const { config, pendingRequest } = await configService.setGovernanceDelays(req.user, delays, reason, req.requestId);
      // q182: 202 = the lengthening waits for a second person; `data` is the unchanged config.
      if (pendingRequest) res.status(202).json({ data: config, pendingRequest });
      else res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.get("/governance-delays/request", async (req, res, next) => {
    try {
      res.json({ data: await configService.getPendingGovernanceDelayRequest(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/governance-delays/requests/:id/approve", async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = ApproveSelfValidationPolicyBody.parse(req.body);
      res.json({ data: await configService.approveGovernanceDelays(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/governance-delays/requests/:id/reject", async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = RejectSelfValidationPolicyBody.parse(req.body);
      res.json({ data: await configService.rejectGovernanceDelays(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  router.put("/self-validation-policy", async (req, res, next) => {
    try {
      const body = UpdateSelfValidationPolicyBody.parse(req.body);
      const { config, pendingRequest } = await configService.setSelfValidationPolicy(req.user, body.policy, body.reason, req.requestId);
      // 202: the relaxation waits for a second person; `data` is the unchanged config.
      if (pendingRequest) res.status(202).json({ data: config, pendingRequest });
      else res.json({ data: config });
    } catch (err) {
      next(err);
    }
  });

  router.get("/self-validation-policy/request", async (req, res, next) => {
    try {
      res.json({ data: await configService.getPendingSelfValidationPolicyRequest(req.user) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/self-validation-policy/requests/:id/approve", async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = ApproveSelfValidationPolicyBody.parse(req.body);
      res.json({ data: await configService.approveSelfValidationPolicy(req.user, id, req.requestId, body.reason) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/self-validation-policy/requests/:id/reject", async (req, res, next) => {
    try {
      const id = IdParam.parse(req.params["id"]);
      const body = RejectSelfValidationPolicyBody.parse(req.body);
      res.json({ data: await configService.rejectSelfValidationPolicy(req.user, id, body.reason, req.requestId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
