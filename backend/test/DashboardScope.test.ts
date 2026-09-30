import { describe, expect, it } from "vitest";
import { widestScopeMode } from "../src/domain/entities/DashboardScope.js";

// Pure, no I/O — @architect design 2026-09-30 ("Conception du scope
// configurable dashboard.executive via RACI").
describe("widestScopeMode", () => {
  it("GLOBAL wins over anything else", () => {
    expect(widestScopeMode(["DEPARTMENT", "GLOBAL"])).toBe("GLOBAL");
    expect(widestScopeMode(["PROCESS", "GLOBAL"])).toBe("GLOBAL");
    expect(widestScopeMode(["GLOBAL"])).toBe("GLOBAL");
  });

  it("DEPARTMENT wins over PROCESS when GLOBAL is absent", () => {
    expect(widestScopeMode(["PROCESS", "DEPARTMENT"])).toBe("DEPARTMENT");
    expect(widestScopeMode(["DEPARTMENT"])).toBe("DEPARTMENT");
  });

  it("PROCESS is the narrowest, and the default for an empty input", () => {
    expect(widestScopeMode(["PROCESS"])).toBe("PROCESS");
    expect(widestScopeMode([])).toBe("PROCESS");
  });

  it("order of the input array never matters", () => {
    expect(widestScopeMode(["PROCESS", "PROCESS", "DEPARTMENT", "PROCESS"])).toBe("DEPARTMENT");
    expect(widestScopeMode(["DEPARTMENT", "PROCESS", "GLOBAL", "DEPARTMENT"])).toBe("GLOBAL");
  });
});
