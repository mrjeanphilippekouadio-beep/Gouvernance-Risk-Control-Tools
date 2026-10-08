import { inflateRawSync } from "node:zlib";
import { ValidationError } from "../domain/errors/DomainErrors.js";

const MAX_UNCOMPRESSED_TOTAL = 20 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
/** Ratio is only checked above this size: tiny entries compress absurdly well legitimately and are bounded by the total cap anyway. */
const RATIO_CHECK_MIN_SIZE = 1024 * 1024;
const MAX_ENTRIES = 10_000;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_SEARCH = EOCD_MIN_SIZE + 0xffff;
const CENTRAL_ENTRY_FIXED_SIZE = 46;
const LOCAL_HEADER_FIXED_SIZE = 30;

/**
 * Validates an OOXML (.xlsx) zip before exceljs loads it, and throws
 * ValidationError (-> HTTP 400) on zip-bomb signs, macros, a non-workbook
 * archive, or any layout where this guard and JSZip could read different
 * entries. Each entry is really inflated with its output capped at its
 * declared size, so memory stays bounded by MAX_UNCOMPRESSED_TOTAL.
 */
export function assertSafeXlsxArchive(buffer: Buffer): void {
  const bad = (msg: string) => new ValidationError(`Invalid Excel file: ${msg}`);
  const inconsistent = () => bad("inconsistent archive");
  const entries: { name: string; method: number; compressed: number; uncompressed: number; localOffset: number }[] = [];
  const names = new Set<string>();

  if (buffer.length < EOCD_MIN_SIZE || buffer.readUInt32LE(0) !== ZIP_LOCAL_SIGNATURE) {
    throw bad("not a .xlsx (zip) archive");
  }

  let eocd = -1;
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= Math.max(0, buffer.length - EOCD_MAX_SEARCH); i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw bad("corrupt archive");

  // Strict layout so this guard and JSZip (used by exceljs) read the same
  // structure: single disk, central directory right before the EOCD, no
  // bytes after the EOCD comment, every declared entry and nothing more.
  if (
    buffer.readUInt16LE(eocd + 4) !== 0 ||
    buffer.readUInt16LE(eocd + 6) !== 0 ||
    buffer.readUInt16LE(eocd + 8) !== buffer.readUInt16LE(eocd + 10) ||
    eocd + EOCD_MIN_SIZE + buffer.readUInt16LE(eocd + 20) !== buffer.length
  ) {
    throw inconsistent();
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw bad("Zip64 archives are not supported");
  }
  if (entryCount > MAX_ENTRIES) throw bad(`too many entries (max ${MAX_ENTRIES})`);
  if (cdOffset + cdSize !== eocd) throw inconsistent();

  let pos = cdOffset;
  let total = 0;
  let hasWorkbook = false;
  for (let n = 0; n < entryCount; n++) {
    if (pos + CENTRAL_ENTRY_FIXED_SIZE > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL_ENTRY_SIGNATURE) {
      throw bad("corrupt archive");
    }
    const compressed = buffer.readUInt32LE(pos + 20);
    const uncompressed = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw bad("Zip64 archives are not supported");
    if (pos + CENTRAL_ENTRY_FIXED_SIZE + nameLen > buffer.length) throw bad("corrupt archive");

    const rawName = buffer.toString("utf8", pos + CENTRAL_ENTRY_FIXED_SIZE, pos + CENTRAL_ENTRY_FIXED_SIZE + nameLen);
    const name = rawName.toLowerCase();
    // Duplicate names: JSZip keeps the last one, which this guard may not have checked.
    if (names.has(name)) throw inconsistent();
    names.add(name);
    if (name === "xl/vbaproject.bin") throw bad("macros (vbaProject.bin) are not allowed");
    if (name === "xl/workbook.xml") hasWorkbook = true;

    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_TOTAL) throw bad("decompressed size exceeds the allowed limit");
    if (uncompressed >= RATIO_CHECK_MIN_SIZE && uncompressed > compressed * MAX_COMPRESSION_RATIO) {
      throw bad("suspicious compression ratio");
    }

    entries.push({
      name: rawName,
      method: buffer.readUInt16LE(pos + 10),
      compressed,
      uncompressed,
      localOffset: buffer.readUInt32LE(pos + 42),
    });
    pos += CENTRAL_ENTRY_FIXED_SIZE + nameLen + extraLen + commentLen;
  }

  if (pos !== eocd) throw inconsistent();
  if (!hasWorkbook) throw bad("xl/workbook.xml is missing");

  // Declared sizes can lie: really inflate each entry with output capped at
  // its declared size, so memory/CPU stay bounded by MAX_UNCOMPRESSED_TOTAL.
  for (const e of entries) {
    if (e.localOffset + LOCAL_HEADER_FIXED_SIZE > buffer.length || buffer.readUInt32LE(e.localOffset) !== ZIP_LOCAL_SIGNATURE) {
      throw inconsistent();
    }
    const localNameLen = buffer.readUInt16LE(e.localOffset + 26);
    const localNameStart = e.localOffset + LOCAL_HEADER_FIXED_SIZE;
    if (
      localNameStart + localNameLen > buffer.length ||
      buffer.toString("utf8", localNameStart, localNameStart + localNameLen) !== e.name ||
      buffer.readUInt16LE(e.localOffset + 8) !== e.method
    ) {
      throw inconsistent();
    }
    const start = e.localOffset + LOCAL_HEADER_FIXED_SIZE + buffer.readUInt16LE(e.localOffset + 26) + buffer.readUInt16LE(e.localOffset + 28);
    if (start + e.compressed > buffer.length) throw inconsistent();
    const data = buffer.subarray(start, start + e.compressed);
    if (e.method === 0) {
      if (data.length !== e.uncompressed) throw inconsistent();
    } else if (e.method === 8) {
      try {
        const out = inflateRawSync(data, { maxOutputLength: e.uncompressed + 1 });
        if (out.length !== e.uncompressed) throw inconsistent();
      } catch {
        throw inconsistent();
      }
    } else {
      throw bad("unsupported compression method");
    }
  }
}
