import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { RiskService } from "./RiskService.js";
import { requirePermission } from "../domain/permissions.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../domain/errors/DomainErrors.js";
import type { AuditRepository } from "../domain/repositories/AuditRepository.js";
import { isAcceptableReason } from "../domain/governance/selfValidation.js";
import { assertSafeXlsxArchive } from "../infrastructure/zipArchiveGuard.js";
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
  /** q263: this exact file (SHA-256 of its content) was already imported by this tenant. */
  alreadyImported?: boolean;
}

export interface RiskImportCommitOptions {
  /** q263: explicit confirmation to import a file already imported; requires `reason`. */
  confirmReimport?: boolean;
  reason?: string;
}

const MAX_REASON = 500;
const IMPORT_ENTITY = "RiskImport";

/** Messages of these domain errors are written for the caller; anything else is internal and never echoed (SEC-F8-06). */
function safeRowMessage(err: unknown): string {
  if (err instanceof ValidationError || err instanceof NotFoundError || err instanceof ConflictError || err instanceof ForbiddenError) {
    return err.message;
  }
  console.error("Risk import: unexpected error creating a row", err instanceof Error ? err.name : "unknown");
  return "Erreur interne lors de la création de ce risque.";
}

/** q263: SHA-256 of the file content, and a deterministic UUID made of its first 128 bits (the audit `entity_id` of this file). */
function fingerprint(buffer: Buffer): { sha256: string; entityId: string } {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const h = sha256.slice(0, 32);
  return { sha256, entityId: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}` };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function parseRows(buffer: Buffer): Promise<{ row: number; process: string; description: string }[]> {
  assertSafeXlsxArchive(buffer);
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
  /**
   * `audit` carries the per-tenant import fingerprints (q263): an append-only `RiskImport` audit event per commit, keyed by the
   * file hash (no table, no migration). Optional for existing callers/tests: without it the "already imported" check is off.
   */
  constructor(
    private readonly riskService: RiskService,
    private readonly audit?: AuditRepository,
  ) {}

  private async previousImport(tenantId: string, entityId: string): Promise<Date | null> {
    if (!this.audit) return null;
    const events = await this.audit.listForEntity(tenantId, IMPORT_ENTITY, entityId);
    return events[0]?.timestamp ?? null;
  }

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
    const report = await this.parseAndValidate(buffer);
    const already = await this.previousImport(actor.tenantId, fingerprint(buffer).entityId);
    return already ? { ...report, alreadyImported: true } : report;
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
    options: RiskImportCommitOptions = {},
  ): Promise<RiskImportReport & { createdCount: number }> {
    requirePermission(actor, "config.manage");
    const report = await this.parseAndValidate(buffer);

    // q263: refuse a file already imported by this tenant unless explicitly confirmed with a reason (traced below).
    const { sha256, entityId } = fingerprint(buffer);
    const previous = await this.previousImport(actor.tenantId, entityId);
    let reimportReason: string | null = null;
    if (previous) {
      if (options.confirmReimport !== true) {
        throw new ConflictError(
          `Ce fichier a déjà été importé le ${previous.toISOString().slice(0, 10)}. Confirmez avec un motif pour l'importer de nouveau.`,
          undefined,
          "ALREADY_IMPORTED",
        );
      }
      const reason = (options.reason ?? "").trim();
      if (!reason || reason.length > MAX_REASON || !isAcceptableReason(reason)) {
        throw new ValidationError("A valid reason (1 to 500 characters) is required to import an already imported file");
      }
      reimportReason = reason;
    }
    // Written BEFORE the creations (fail closed: no trace, no import) so that a partial or replayed import is still detected.
    await this.audit?.record({
      tenantId: actor.tenantId,
      userId: actor.userId,
      entityType: IMPORT_ENTITY,
      entityId,
      action: "CREATE",
      oldValue: null,
      newValue: { sha256, totalRows: report.totalRows, validCount: report.validCount, reimport: previous !== null },
      reason: reimportReason,
      requestId,
    });

    let createdCount = 0;
    for (const outcome of report.rows) {
      if (outcome.errors.length > 0 || !outcome.process || !outcome.description) continue;
      try {
        await this.riskService.create(actor, { process: outcome.process, description: outcome.description }, requestId);
        createdCount++;
      } catch (err) {
        outcome.errors.push(safeRowMessage(err));
      }
    }

    return { ...report, createdCount, ...(previous ? { alreadyImported: true } : {}) };
  }
}
