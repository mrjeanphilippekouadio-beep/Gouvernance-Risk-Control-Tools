import { describe, expect, it } from "vitest";
import { PostgresRiskEvaluationRepository } from "../src/infrastructure/database/postgres/PostgresRiskEvaluationRepository.js";
import { ConflictError } from "../src/domain/errors/DomainErrors.js";

// Migration 061: only the "version no longer ACTIVE" refusal is a retryable race (409); any other 42501 stays a 500.
const input = { tenantId: "t", riskId: "r", evaluationType: "AD_HOC", evaluatorId: "u", subCategory: "x", evaluationMode: "STANDARD" } as never;
const failing = (err: unknown) => new PostgresRiskEvaluationRepository({ query: async () => { throw err; } } as never);

describe("PostgresRiskEvaluationRepository.create vs the 061 insert guard", () => {
  it("version archived mid-create: ConflictError", async () => {
    const err = Object.assign(new Error("risk_evaluations: the framework version must be ACTIVE"), { code: "42501" });
    await expect(failing(err).create(input)).rejects.toBeInstanceOf(ConflictError);
  });
  it("snapshot mismatch or genuine privilege error: rethrown as is", async () => {
    for (const msg of ["risk_evaluations: the snapshot does not match the framework version", "risk_evaluations: the framework version does not belong to the tenant", "permission denied for table risk_evaluations"]) {
      const err = Object.assign(new Error(msg), { code: "42501" });
      await expect(failing(err).create(input)).rejects.toBe(err);
    }
  });
});

// F-REF-05: the Dispositif repository maps only its own 055 guards' 42501 to "frozen"; a genuine privilege error stays a 500.
describe("PostgresRiskFrameworkRepository mapPgError", () => {
  it("guard refusal: ValidationError; privilege error: rethrown as is", async () => {
    const { mapPgError } = await import("../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js");
    const { ValidationError } = await import("../src/domain/errors/DomainErrors.js");
    expect(mapPgError(Object.assign(new Error("risk_framework_versions: a pending version is frozen"), { code: "42501" }))).toBeInstanceOf(ValidationError);
    const boom = Object.assign(new Error("permission denied for table risk_framework_versions"), { code: "42501" });
    expect(mapPgError(boom)).toBe(boom);
  });
});

// A10 retest F-REF-04: the messages above must be the trigger's real ones, or the 409 mapping drifts silently.
describe("061 trigger messages match the ones mapped above", () => {
  it("both refusals exist verbatim in the migration", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../../database/postgresql/migrations/061_risk_evaluation_insert_guard.sql", import.meta.url), "utf8");
    expect(sql).toContain("'risk_evaluations: the framework version must be ACTIVE'");
    expect(sql).toContain("'risk_evaluations: the framework version does not belong to the tenant'");
  });
});
