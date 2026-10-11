import { describe, expect, it } from "vitest";
import { resolveGoogleDriveAuthOptions } from "../src/infrastructure/storage/googleDriveAuth.js";
import { GoogleDriveStorage } from "../src/infrastructure/storage/GoogleDriveStorage.js";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const KEY = "./secrets/drive-service-account.json";

describe("Google Drive authentication mode", () => {
  it("uses Application Default Credentials in adc mode", () => {
    expect(resolveGoogleDriveAuthOptions("production", undefined, "adc")).toEqual({ scopes: SCOPES });
  });

  it("rejects a key file path in adc mode (production)", () => {
    expect(() => resolveGoogleDriveAuthOptions("production", KEY, "adc")).toThrow(/adc/);
  });

  it("allows key_file in production (Render secret file)", () => {
    expect(resolveGoogleDriveAuthOptions("production", KEY, "key_file")).toEqual({
      keyFile: KEY,
      scopes: SCOPES,
    });
  });

  it("requires the path in key_file mode", () => {
    expect(() => resolveGoogleDriveAuthOptions("production", undefined, "key_file")).toThrow(
      /GOOGLE_DRIVE_CREDENTIALS_PATH/,
    );
  });

  it("keeps key-file authentication available for local development", () => {
    expect(resolveGoogleDriveAuthOptions("development", KEY)).toEqual({ keyFile: KEY, scopes: SCOPES });
  });
});

type Call = { op: "get" | "update"; params: Record<string, unknown> };

class FakeDriveStorage extends GoogleDriveStorage {
  calls: Call[] = [];
  protected override async drive() {
    return {
      files: {
        get: async (params: Record<string, unknown>) => {
          this.calls.push({ op: "get", params });
          return { data: { parents: ["active-folder"] } };
        },
        update: async (params: Record<string, unknown>) => {
          this.calls.push({ op: "update", params });
          return { data: {} };
        },
      },
    } as never;
  }
}

describe("GoogleDriveStorage.delete", () => {
  it("moves the file to the deleted folder instead of trashing it", async () => {
    const storage = new FakeDriveStorage({
      tenantFolderResolver: async () => "tenant-folder",
      deletedFolderId: "deleted-folder",
    });
    await storage.delete("file-1");
    expect(storage.calls).toEqual([
      { op: "get", params: { fileId: "file-1", fields: "parents", supportsAllDrives: true } },
      {
        op: "update",
        params: {
          fileId: "file-1",
          addParents: "deleted-folder",
          removeParents: "active-folder",
          supportsAllDrives: true,
        },
      },
    ]);
  });

  it("throws when the deleted folder is not configured", async () => {
    const storage = new FakeDriveStorage({ tenantFolderResolver: async () => "tenant-folder" });
    await expect(storage.delete("file-1")).rejects.toThrow(/DRIVE_DELETED_FOLDER_ID/);
    expect(storage.calls).toEqual([]);
  });
});

describe("GoogleDriveStorage.checkFolders", () => {
  it("reports each configured folder as OK", async () => {
    const storage = new FakeDriveStorage({
      tenantFolderResolver: async () => "tenant-folder",
      activeFolderId: "active-folder",
      deletedFolderId: "deleted-folder",
    });
    expect(await storage.checkFolders()).toEqual(["active folder: OK", "deleted folder: OK"]);
  });

  it("reports a failure with its status only, and a missing folder as not configured", async () => {
    class Denied extends GoogleDriveStorage {
      protected override async drive() {
        return {
          files: {
            get: async () => {
              throw Object.assign(new Error("File not found: secret-detail"), { code: 404 });
            },
          },
        } as never;
      }
    }
    const storage = new Denied({ tenantFolderResolver: async () => "t", activeFolderId: "active-folder" });
    expect(await storage.checkFolders()).toEqual(["active folder: FAILED (404)", "deleted folder: not configured"]);
  });
});
