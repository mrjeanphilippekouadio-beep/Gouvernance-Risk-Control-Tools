import { inflateRawSync } from "node:zlib";
import { ValidationError } from "../domain/errors/DomainErrors.js";

const MAX_UNCOMPRESSED_TOTAL = 50 * 1024 * 1024;
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
 * Inspects an OOXML (.xlsx) zip's central directory WITHOUT decompressing
 * anything, and throws ValidationError (-> HTTP 400) on zip-bomb signs,
 * macros, or a non-workbook archive. Declared sizes can lie, so callers
 * must still bound what they parse afterwards (e.g. row caps).
 */
export function assertSafeXlsxArchive(buffer: Buffer): void {
  const bad = (msg: string) => new ValidationError(`Invalid Excel file: ${msg}`);
  const inconsistent = () => bad("inconsistent archive");
  const entries: { method: number; compressed: number; uncompressed: number; localOffset: number }[] = [];

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

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw bad("Zip64 archives are not supported");
  }
  if (entryCount > MAX_ENTRIES) throw bad(`too many entries (max ${MAX_ENTRIES})`);
  if (cdOffset + cdSize > eocd) throw bad("corrupt archive");

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

    const name = buffer
      .toString("utf8", pos + CENTRAL_ENTRY_FIXED_SIZE, pos + CENTRAL_ENTRY_FIXED_SIZE + nameLen)
      .toLowerCase();
    if (name === "xl/vbaproject.bin") throw bad("macros (vbaProject.bin) are not allowed");
    if (name === "xl/workbook.xml") hasWorkbook = true;

    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_TOTAL) throw bad("decompressed size exceeds the allowed limit");
    if (uncompressed >= RATIO_CHECK_MIN_SIZE && uncompressed > compressed * MAX_COMPRESSION_RATIO) {
      throw bad("suspicious compression ratio");
    }

    entries.push({
      method: buffer.readUInt16LE(pos + 10),
      compressed,
      uncompressed,
      localOffset: buffer.readUInt32LE(pos + 42),
    });
    pos += CENTRAL_ENTRY_FIXED_SIZE + nameLen + extraLen + commentLen;
  }

  if (!hasWorkbook) throw bad("xl/workbook.xml is missing");

  // Declared sizes can lie: really inflate each entry with output capped at
  // its declared size, so memory/CPU stay bounded by MAX_UNCOMPRESSED_TOTAL.
  for (const e of entries) {
    if (e.localOffset + LOCAL_HEADER_FIXED_SIZE > buffer.length || buffer.readUInt32LE(e.localOffset) !== ZIP_LOCAL_SIGNATURE) {
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
