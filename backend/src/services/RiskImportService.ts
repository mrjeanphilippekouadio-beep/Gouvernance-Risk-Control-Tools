import ExcelJS from "exceljs";
import { z } from "zod";
import type { RiskService } from "./RiskService.js";
import { requirePermission } from "../domain/permissions.js";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuthenticatedUser } from "../infrastructure/identity/IdentityProvider.js";

// Mirrors apps-script-legacy/02_Colonnes.gs's HEADERS_RISQUES alias lists
// for PROCESSUS/DESCRIPTION, so a real "Suivi_Risques" export can be
// imported without renaming columns first.
const PROCESS_ALIASES = ["processus", "process"];
const DESCRIPTION_ALIASES = ["description", "description scenario", "scenario", "description du risque"];

/** Defensive cap on untrusted file input — not a business rule, just bounds memory/time for a single request. */
const MAX_IMPORT_ROWS = 2000;

const RiskImportRowSchema = z.object({
  process: z.string().trim().min(1, "process is required"),
  description: z.string().trim().min(1, "description is required"),
});

export interface RiskImportRowOutcome {
  /** 1-based, matches the Excel row number (row 1 is the header). */
  row: number;
  process?: string;
  description?: string;
  errors: string[];
}

export interface RiskImportReport {
  totalRows: number;
  validCount: number;
  invalidCount: number;
  rows: RiskImportRowOutcome[];
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function parseRows(buffer: Buffer): Promise<{ row: number; process: string; description: string }[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled .d.ts pins to a Buffer<ArrayBuffer> generic
  // instantiation that structurally conflicts with @types/node 22's
  // Buffer<ArrayBufferLike> default (a known exceljs/@types/node
  // incompatibility, not a real type-safety issue) — `any` at this one
  // call site is required because even `unknown as Buffer` still hits
  // the same structural mismatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ValidationError("The Excel file has no worksheet");

  let processCol = -1;
  let descriptionCol = -1;
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const header = normalizeHeader(cell.value);
    if (PROCESS_ALIASES.includes(header)) processCol = colNumber;
    if (DESCRIPTION_ALIASES.includes(header)) descriptionCol = colNumber;
  });
  if (processCol === -1 || descriptionCol === -1) {
    throw new ValidationError(
      `Could not find required columns in the header row — expected one of [${PROCESS_ALIASES.join(", ")}] and one of [${DESCRIPTION_ALIASES.join(", ")}]`,
    );
  }

  const lastRow = sheet.actualRowCount;
  if (lastRow - 1 > MAX_IMPORT_ROWS) {
    throw new ValidationError(`Too many rows (${lastRow - 1}) — max ${MAX_IMPORT_ROWS} rows per import`);
  }

  const rows: { row: number; process: string; description: string }[] = [];
  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const process = String(row.getCell(processCol).value ?? "").trim();
    const description = String(row.getCell(descriptionCol).value ?? "").trim();
    if (!process && !description) continue;
    rows.push({ row: r, process, description });
  }
  return rows;
}

/**
 * ACT-225 — Excel import, scoped to Risk records only (the legacy
 * "Suivi_Risques" migration target). Storage/business rules for Risk
 * itself are NOT duplicated here: `commit` calls the already-shipped
 * `RiskService.create` per valid row, which enforces `risk.create` and
 * records its own audited CREATE event — this service only handles
 * parsing, validation, and the dry-run/commit split.
 */
export class RiskImportService {
  constructor(private readonly riskService: RiskService) {}

  private async parseAndValidate(buffer: Buffer): Promise<RiskImportReport> {
    const rawRows = await parseRows(buffer);
    const rows: RiskImportRowOutcome[] = rawRows.map((r) => {
      const parsed = RiskImportRowSchema.safeParse({ process: r.process, description: r.description });
      if (!parsed.success) {
        return { row: r.row, errors: parsed.error.issues.map((issue) => issue.message) };
      }
      return { row: r.row, process: parsed.data.process, description: parsed.data.description, errors: [] };
    });
    const validCount = rows.filter((r) => r.errors.length === 0).length;
    return { totalRows: rows.length, validCount, invalidCount: rows.length - validCount, rows };
  }

  /** POST /import/excel/preview — dry-run: parses and validates, writes nothing. */
  async preview(actor: AuthenticatedUser, buffer: Buffer): Promise<RiskImportReport> {
    requirePermission(actor, "config.manage");
    return this.parseAndValidate(buffer);
  }

  /**
   * POST /import/excel/commit — re-parses and re-validates the same file
   * from scratch (never trusts a client-supplied "row N was fine" claim
   * from an earlier preview call), then creates one Risk per valid row.
   */
  async commit(
    actor: AuthenticatedUser,
    buffer: Buffer,
    requestId: string,
  ): Promise<RiskImportReport & { createdCount: number }> {
    requirePermission(actor, "config.manage");
    const report = await this.parseAndValidate(buffer);

    let createdCount = 0;
    for (const outcome of report.rows) {
      if (outcome.errors.length > 0 || !outcome.process || !outcome.description) continue;
      try {
        await this.riskService.create(actor, { process: outcome.process, description: outcome.description }, requestId);
        createdCount++;
      } catch (err) {
        outcome.errors.push(err instanceof Error ? err.message : "Unknown error creating this risk");
      }
    }

    return { ...report, createdCount };
  }
}
