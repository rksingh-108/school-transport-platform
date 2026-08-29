/**
 * Object storage abstraction — see docs/adr/0007-map-and-storage-provider-abstraction.md
 * and docs/privacy.md#file-access. No module may import an S3/MinIO SDK
 * directly; everything goes through this interface so the backing provider
 * (MinIO locally, any S3-compatible provider in production) can change
 * without touching feature code. There is no method that returns a public
 * URL — every read is a short-lived signed URL minted after an authorization
 * check the caller is responsible for performing first.
 */
export interface StorageProvider {
  putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void>;
  getSignedReadUrl(key: string, ttlSeconds: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  /** Used by the readiness health check — confirms the bucket is reachable. */
  isReachable(): Promise<boolean>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
