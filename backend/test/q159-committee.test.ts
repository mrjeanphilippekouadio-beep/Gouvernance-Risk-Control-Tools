import { describe, expect, it } from "vitest";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { TreatmentDecisionService } from "../src/services/TreatmentDecisionService.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

const actor = (userId: string, roles: string[]): AuthenticatedUser =>
  ({ userId, tenantId: "t1", email: "a@b.c", displayName: "A", roles, dashboardScopeMode: "ALL" }) as never;
const gate = { check: async () => ({ governanceException: "x", newValueExtra: {} }) } as never; // would accept a self-validation

describe("q159: committee validations never accept self-validation, even with a DOUBLE_CONFIRMATION gate", () => {
  it("RiskEvaluation.validateByCommittee: evaluator = 403, someone else = validated", async () => {
    const mk = (maker: string) => {
      const row = { id: "r1", tenantId: "t1", status: "BROUILLON", residualScore: 20, evaluatorId: maker, committeeEvaluationMinScore: 15, committeeEvaluationEnforced: true };
      return new RiskEvaluationService(
        { getById: async () => row, recordCommitteeValidation: async () => ({ ...row, status: "VALIDEE_COMITE" }) } as never,
        { record: async () => undefined } as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, gate);
    };
    const roles = ["riskevaluation.read", "riskevaluation.validate.committee"];
    await expect(mk("me").validateByCommittee(actor("me", roles), "r1", null, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(mk("other").validateByCommittee(actor("me", roles), "r1", null, "r")).resolves.toMatchObject({ status: "VALIDEE_COMITE" });
  });

  it("TreatmentDecision.validateByCommittee: proposer = 403, someone else = validated", async () => {
    const mk = (maker: string) => {
      const row = { id: "d1", tenantId: "t1", status: "PROPOSEE", decidedBy: maker, validatorId: "u-sup", riskEvaluationId: "r1" };
      return new TreatmentDecisionService(
        { getById: async () => row, recordCommitteeValidation: async () => ({ ...row, status: "VALIDEE_COMITE" }) } as never,
        { getById: async () => ({ residualScore: 20, committeeTreatmentMinScore: 15, riskFrameworkVersionId: "v1" }) } as never,
        {} as never, { record: async () => undefined } as never, undefined, gate);
    };
    const roles = ["treatmentdecision.validate.committee"];
    await expect(mk("me").validateByCommittee(actor("me", roles), "d1", null, "r")).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(mk("other").validateByCommittee(actor("me", roles), "d1", null, "r")).resolves.toMatchObject({ status: "VALIDEE_COMITE" });
  });
});
