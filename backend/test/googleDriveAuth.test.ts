import { describe, expect, it } from "vitest";
import { resolveGoogleDriveAuthOptions } from "../src/infrastructure/storage/googleDriveAuth.js";

describe("SEC: Google Drive service identity", () => {
  it("uses Application Default Credentials when no key file is provided", () => {
    expect(resolveGoogleDriveAuthOptions("production")).toEqual({
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  });

  it("rejects a JSON service-account key in production", () => {
    expect(() =>
      resolveGoogleDriveAuthOptions(
        "production",
        "./secrets/drive-service-account.json",
      ),
    ).toThrow(/Cloud Run service identity/);
  });

  it("keeps key-file authentication available for local development", () => {
    expect(
      resolveGoogleDriveAuthOptions(
        "development",
        "./secrets/drive-service-account.json",
      ),
    ).toEqual({
      keyFile: "./secrets/drive-service-account.json",
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  });
});
