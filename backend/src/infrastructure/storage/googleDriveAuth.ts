export type GoogleDriveAuthOptions = {
  scopes: string[];
  keyFile?: string;
};

/**
 * Production Cloud Run must authenticate Google APIs through the assigned
 * user-managed service account (Application Default Credentials), not a
 * long-lived JSON service-account key mounted into the container.
 *
 * A key file remains supported for local development/legacy environments.
 */
export function resolveGoogleDriveAuthOptions(
  nodeEnv: string,
  credentialsJsonPath?: string,
): GoogleDriveAuthOptions {
  if (nodeEnv === "production" && credentialsJsonPath) {
    throw new Error(
      "Production Google Drive authentication must use the Cloud Run service identity; GOOGLE_DRIVE_CREDENTIALS_PATH must not be set.",
    );
  }

  return credentialsJsonPath
    ? {
        keyFile: credentialsJsonPath,
        scopes: ["https://www.googleapis.com/auth/drive"],
      }
    : {
        scopes: ["https://www.googleapis.com/auth/drive"],
      };
}
