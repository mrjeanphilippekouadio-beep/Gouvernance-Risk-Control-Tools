import { describe, expect, it } from "vitest";
import { RiskCategoryService } from "../src/services/RiskCategoryService.js";
import type { RiskCategoryRepository } from "../src/domain/repositories/RiskCategoryRepository.js";
import type { AuditRepository } from "../src/domain/repositories/AuditRepository.js";
import type { RiskCategory } from "../src/domain/entities/RiskCategory.js";
import type { AuthenticatedUser } from "../src/infrastructure/identity/IdentityProvider.js";
import { ForbiddenError } from "../src/domain/errors/DomainErrors.js";

const mk = (id: string, active: boolean): RiskCategory => ({
  id, tenantId: "t1", name: id, parentId: null, active, createdAt: new Date(), updatedAt: new Date(),
});
const all = [mk("on", true), mk("off", false)];
const repo = {
  async list(_t: string, o?: { activeOnly?: boolean }) {
    return all.filter((c) => !o?.activeOnly || c.active);
  },
} as unknown as RiskCategoryRepository;
const service = new RiskCategoryService(repo, {} as AuditRepository);
const actor = (roles: string[]): AuthenticatedUser => ({
  userId: "u1", tenantId: "t1", email: "u@x.io", displayName: "U", roles,
});

describe("Q145 RiskCategoryService.list read access", () => {
  it("riskevaluation.create without config.read gets active categories only, even with includeInactive", async () => {
    const res = await service.list(actor(["riskevaluation.create"]), true);
    expect(res.map((c) => c.id)).toEqual(["on"]);
  });
  it("riskframework.read without config.read gets active categories only", async () => {
    const res = await service.list(actor(["riskframework.read"]), true);
    expect(res.map((c) => c.id)).toEqual(["on"]);
  });
  it("none of the three permissions is forbidden", async () => {
    await expect(service.list(actor(["riskappetite.read"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("config.read with includeInactive includes inactive categories", async () => {
    const res = await service.list(actor(["config.read"]), true);
    expect(res.map((c) => c.id)).toEqual(["on", "off"]);
  });
});
