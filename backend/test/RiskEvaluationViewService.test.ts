import { describe, expect, it } from "vitest";
import { RiskEvaluationViewService } from "../src/services/RiskEvaluationViewService.js";
import type { RiskEvaluationRepository } from "../src/domain/repositories/RiskEvaluationRepository.js";
import type { RiskRepository } from "../src/domain/repositories/RiskRepository.js";
import type { ControlRepository } from "../src/domain/repositories/ControlRepository.js";
import type { ControlEffectivenessRepository } from "../src/domain/repositories/ControlEffectivenessRepository.js";
import type { RiskEvaluation } from "../src/domain/entities/RiskEvaluation.js";
import type { Risk } from "../src/domain/entities/Risk.js";
import type { Control } from "../src/domain/entities/Control.js";
import type { ControlEffectivenessAssessment } from "../src/domain/entities/ControlEffectivenessAssessment.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError, NotFoundError } from "../src/domain/errors/DomainErrors.js";

const TENANT = "tenant-1";

const actor: AuthenticatedUser = {
  userId: "user-evaluator",
  tenantId: TENANT,
  email: "evaluator@example.com",
  displayName: "Evaluator",
  roles: ["riskevaluation.read", "risk.read", "control.read"],
};

function evaluation(overrides: Partial<RiskEvaluation> = {}): RiskEvaluation {
  return {
    id: "eval-1",
    tenantId: TENANT,
    riskId: "risk-1",
    evaluationType: "ANNUELLE",
    status: "BROUILLON",
    evaluatorId: actor.userId,
    subCategory: "Fraude interne",
    entity: null,
    ratingScaleId: null,
    ratingScaleVersion: null,
    inherentProbability: null,
    inherentImpacts: null,
    inherentImpactRetained: null,
    inherentScore: null,
    masteryLines: null,
    masteryGlobal: null,
    residualProbability: null,
    residualImpacts: null,
    residualImpactRetained: null,
    residualScore: null,
    ...overrides,
  } as RiskEvaluation;
}

function risk(id = "risk-1"): Risk {
  return { id, tenantId: TENANT, process: "Paiements", description: "Risque test", status: "ACTIVE" } as Risk;
}

function control(id: string): Control {
  return { id, tenantId: TENANT, label: `Contrôle ${id}`, status: "ACTIVE", coveredRiskIds: ["risk-1"] } as Control;
}

function assessment(
  id: string,
  controlId: string,
  createdAt: Date,
  overrides: Partial<ControlEffectivenessAssessment> = {},
): ControlEffectivenessAssessment {
  return {
    id,
    tenantId: TENANT,
    controlId,
    createdAt,
    evalDate: createdAt,
    evaluatedBy: "user-assessor",
    operationalEffectiveness: "EFFECTIVE",
    justification: "Échantillon testé",
    status: "COMPLETED",
    validatedBy: null,
    validatedAt: null,
    ...overrides,
  } as ControlEffectivenessAssessment;
}

/**
 * Partial fakes: this service only ever reads, so stubbing the four read
 * methods it calls is enough — the unused write methods of each repository
 * interface would be pure boilerplate here.
 */
function buildService(data: {
  evaluations: RiskEvaluation[];
  risks: Risk[];
  controlsByRisk: Record<string, Control[]>;
  assessmentsByControl: Record<string, ControlEffectivenessAssessment[]>;
}): RiskEvaluationViewService {
  const scoped = <T extends { tenantId: string }>(rows: T[], tenantId: string) =>
    rows.filter((r) => r.tenantId === tenantId);

  const evaluations = {
    async getById(tenantId: string, id: string) {
      return scoped(data.evaluations, tenantId).find((e) => e.id === id) ?? null;
    },
  } as unknown as RiskEvaluationRepository;

  const risks = {
    async getById(tenantId: string, id: string) {
      return scoped(data.risks, tenantId).find((r) => r.id === id) ?? null;
    },
  } as unknown as RiskRepository;

  const controls = {
    async listCoveringRisk(tenantId: string, riskId: string) {
      return scoped(data.controlsByRisk[riskId] ?? [], tenantId);
    },
  } as unknown as ControlRepository;

  const effectiveness = {
    async listForControl(tenantId: string, controlId: string) {
      return scoped(data.assessmentsByControl[controlId] ?? [], tenantId);
    },
  } as unknown as ControlEffectivenessRepository;

  return new RiskEvaluationViewService(evaluations, risks, controls, effectiveness);
}

describe("RiskEvaluationViewService", () => {
  it("composes the covering controls with their latest effectiveness, null when never assessed", async () => {
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: { "risk-1": [control("control-1"), control("control-2"), control("control-3")] },
      assessmentsByControl: {
        "control-1": [
          assessment("a-old", "control-1", new Date("2026-01-10"), { operationalEffectiveness: "INEFFECTIVE" }),
          assessment("a-new", "control-1", new Date("2026-06-10"), { operationalEffectiveness: "EFFECTIVE" }),
        ],
        "control-2": [assessment("b-1", "control-2", new Date("2026-03-01"), { operationalEffectiveness: "PARTIALLY_EFFECTIVE" })],
        // control-3 has never been assessed.
      },
    });

    const context = await service.getEvaluationContext(actor, "eval-1");

    expect(context.evaluation.id).toBe("eval-1");
    expect(context.risk.id).toBe("risk-1");
    expect(context.coveringControls.map((c) => c.control.id)).toEqual(["control-1", "control-2", "control-3"]);
    expect(context.coveringControls[0]?.lastEffectiveness?.id).toBe("a-new");
    expect(context.coveringControls[0]?.lastEffectiveness?.operationalEffectiveness).toBe("EFFECTIVE");
    expect(context.coveringControls[1]?.lastEffectiveness?.id).toBe("b-1");
    expect(context.coveringControls[2]?.lastEffectiveness).toBeNull();
  });

  it("returns an empty control list for a risk with no control attached", async () => {
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: {},
      assessmentsByControl: {},
    });

    const context = await service.getEvaluationContext(actor, "eval-1");
    expect(context.coveringControls).toEqual([]);
  });

  /** DIV-07 regression lock: mastery stays a human judgement, never derived from control effectiveness. */
  it("never derives mastery from control effectiveness", async () => {
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: { "risk-1": [control("control-1")] },
      assessmentsByControl: {
        "control-1": [assessment("a-1", "control-1", new Date("2026-06-10"), { operationalEffectiveness: "INEFFECTIVE" })],
      },
    });

    const context = await service.getEvaluationContext(actor, "eval-1");

    expect(context.evaluation.masteryLines).toBeNull();
    expect(context.evaluation.masteryGlobal).toBeNull();
    expect(Object.keys(context)).toEqual(["evaluation", "risk", "coveringControls"]);
  });

  it("isolates tenants — an evaluation of another tenant is not found", async () => {
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: { "risk-1": [control("control-1")] },
      assessmentsByControl: {},
    });

    const foreign: AuthenticatedUser = { ...actor, tenantId: "tenant-2" };
    await expect(service.getEvaluationContext(foreign, "eval-1")).rejects.toThrow(NotFoundError);
  });

  it("does not leak controls or assessments belonging to another tenant", async () => {
    const otherTenantControl = { ...control("control-foreign"), tenantId: "tenant-2" };
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: { "risk-1": [control("control-1"), otherTenantControl] },
      assessmentsByControl: {
        "control-1": [
          { ...assessment("a-foreign", "control-1", new Date("2026-07-01")), tenantId: "tenant-2" },
          assessment("a-own", "control-1", new Date("2026-02-01")),
        ],
      },
    });

    const context = await service.getEvaluationContext(actor, "eval-1");

    expect(context.coveringControls.map((c) => c.control.id)).toEqual(["control-1"]);
    expect(context.coveringControls[0]?.lastEffectiveness?.id).toBe("a-own");
  });

  it("requires control.read, not just riskevaluation.read", async () => {
    const service = buildService({
      evaluations: [evaluation()],
      risks: [risk()],
      controlsByRisk: { "risk-1": [control("control-1")] },
      assessmentsByControl: {},
    });

    const limited: AuthenticatedUser = { ...actor, roles: ["riskevaluation.read", "risk.read"] };
    await expect(service.getEvaluationContext(limited, "eval-1")).rejects.toThrow(ForbiddenError);
  });
});
