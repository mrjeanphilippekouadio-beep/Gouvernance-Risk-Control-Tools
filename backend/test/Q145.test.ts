import { describe, expect, it } from "vitest";
import { RiskEvaluationService } from "../src/services/RiskEvaluationService.js";
import { normalizeAppetite } from "../src/services/RiskFrameworkService.js";
import { findAppetite } from "../src/domain/frameworkAppetite.js";
import type { AppetiteThresholdEntry } from "../src/domain/entities/RiskFramework.js";
import type { RiskEvaluation, CreateRiskEvaluationInput } from "../src/domain/entities/RiskEvaluation.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";

// Level-1 tests of q145 (F-FW-02: evaluation sub-category by id; F-FW-03: threshold uniqueness on the id).

const cat = (id: string, tenantId: string, name: string, parentId: string | null, active = true) => ({ id, tenantId, name, parentId, active });
const cats = [
  cat("sub-a", "T1", "Fraude", "root-1"),
  cat("sub-b", "T1", "Fraude", "root-2"), // same name, other parent
  cat("off", "T1", "Inactive", "root-1", false),
  cat("top", "T1", "Racine", null),
  cat("foreign", "T2", "Autre", "r2"),
];
const categories = { async getById(t: string, id: string) { return cats.find((c) => c.id === id && c.tenantId === t) ?? null; } };

const actor: AuthenticatedUser = { userId: "u1", tenantId: "T1", email: "e@x", displayName: "E", roles: ["riskevaluation.create", "riskevaluation.read"] };

function build(withCategories = true) {
  const created: CreateRiskEvaluationInput[] = [];
  const evaluations = {
    async create(input: CreateRiskEvaluationInput) {
      created.push(input);
      return { id: "ev1", ...input, subCategoryId: input.subCategoryId ?? null } as unknown as RiskEvaluation;
    },
  };
  const audit = { async record() {} };
  const risks = { async getById(t: string, id: string) { return { id, tenantId: t, processId: null }; } };
  const svc = new RiskEvaluationService(
    evaluations as never, audit as never, risks as never, undefined, undefined, undefined, undefined, undefined,
    withCategories ? (categories as never) : undefined,
  );
  return { svc, created };
}
const body = (subCategoryId?: string, subCategory = "libellé forgé") =>
  ({ riskId: "r1", evaluationType: "AD_HOC" as const, subCategory, ...(subCategoryId ? { subCategoryId } : {}) });

describe("q145 RiskEvaluationService.create: sub-category by id", () => {
  it("stores the id and the category name, ignoring the client label", async () => {
    const { svc, created } = build();
    await svc.create(actor, body("sub-a"), "req");
    expect(created[0]).toMatchObject({ subCategory: "Fraude", subCategoryId: "sub-a" });
  });
  it.each([["missing", undefined], ["unknown", "zzz"], ["another tenant", "foreign"], ["inactive", "off"], ["top-level", "top"]])(
    "refuses %s",
    async (_n, id) => {
      const { svc, created } = build();
      await expect(svc.create(actor, body(id), "req")).rejects.toThrow();
      expect(created).toHaveLength(0);
    },
  );
  it("a subCategoryId without the category repository is refused (fail closed)", async () => {
    const { svc } = build(false);
    await expect(svc.create(actor, body("sub-a"), "req")).rejects.toThrow(/not configured/);
  });
});

describe("q145 findAppetite: match by id", () => {
  const entry = (subCategoryId: string | null, threshold: number): AppetiteThresholdEntry => ({ subCategory: "Fraude", subCategoryId, entity: null, threshold, description: null });
  const list = [entry("sub-a", 5), entry("sub-b", 9)];

  it("picks the threshold of the evaluation's category even when two categories share a name", () => {
    expect(findAppetite(list, "Fraude", null, "sub-a")?.threshold).toBe(5);
    expect(findAppetite(list, "Fraude", null, "sub-b")?.threshold).toBe(9);
  });
  it("a renamed category still finds its threshold (label no longer decides)", () => {
    expect(findAppetite(list, "Nouveau nom", null, "sub-b")?.threshold).toBe(9);
  });
  it("an id with no threshold gives null, never a label-based neighbour", () => {
    expect(findAppetite(list, "Fraude", null, "off")).toBeNull();
  });
  it("legacy evaluation (no id) keeps the label match", () => {
    expect(findAppetite([entry("sub-a", 5)], "Fraude", null, null)?.threshold).toBe(5);
    expect(findAppetite(list, "Autre libellé", null, null)).toBeNull();
  });
  it("an exact id match wins over a legacy label-only entry listed first", () => {
    const mixed = [entry(null, 3), entry("sub-a", 5)];
    expect(findAppetite(mixed, "Fraude", null, "sub-a")?.threshold).toBe(5);
    expect(findAppetite(mixed, "Fraude", null, "sub-z")?.threshold).toBe(3);
  });
});

describe("F-FW-03 normalizeAppetite: uniqueness on the id", () => {
  const e = (subCategoryId: string | null, entity: string | null = null): AppetiteThresholdEntry => ({ subCategory: "Fraude", subCategoryId, entity, threshold: 5, description: null });
  it("accepts two homonymous sub-categories with different ids", () => {
    expect(normalizeAppetite([e("sub-a"), e("sub-b")])).toHaveLength(2);
  });
  it("refuses the same id twice for the same entity, accepts it for another entity", () => {
    expect(() => normalizeAppetite([e("sub-a"), e("SUB-A")])).toThrow(/Duplicate/);
    expect(normalizeAppetite([e("sub-a"), e("sub-a", "Entité 2")])).toHaveLength(2);
  });
});
