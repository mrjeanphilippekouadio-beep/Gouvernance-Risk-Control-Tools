import { describe, expect, it } from "vitest";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";

// Migration 061: only the "version no longer ACTIVE" refusal is a retryable race (409); any other 42501 stays a 500.
const input = { tenantId: "t", riskId: "r", evaluationType: "AD_HOC", evaluatorId: "u", subCategory: "x", evaluationMode: "STANDARD" } as never;
const failing = (err: unknown) => new PostgresRiskEvaluationRepository({ query: async () => { throw err; } } as never);

describe("PostgresRiskEvaluationRepository.create vs the 061 insert guard", () => {
  it("version archived mid-create: ConflictError", async () => {
    const err = Object.assign(new Error("risk_evaluations: the framework version must be ACTIVE and belong to the tenant"), { code: "42501" });
    await expect(failing(err).create(input)).rejects.toBeInstanceOf(ConflictError);
  });
  it("snapshot mismatch or genuine privilege error: rethrown as is", async () => {
    for (const msg of ["risk_evaluations: the snapshot does not match the framework version", "permission denied for table risk_evaluations"]) {
      const err = Object.assign(new Error(msg), { code: "42501" });
      await expect(failing(err).create(input)).rejects.toBe(err);
    }
  });
});
