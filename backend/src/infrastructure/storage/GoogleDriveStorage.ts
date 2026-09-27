import { Readable } from "node:stream";
import { google } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import type { DocumentStorage, StoredDocumentRef } from "./DocumentStorage.js";

/**
 * Google Drive-backed implementation of DocumentStorage.
 *
 * Expects a service account with domain-wide delegation (or access to a
 * shared drive) — never the frontend's user credentials. One shared
 * drive folder per tenant, resolved via `tenantFolderResolver` so the
 * domain never has to know Drive folder IDs (ADR-001: "cette preuve
 * appartient à cette exécution de contrôle", pas "cette preuve se
 * trouve dans le dossier X").
 */
export class GoogleDriveStorage implements DocumentStorage {
  private readonly auth: GoogleAuth;

  constructor(
    private readonly tenantFolderResolver: (tenantId: string) => Promise<string>,
    credentialsJsonPath: string,
  ) {
    this.auth = new GoogleAuth({
      keyFile: credentialsJsonPath,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }

  private async drive() {
    const client = await this.auth.getClient();
    return google.drive({ version: "v3", auth: client as never });
  }

  async upload(params: {
    tenantId: string;
    fileName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<StoredDocumentRef> {
    const drive = await this.drive();
    const folderId = await this.tenantFolderResolver(params.tenantId);

    const res = await drive.files.create({
      requestBody: {
        name: params.fileName,
        parents: [folderId],
      },
      media: {
        mimeType: params.mimeType,
        body: Readable.from(params.content),
      },
      fields: "id, webViewLink",
    });

    const fileId = res.data.id;
    if (!fileId) {
      throw new Error("Google Drive upload did not return a file id");
    }

    return {
      storageFileId: fileId,
      url: res.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
      fileName: params.fileName,
    };
  }

  async getUrl(storageFileId: string): Promise<string> {
    const drive = await this.drive();
    const res = await drive.files.get({ fileId: storageFileId, fields: "webViewLink" });
    return res.data.webViewLink ?? `https://drive.google.com/file/d/${storageFileId}/view`;
  }

  /**
   * SEC-008: moves the file to Drive's trash instead of permanently
   * deleting it — GRC evidence is proof of a control having been
   * performed, and CLAUDE.md's soft-delete-only rule applies to it too.
   * A permanent `drive.files.delete` here made the underlying proof
   * unrecoverable the moment `evidence.delete` was called, even though
   * the Postgres row itself was only ever soft-deleted.
   */
  async delete(storageFileId: string): Promise<void> {
    const drive = await this.drive();
    await drive.files.update({ fileId: storageFileId, requestBody: { trashed: true } });
  }
}
