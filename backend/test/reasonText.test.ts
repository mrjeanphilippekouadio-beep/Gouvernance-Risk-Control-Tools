import { describe, expect, it } from "vitest";
import { GovernanceConfirmationBody, reasonText } from "../src/api/validation.js";
import { selfValidationOutcome } from "../src/domain/governance/selfValidation.js";

// SEC-PNL-01 / CMP-PNL-01 / F-PNL-11: one reason rule for every governance reason.
describe("reasonText", () => {
  const schema = reasonText();
  it("accepts and trims a normal reason", () => {
    expect(schema.parse("  seul administrateur  ")).toBe("seul administrateur");
    expect(schema.parse("été – décision n°1")).toBe("été – décision n°1");
  });
  it.each([["NUL", "seul\u0000"], ["control char", "a\u0001b"], ["newline", "a\nb"], ["DEL", "a\u007fb"]])("refuses a %s", (_n, v) => {
    expect(schema.safeParse(v).success).toBe(false);
  });
  it.each([["blank", "   "], ["zero-width space", "​"], ["zero-width + spaces", " ​⁠ "]])("refuses %s (no visible character)", (_n, v) => {
    expect(schema.safeParse(v).success).toBe(false);
  });
  it("keeps the length bound", () => {
    expect(schema.safeParse("x".repeat(501)).success).toBe(false);
    expect(reasonText(10).safeParse("x".repeat(11)).success).toBe(false);
  });
  it("is the rule of governanceConfirmation.reason", () => {
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "seul\u0000" }).success).toBe(false);
    expect(GovernanceConfirmationBody.safeParse({ rule: "noSelfValidation", reason: "motif" }).success).toBe(true);
  });
  it("service level: an unacceptable confirmation reason never counts as a confirmation", () => {
    const c = (reason: string) => selfValidationOutcome("DOUBLE_CONFIRMATION", true, false, { rule: "noSelfValidation", reason });
    expect(c("seul\u0000")).toBe("CONFIRMATION_REQUIRED");
    expect(c("​")).toBe("CONFIRMATION_REQUIRED");
    expect(c("motif")).toBe("ALLOW");
  });
});
