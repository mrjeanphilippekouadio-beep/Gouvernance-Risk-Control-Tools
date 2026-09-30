import { ValidationError } from "../domain/errors/DomainErrors.js";

const ALLOWED_TYPES = {
  "application/pdf": { extension: ".pdf", matches: (b: Buffer) => b.length >= 5 && b.subarray(0, 5).toString("ascii") === "%PDF-" },
  "image/png": { extension: ".png", matches: (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/jpeg": { extension: ".jpg", matches: (b: Buffer) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, alternateExtensions: [".jpeg"] },
} as const;

/**
 * Enforce an explicit allowlist and compare declared MIME/extension to
 * file-signature bytes. This is a format check, not malware scanning.
 */
export function validateEvidenceFile(fileName: string, mimeType: string, content: Buffer): void {
  const normalizedMime = mimeType.trim().toLowerCase();
  const rule = ALLOWED_TYPES[normalizedMime as keyof typeof ALLOWED_TYPES];
  if (!rule) {
    throw new ValidationError("Unsupported evidence file type. Allowed types: PDF, PNG, JPEG");
  }
  const normalizedName = fileName.trim().toLowerCase();
  const extensions = "alternateExtensions" in rule
    ? [rule.extension, ...rule.alternateExtensions]
    : [rule.extension];
  if (!extensions.some((extension) => normalizedName.endsWith(extension))) {
    throw new ValidationError("File extension does not match the declared file type");
  }
  if (!rule.matches(content)) {
    throw new ValidationError("File content does not match the declared file type");
  }
}
