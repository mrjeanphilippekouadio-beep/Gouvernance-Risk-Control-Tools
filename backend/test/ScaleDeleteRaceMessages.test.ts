import { describe, expect, it } from "vitest";
import { mapPgError } from "../src/infrastructure/database/postgres/PostgresRiskFrameworkRepository.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

// Migration 063 refusals reach the user as a clear message, not a 500 (PO, 2026-10-18).
describe("migration 063 refusals → clear messages", () => {
  it("a draft written on a scale disabled meanwhile becomes a ValidationError", () => {
    const mapped = mapPgError({ code: "23514", message: "risk_framework_versions: rating scale abc does not exist or was disabled" });
    expect(mapped).toBeInstanceOf(ValidationError);
    expect((mapped as Error).message).toMatch(/vient d'être désactivée/);
  });

  it("an unrelated check violation is left untouched", () => {
    const err = { code: "23514", message: "some_other_check" };
    expect(mapPgError(err)).toBe(err);
  });
});
