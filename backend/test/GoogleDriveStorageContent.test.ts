import { describe, expect, it } from "vitest";
import { GoogleDriveStorage } from "../src/infrastructure/storage/GoogleDriveStorage.js";
import { MAX_DOCUMENT_BYTES } from "../src/infrastructure/storage/DocumentStorage.js";

class FakeDrive extends GoogleDriveStorage {
  calls: Array<Record<string, unknown>> = [];
  constructor(private readonly size: string) {
    super({ tenantFolderResolver: async () => "t" });
  }
  protected override async drive() {
    return {
      files: {
        get: async (p: Record<string, unknown>) => {
          this.calls.push(p);
          if (p["alt"] === "media") return { data: new Uint8Array([1, 2, 3]).buffer };
          return { data: { size: this.size } };
        },
      },
    } as never;
  }
}

describe("GoogleDriveStorage.getContent size cap", () => {
  it("reads content when the file is within the limit", async () => {
    const drive = new FakeDrive("3");
    expect((await drive.getContent("f1")).length).toBe(3);
    expect(drive.calls[0]).toMatchObject({ fields: "size", supportsAllDrives: true });
  });

  it("refuses a file above the limit without downloading it", async () => {
    const drive = new FakeDrive(String(MAX_DOCUMENT_BYTES + 1));
    await expect(drive.getContent("f1")).rejects.toThrow(/exceeds/);
    expect(drive.calls.some((c) => c["alt"] === "media")).toBe(false);
  });
});
