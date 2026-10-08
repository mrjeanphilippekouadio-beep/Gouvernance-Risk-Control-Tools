import { Readable } from "node:stream";
import { google, type drive_v3 } from "googleapis";
import { GoogleAuth } from "google-auth-library";
import { resolveGoogleDriveAuthOptions, type GoogleDriveAuthMode } from "./googleDriveAuth.js";
import type { DocumentStorage, StoredDocumentRef } from "./DocumentStorage.js";

/**
 * Google Drive-backed implementation of DocumentStorage.
 *
 * Expects a service account with access to the Shared Drives (role "Content
 * manager") — never the frontend's user credentials. The upload folder is
 * `activeFolderId` when configured, otherwise the per-tenant folder resolved
 * via `tenantFolderResolver`, so the domain never has to know Drive folder
 * IDs (ADR-001).
 */
export class GoogleDriveStorage implements DocumentStorage {
  private readonly auth: GoogleAuth;
  private readonly tenantFolderResolver: (tenantId: string) => Promise<string>;
  private readonly activeFolderId?: string;
  private readonly deletedFolderId?: string;

  constructor(opts: {
    tenantFolderResolver: (tenantId: string) => Promise<string>;
    /** Shared Drive "active" folder; overrides the per-tenant resolver when set. */
    activeFolderId?: string;
    /** Shared Drive "deleted" folder; required for delete(). */
    deletedFolderId?: string;
    authMode?: GoogleDriveAuthMode;
    credentialsJsonPath?: string;
  }) {
    this.tenantFolderResolver = opts.tenantFolderResolver;
    this.activeFolderId = opts.activeFolderId;
    this.deletedFolderId = opts.deletedFolderId;
    this.auth = new GoogleAuth(
      resolveGoogleDriveAuthOptions(
        process.env.NODE_ENV ?? "development",
        opts.credentialsJsonPath,
        opts.authMode,
      ),
    );
  }

  /** Protected so tests can inject a fake Drive client. */
  protected async drive(): Promise<drive_v3.Drive> {
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
    const folderId =
      this.activeFolderId ?? (await this.tenantFolderResolver(params.tenantId));

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
      supportsAllDrives: true,
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
    const res = await drive.files.get({
      fileId: storageFileId,
      fields: "webViewLink",
      supportsAllDrives: true,
    });
    return res.data.webViewLink ?? `https://drive.google.com/file/d/${storageFileId}/view`;
  }

  /**
   * SEC-008: "deleting" evidence MOVES the file from its current folder to the
   * Shared Drive "deleted" folder — never Drive's trash, never a permanent
   * delete. GRC evidence is proof a control was performed, and CLAUDE.md's
   * soft-delete-only rule applies to it too. No silent fallback: without
   * DRIVE_DELETED_FOLDER_ID this throws.
   */
  async delete(storageFileId: string): Promise<void> {
    if (!this.deletedFolderId) {
      throw new Error("DRIVE_DELETED_FOLDER_ID is not configured; refusing to delete evidence file.");
    }
    const drive = await this.drive();
    const current = await drive.files.get({
      fileId: storageFileId,
      fields: "parents",
      supportsAllDrives: true,
    });
    const parents = current.data.parents ?? [];
    // Replayed delete: the file is already in the "deleted" folder.
    if (parents.includes(this.deletedFolderId)) return;
    // SEC-R04-1: only ever move a file out of the active folder, never out of
    // another folder the service account happens to reach.
    if (this.activeFolderId && !parents.includes(this.activeFolderId)) {
      throw new Error(`Drive file ${storageFileId} is not in the active evidence folder; refusing to move it.`);
    }
    await drive.files.update({
      fileId: storageFileId,
      addParents: this.deletedFolderId,
      removeParents: this.activeFolderId ?? parents.join(","),
      supportsAllDrives: true,
    });
  }
}
