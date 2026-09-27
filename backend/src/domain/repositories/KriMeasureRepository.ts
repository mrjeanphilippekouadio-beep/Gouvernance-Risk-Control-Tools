import type { CreateKriMeasureInput, KriMeasure } from "../entities/KriMeasure.js";

export interface KriMeasureListFilters {
  from?: Date;
  to?: Date;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface KriMeasureListResult {
  items: KriMeasure[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KriMeasureRepository {
  getById(tenantId: string, id: string): Promise<KriMeasure | null>;
  /** ACT-138: paginated history, most recent first (measureDate desc, then createdAt desc), optionally bounded by [from, to]. */
  listForKri(tenantId: string, kriId: string, filters?: KriMeasureListFilters): Promise<KriMeasureListResult>;
  /** The single most recent measure for a KRI — used by KriService to compute status (ACT-134). */
  getLatest(tenantId: string, kriId: string): Promise<KriMeasure | null>;
  /** The only mutation this repository ever exposes: append-only, no update/delete (ACT-133). */
  create(input: CreateKriMeasureInput): Promise<KriMeasure>;
}
