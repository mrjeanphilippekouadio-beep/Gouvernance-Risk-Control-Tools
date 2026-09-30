import { describe, expect, it } from "vitest";
import { validateEvidenceFile } from "../src/services/evidenceFileValidation.js";
import { ValidationError } from "../src/domain/errors/DomainErrors.js";

describe("validateEvidenceFile", () => {
  it("accepts PDF content whose MIME type and extension agree", () => {
    expect(() => validateEvidenceFile("preuve.pdf", "application/pdf", Buffer.from("%PDF-1.7\nfixture"))).not.toThrow();
  });

  it("rejects a forged MIME type when the bytes are not a PDF", () => {
    expect(() => validateEvidenceFile("preuve.pdf", "application/pdf", Buffer.from("<html>not a PDF"))).toThrow(ValidationError);
  });

  it("rejects a MIME/extension mismatch", () => {
    expect(() => validateEvidenceFile("preuve.png", "application/pdf", Buffer.from("%PDF-1.7"))).toThrow(/extension does not match/);
  });

  it("rejects unsupported MIME types", () => {
    expect(() => validateEvidenceFile("preuve.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", Buffer.from("PK"))).toThrow(/Unsupported evidence file type/);
  });

  it("rejects unsupported signature for a declared PNG", () => {
    expect(() => validateEvidenceFile("preuve.png", "image/png", Buffer.from("not a PNG"))).toThrow(/content does not match/);
  });

  it("accepts JPEG with the .jpeg extension", () => {
    expect(() => validateEvidenceFile("preuve.jpeg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00]))).not.toThrow();
  });
});
