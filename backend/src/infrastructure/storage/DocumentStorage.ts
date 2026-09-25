export interface StoredDocumentRef {
  storageFileId: string;
  url: string;
  fileName: string;
}

/**
 * The domain calls `documentStorage.upload(...)`, never `GoogleDrive.upload(...)`
 * directly. Today's implementation is Google Drive; swapping to S3 or GCS
 * later means adding a new class here, not touching services. See ADR-001.
 */
export interface DocumentStorage {
  upload(params: {
    tenantId: string;
    fileName: string;
    mimeType: string;
    content: Buffer;
  }): Promise<StoredDocumentRef>;
  getUrl(storageFileId: string): Promise<string>;
  delete(storageFileId: string): Promise<void>;
}
