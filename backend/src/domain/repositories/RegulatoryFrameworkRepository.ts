import type {
  CreateRegulatoryFrameworkInput,
  RegulatoryFramework,
  UpdateRegulatoryFrameworkInput,
} from "../entities/RegulatoryFramework.js";

export interface RegulatoryFrameworkRepository {
  getById(tenantId: string, id: string): Promise<RegulatoryFramework | null>;
  getByName(tenantId: string, name: string): Promise<RegulatoryFramework | null>;
  list(tenantId: string, options?: { activeOnly?: boolean }): Promise<RegulatoryFramework[]>;
  create(input: CreateRegulatoryFrameworkInput): Promise<RegulatoryFramework>;
  update(tenantId: string, id: string, input: UpdateRegulatoryFrameworkInput): Promise<RegulatoryFramework>;
}
