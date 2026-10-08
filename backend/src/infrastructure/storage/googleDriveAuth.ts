export type GoogleDriveAuthOptions = {
  scopes: string[];
  keyFile?: string;
};

export type GoogleDriveAuthMode = "adc" | "key_file";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

/**
 * adc: Application Default Credentials (Cloud Run service identity). A key
 * file path alongside it is ambiguous and rejected.
 * key_file: JSON service-account key (local dev, or a Render secret file in
 * production); the path is mandatory.
 * If `authMode` is omitted it is inferred from the presence of the path.
 */
export function resolveGoogleDriveAuthOptions(
  _nodeEnv: string,
  credentialsJsonPath?: string,
  authMode: GoogleDriveAuthMode = credentialsJsonPath ? "key_file" : "adc",
): GoogleDriveAuthOptions {
  if (authMode === "key_file") {
    if (!credentialsJsonPath) {
      throw new Error("GOOGLE_DRIVE_AUTH_MODE=key_file requires GOOGLE_DRIVE_CREDENTIALS_PATH.");
    }
    return { keyFile: credentialsJsonPath, scopes: SCOPES };
  }
  if (credentialsJsonPath) {
    throw new Error(
      "GOOGLE_DRIVE_AUTH_MODE=adc must not be combined with GOOGLE_DRIVE_CREDENTIALS_PATH; use key_file.",
    );
  }
  return { scopes: SCOPES };
}
