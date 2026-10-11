import ExcelJS from "exceljs";
import { ValidationError } from "../domain/errors/DomainErrors.js";
import { assertSafeXlsxArchive } from "../infrastructure/zipArchiveGuard.js";

/** Technical caps (EVD cadrage, decision 2): constants, not settings. */
export const MAX_ANALYSIS_BYTES = 5 * 1024 * 1024;
export const MAX_ANALYSIS_ROWS = 20_000;
export const MAX_ANALYSIS_COLUMNS = 50;
const MAX_SHEETS = 50;
const HEADER_SCAN_ROWS = 20;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_LENGTH = 100;

export type InferredType = "text" | "number" | "date" | "boolean" | "mixed" | "empty";

export interface ColumnAnalysis {
  /** 1-based column index in the sheet. */
  index: number;
  name: string;
  inferredType: InferredType;
  /** Up to 3 distinct non-empty values, stringified and truncated. Empty when examples are withheld. */
  examples: string[];
  isEmpty: boolean;
}

export interface SheetAnalysis {
  name: string;
  /** 1-based row number of the header; null when the sheet has no content. */
  headerRow: number | null;
  /** false when no row looked like a header and the first non-empty row was used. */
  headerDetected: boolean;
  /** Non-empty data rows below the header. */
  rowCount: number;
  columns: ColumnAnalysis[];
}

type Scalar = string | number | boolean | Date;

/** Reduce an exceljs cell value to a scalar; formulas yield their cached result, never evaluated. */
function toScalar(value: ExcelJS.CellValue): Scalar | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  if (typeof value === "object") {
    if ("error" in value) return null;
    if ("result" in value) return toScalar(value.result as ExcelJS.CellValue);
    if ("formula" in value || "sharedFormula" in value) return null;
    if ("richText" in value) return toScalar(value.richText.map((r) => r.text).join(""));
    if ("text" in value) return toScalar(String(value.text));
  }
  return null;
}

function scalarType(v: Scalar): Exclude<InferredType, "mixed" | "empty"> {
  if (v instanceof Date) return "date";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  return "text";
}

function display(v: Scalar): string {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return s.length > MAX_EXAMPLE_LENGTH ? `${s.slice(0, MAX_EXAMPLE_LENGTH)}…` : s;
}

function analyzeSheet(sheet: ExcelJS.Worksheet, withExamples: boolean): SheetAnalysis {
  if (sheet.rowCount > MAX_ANALYSIS_ROWS) {
    throw new ValidationError(`Sheet "${sheet.name}" has too many rows (max ${MAX_ANALYSIS_ROWS})`);
  }
  if (sheet.columnCount > MAX_ANALYSIS_COLUMNS) {
    throw new ValidationError(`Sheet "${sheet.name}" has too many columns (max ${MAX_ANALYSIS_COLUMNS})`);
  }
  const nCols = sheet.columnCount;
  const nRows = sheet.rowCount;
  const grid: (Scalar | null)[][] = [];
  for (let r = 1; r <= nRows; r++) {
    const row = sheet.getRow(r);
    const cells: (Scalar | null)[] = [];
    for (let c = 1; c <= nCols; c++) cells.push(toScalar(row.getCell(c).value));
    grid.push(cells);
  }
  const filled = (cells: (Scalar | null)[]) => cells.filter((v) => v !== null).length;

  const firstNonEmpty = grid.findIndex((cells) => filled(cells) > 0);
  if (firstNonEmpty === -1) {
    return { name: sheet.name, headerRow: null, headerDetected: false, rowCount: 0, columns: [] };
  }
  // Header = first row (within the scan window) holding >= 2 cells, all text (1 for a single-column sheet).
  const minCells = nCols > 1 ? 2 : 1;
  let headerIdx = grid
    .slice(0, HEADER_SCAN_ROWS)
    .findIndex((cells) => filled(cells) >= minCells && cells.every((v) => v === null || typeof v === "string"));
  const headerDetected = headerIdx !== -1;
  if (!headerDetected) headerIdx = firstNonEmpty;

  const header = grid[headerIdx]!;
  const data = grid.slice(headerIdx + 1).filter((cells) => filled(cells) > 0);
  const columns: ColumnAnalysis[] = [];
  for (let c = 0; c < nCols; c++) {
    const values = data.map((cells) => cells[c]).filter((v): v is Scalar => v !== null);
    const headerCell = header[c] ?? null;
    if (headerCell === null && values.length === 0) continue; // fully blank column: tolerated, not reported
    const types = new Set(values.map(scalarType));
    const inferredType: InferredType = types.size === 0 ? "empty" : types.size === 1 ? [...types][0]! : "mixed";
    const examples = withExamples ? [...new Set(values.map(display))].slice(0, MAX_EXAMPLES) : [];
    columns.push({
      index: c + 1,
      name: headerCell === null ? `column_${c + 1}` : display(headerCell).trim(),
      inferredType,
      examples,
      isEmpty: values.length === 0,
    });
  }
  return { name: sheet.name, headerRow: headerIdx + 1, headerDetected, rowCount: data.length, columns };
}

/** Read-only analysis of an xlsx buffer. Never evaluates formulas, never follows links. */
export async function analyzeXlsx(buffer: Buffer, withExamples: boolean): Promise<SheetAnalysis[]> {
  if (buffer.byteLength > MAX_ANALYSIS_BYTES) {
    throw new ValidationError(`File exceeds the ${MAX_ANALYSIS_BYTES / (1024 * 1024)}MB analysis limit`);
  }
  assertSafeXlsxArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new ValidationError("Invalid Excel file: the workbook could not be read");
  }
  if (workbook.worksheets.length === 0) throw new ValidationError("The Excel file has no worksheet");
  if (workbook.worksheets.length > MAX_SHEETS) throw new ValidationError(`Too many sheets (max ${MAX_SHEETS})`);
  return workbook.worksheets.map((s) => analyzeSheet(s, withExamples));
}
